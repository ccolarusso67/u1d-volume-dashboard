/**
 * src/lib/board/get-board-executive-dashboard.ts
 *
 * PR 005A — Aggregator for the executive monthly board view.
 *
 * SUPERSET of PR 004A's getBoardPeriod(). All four facts about read paths
 * are preserved:
 *   1. Volume facts come only from active locked files.
 *   2. Superseded files never contribute to metrics.
 *   3. Readiness is computed via the shared evaluateReadiness() so the
 *      board page agrees with the lock helper and the readiness API.
 *   4. Prior-month + prior-year + YTD comparisons use the SAME filter.
 *
 * Structure:
 *   - Run ~16 queries in parallel via Promise.all.
 *   - Stitch results into BoardExecutiveDashboard.
 *   - Use pure helpers (computeConcentration, computeCategoryMix,
 *     findMaterialMovers, aggregateYtd) for all derived calculations
 *     so the math is unit-testable.
 */
import type { Pool } from "pg";
import { evaluateReadiness } from "../review/readiness";
import { listPeriodEvents } from "../review/list-period-events";
import { getOperatorNotes } from "../operator-notes/get-operator-notes";
import { SECTION_KEYS, type SectionKey } from "../operator-notes/types";
import { monthLabel, priorMonth } from "./metrics";
import { getVolumeGoal } from "../queries/volume-goal";
import type { BoardPeriodView } from "./types";
import type {
  BoardExecutiveDashboard,
  ExecCustomerRow,
  ExecPackageRow,
  ExecTrendRow,
} from "./executive-types";
import { findMaterialMovers, type MoverOutputRow } from "./movers";
import { computeConcentration } from "./concentration";
import { computeCategoryMix } from "./mix";
import { aggregateYtd } from "./ytd";
import { loadFinanceOverlay } from "./load-finance-overlay";
import type { BoardFinanceOverlay } from "./executive-types";

const TOP_N_CUSTOMERS = 10;
const TOP_N_PACKAGES = 10;
const TREND_MONTHS_LONG = 12;
const TREND_MONTHS_SHORT = 6;

// ---------------------------------------------------------------------------
// SQL fragments
// ---------------------------------------------------------------------------

const ACTIVE_FILE_SQL = `
  SELECT file_id::int, filename, file_hash, version_no::int,
         uploaded_at, uploaded_by,
         source_total_row::float8, computed_customer_sum::float8,
         has_total_discrepancy, discrepancy_amount::float8
    FROM u1d_ops.volume_files
   WHERE period_year = $1 AND period_month = $2
     AND is_active = TRUE
   LIMIT 1
`;

const BOARD_PERIOD_SQL = `
  SELECT status, locked_at, locked_by
    FROM u1d_ops.board_periods
   WHERE period_year = $1 AND period_month = $2
`;

// Single-period totals from locked active file.
const PERIOD_AGGREGATE_SQL = `
  SELECT
    COALESCE(SUM(vf.gallons), 0)::float8                 AS total_gallons,
    COUNT(DISTINCT vf.customer_key)::int                 AS customer_count,
    COUNT(DISTINCT vf.package_key)::int                  AS package_count,
    COUNT(*)::int                                        AS fact_row_count
  FROM u1d_ops.volume_fact vf
  JOIN u1d_ops.volume_files file ON file.file_id = vf.file_id
  WHERE file.period_year = $1 AND file.period_month = $2
    AND file.is_active = TRUE AND file.locked_at IS NOT NULL
`;

// Per-customer aggregate decorated with display name + is_intercompany.
const CUSTOMER_BY_PERIOD_SQL = `
  SELECT vf.customer_key,
         COALESCE(c.display_name, vf.customer_key)       AS customer_name,
         COALESCE(c.is_intercompany, FALSE)              AS is_intercompany,
         SUM(vf.gallons)::float8                         AS gallons
    FROM u1d_ops.volume_fact vf
    JOIN u1d_ops.volume_files file ON file.file_id = vf.file_id
    LEFT JOIN u1d_ops.customers c  ON c.customer_key = vf.customer_key
   WHERE file.period_year = $1 AND file.period_month = $2
     AND file.is_active = TRUE AND file.locked_at IS NOT NULL
   GROUP BY vf.customer_key, c.display_name, c.is_intercompany
`;

// Per-package aggregate decorated with label + family.
const PACKAGE_BY_PERIOD_SQL = `
  SELECT vf.package_key,
         COALESCE(p.display_name, vf.package_key)        AS package_label,
         COALESCE(p.family, 'unknown')                   AS family,
         SUM(vf.gallons)::float8                         AS gallons
    FROM u1d_ops.volume_fact vf
    JOIN u1d_ops.volume_files file ON file.file_id = vf.file_id
    LEFT JOIN u1d_ops.packages p   ON p.package_key = vf.package_key
   WHERE file.period_year = $1 AND file.period_month = $2
     AND file.is_active = TRUE AND file.locked_at IS NOT NULL
   GROUP BY vf.package_key, p.display_name, p.family
`;

// YTD: per-month totals for a year filtered to active locked files.
const MONTHS_IN_YEAR_SQL = `
  SELECT file.period_year::int   AS period_year,
         file.period_month::int  AS period_month,
         SUM(vf.gallons)::float8 AS total_gallons
    FROM u1d_ops.volume_fact vf
    JOIN u1d_ops.volume_files file ON file.file_id = vf.file_id
   WHERE file.period_year = $1
     AND file.period_month <= $2
     AND file.is_active = TRUE AND file.locked_at IS NOT NULL
   GROUP BY file.period_year, file.period_month
   ORDER BY file.period_month
`;

// Trend: last N months of monthly totals + locked status, ordered chronologically.
const TREND_SQL = `
  WITH period_pairs AS (
    SELECT period_year, period_month
      FROM u1d_ops.board_periods
     WHERE (period_year * 12 + period_month) <= ($1 * 12 + $2)
     ORDER BY period_year DESC, period_month DESC
     LIMIT $3
  )
  SELECT pp.period_year::int   AS period_year,
         pp.period_month::int  AS period_month,
         COALESCE((
           SELECT SUM(vf.gallons)::float8
             FROM u1d_ops.volume_fact vf
             JOIN u1d_ops.volume_files file ON file.file_id = vf.file_id
            WHERE file.period_year = pp.period_year
              AND file.period_month = pp.period_month
              AND file.is_active = TRUE
              AND file.locked_at IS NOT NULL
         ), 0)                                            AS total_gallons,
         COALESCE((
           SELECT bp.status = 'locked'
             FROM u1d_ops.board_periods bp
            WHERE bp.period_year = pp.period_year
              AND bp.period_month = pp.period_month
         ), FALSE)                                        AS is_locked
    FROM period_pairs pp
   ORDER BY pp.period_year, pp.period_month
`;

const ALERT_COUNTS_SQL = `
  SELECT
    COALESCE((SELECT COUNT(*) FROM u1d_ops.package_alerts pa
        JOIN u1d_ops.volume_files vf USING (file_id)
       WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE), 0)::int AS package_total,
    COALESCE((SELECT COUNT(*) FROM u1d_ops.customer_alerts ca
        JOIN u1d_ops.volume_files vf USING (file_id)
       WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE), 0)::int AS customer_total,
    COALESCE((SELECT COUNT(*) FROM u1d_ops.data_quality_alerts dqa
        JOIN u1d_ops.volume_files vf USING (file_id)
       WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE), 0)::int AS dq_total,
    COALESCE((SELECT COUNT(*) FROM (
        SELECT 1 FROM u1d_ops.package_alerts pa  JOIN u1d_ops.volume_files vf USING (file_id)
         WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE AND pa.status = 'pending'
        UNION ALL
        SELECT 1 FROM u1d_ops.customer_alerts ca JOIN u1d_ops.volume_files vf USING (file_id)
         WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE AND ca.status = 'pending'
        UNION ALL
        SELECT 1 FROM u1d_ops.data_quality_alerts dqa JOIN u1d_ops.volume_files vf USING (file_id)
         WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE AND dqa.status = 'pending'
    ) s), 0)::int AS pending_total,
    COALESCE((SELECT COUNT(*) FROM (
        SELECT 1 FROM u1d_ops.package_alerts pa  JOIN u1d_ops.volume_files vf USING (file_id)
         WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE AND pa.status <> 'pending'
        UNION ALL
        SELECT 1 FROM u1d_ops.customer_alerts ca JOIN u1d_ops.volume_files vf USING (file_id)
         WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE AND ca.status <> 'pending'
        UNION ALL
        SELECT 1 FROM u1d_ops.data_quality_alerts dqa JOIN u1d_ops.volume_files vf USING (file_id)
         WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE AND dqa.status <> 'pending'
    ) r), 0)::int AS resolved_total
`;

// ---------------------------------------------------------------------------
// Types and helpers
// ---------------------------------------------------------------------------

type CustomerRow = {
  customer_key: string;
  customer_name: string;
  is_intercompany: boolean;
  gallons: number;
};
type PackageRow = {
  package_key: string;
  package_label: string;
  family: string;
  gallons: number;
};
type AggRow = {
  total_gallons: number;
  customer_count: number;
  package_count: number;
  fact_row_count: number;
};
type TrendRow = {
  period_year: number;
  period_month: number;
  total_gallons: number;
  is_locked: boolean;
};
type AlertCountsRow = {
  package_total: number;
  customer_total: number;
  dq_total: number;
  pending_total: number;
  resolved_total: number;
};
type ActiveFileRow = {
  file_id: number;
  filename: string;
  file_hash: string;
  version_no: number;
  uploaded_at: Date | string;
  uploaded_by: string;
  source_total_row: number | null;
  computed_customer_sum: number | null;
  has_total_discrepancy: boolean;
  discrepancy_amount: number | null;
};
type PeriodRow = {
  status: string;
  locked_at: Date | string | null;
  locked_by: string | null;
};

function toIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function deltaSet(current: number, prior: number | null): { delta_gallons: number | null; delta_pct: number | null } {
  if (prior === null) return { delta_gallons: null, delta_pct: null };
  const d = current - prior;
  return {
    delta_gallons: d,
    delta_pct: prior !== 0 ? d / prior : null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Optional dependency injection for tests. In production all callers omit
 * this — the default loader uses getFinancePool() which respects the
 * U1D_FINANCE_DATABASE_URL env var and gracefully degrades to null when
 * the env var is missing.
 */
export type GetBoardExecutiveDashboardOpts = {
  /** Override the finance overlay loader. Tests pass `async () => null`
   *  to keep behavior identical to pre-PR-012B. */
  financeOverlayLoader?: (
    year: number,
    month: number
  ) => Promise<BoardFinanceOverlay | null>;
};

export async function getBoardExecutiveDashboard(
  pool: Pool,
  year: number,
  month: number,
  opts: GetBoardExecutiveDashboardOpts = {}
): Promise<BoardExecutiveDashboard> {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new RangeError(`getBoardExecutiveDashboard: invalid year ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`getBoardExecutiveDashboard: invalid month ${month}`);
  }

  const prior = priorMonth(year, month);
  const priorYear = year - 1;

  const [
    boardRows,
    activeRows,
    currentAgg,
    priorMonthAgg,
    priorYearAgg,
    customersCurrent,
    customersPriorMonth,
    customersPriorYear,
    packagesCurrent,
    packagesPriorMonth,
    packagesPriorYear,
    ytdCurrentRows,
    ytdPriorRows,
    trendRows,
    alertRows,
    operatorNotes,
    lockHistory,
  ] = await Promise.all([
    pool.query<PeriodRow>(BOARD_PERIOD_SQL, [year, month]),
    pool.query<ActiveFileRow>(ACTIVE_FILE_SQL, [year, month]),
    pool.query<AggRow>(PERIOD_AGGREGATE_SQL, [year, month]),
    pool.query<AggRow>(PERIOD_AGGREGATE_SQL, [prior.year, prior.month]),
    pool.query<AggRow>(PERIOD_AGGREGATE_SQL, [priorYear, month]),
    pool.query<CustomerRow>(CUSTOMER_BY_PERIOD_SQL, [year, month]),
    pool.query<CustomerRow>(CUSTOMER_BY_PERIOD_SQL, [prior.year, prior.month]),
    pool.query<CustomerRow>(CUSTOMER_BY_PERIOD_SQL, [priorYear, month]),
    pool.query<PackageRow>(PACKAGE_BY_PERIOD_SQL, [year, month]),
    pool.query<PackageRow>(PACKAGE_BY_PERIOD_SQL, [prior.year, prior.month]),
    pool.query<PackageRow>(PACKAGE_BY_PERIOD_SQL, [priorYear, month]),
    pool.query<{ period_year: number; period_month: number; total_gallons: number }>(MONTHS_IN_YEAR_SQL, [year, month]),
    pool.query<{ period_year: number; period_month: number; total_gallons: number }>(MONTHS_IN_YEAR_SQL, [priorYear, month]),
    pool.query<TrendRow>(TREND_SQL, [year, month, TREND_MONTHS_LONG]),
    pool.query<AlertCountsRow>(ALERT_COUNTS_SQL, [year, month]),
    getOperatorNotes(pool, year, month),
    listPeriodEvents(pool, year, month, 50),
  ]);

  const boardRow = boardRows.rows[0] ?? null;
  const activeRow = activeRows.rows[0] ?? null;
  const currentMetrics: AggRow = currentAgg.rows[0] ?? {
    total_gallons: 0, customer_count: 0, package_count: 0, fact_row_count: 0,
  };

  // Detect presence of locked prior data by checking whether per-customer
  // slices returned non-empty (the aggregate query returns zeros either
  // way, so it can't distinguish "no locked file" from "locked file with
  // no facts" — the slice queries can).
  const priorMonthLocked = customersPriorMonth.rows.length > 0;
  const priorYearLocked = customersPriorYear.rows.length > 0;

  const priorMonthMetrics = priorMonthLocked ? priorMonthAgg.rows[0] ?? null : null;
  const priorYearMetrics = priorYearLocked ? priorYearAgg.rows[0] ?? null : null;

  // ---- Build the customer + package rows with MoM + YoY ----
  const priorMonthCustomerByKey = new Map<string, number>(
    customersPriorMonth.rows.map((r) => [r.customer_key, num(r.gallons)])
  );
  const priorYearCustomerByKey = new Map<string, number>(
    customersPriorYear.rows.map((r) => [r.customer_key, num(r.gallons)])
  );
  const priorMonthPackageByKey = new Map<string, number>(
    customersPriorMonth.rows.length > 0
      ? packagesPriorMonth.rows.map((r) => [r.package_key, num(r.gallons)])
      : []
  );
  const priorYearPackageByKey = new Map<string, number>(
    customersPriorYear.rows.length > 0
      ? packagesPriorYear.rows.map((r) => [r.package_key, num(r.gallons)])
      : []
  );

  const customersSorted = [...customersCurrent.rows]
    .sort((a, b) => num(b.gallons) - num(a.gallons));
  const total = num(currentMetrics.total_gallons);

  const topCustomers: ExecCustomerRow[] = customersSorted
    .slice(0, TOP_N_CUSTOMERS)
    .map((r) => {
      const gallons = num(r.gallons);
      const priorM = priorMonthLocked ? priorMonthCustomerByKey.get(r.customer_key) ?? 0 : null;
      const priorY = priorYearLocked ? priorYearCustomerByKey.get(r.customer_key) ?? 0 : null;
      const mom = deltaSet(gallons, priorM);
      const yoy = deltaSet(gallons, priorY);
      return {
        customer_key: r.customer_key,
        customer_name: r.customer_name,
        is_intercompany: r.is_intercompany,
        gallons,
        share_pct: total > 0 ? gallons / total : null,
        prior_month_gallons: priorM,
        prior_year_gallons: priorY,
        mom_delta_gallons: mom.delta_gallons,
        mom_delta_pct: mom.delta_pct,
        yoy_delta_gallons: yoy.delta_gallons,
        yoy_delta_pct: yoy.delta_pct,
      };
    });

  const packagesSorted = [...packagesCurrent.rows]
    .sort((a, b) => num(b.gallons) - num(a.gallons));
  const topPackages: ExecPackageRow[] = packagesSorted
    .slice(0, TOP_N_PACKAGES)
    .map((r) => {
      const gallons = num(r.gallons);
      const priorM = priorMonthLocked ? priorMonthPackageByKey.get(r.package_key) ?? 0 : null;
      const priorY = priorYearLocked ? priorYearPackageByKey.get(r.package_key) ?? 0 : null;
      const mom = deltaSet(gallons, priorM);
      const yoy = deltaSet(gallons, priorY);
      return {
        package_key: r.package_key,
        package_label: r.package_label,
        family: r.family,
        gallons,
        share_pct: total > 0 ? gallons / total : null,
        prior_month_gallons: priorM,
        prior_year_gallons: priorY,
        mom_delta_gallons: mom.delta_gallons,
        mom_delta_pct: mom.delta_pct,
        yoy_delta_gallons: yoy.delta_gallons,
        yoy_delta_pct: yoy.delta_pct,
      };
    });

  // ---- Movers ----
  const customerMovers = findMaterialMovers(
    customersCurrent.rows.map((r) => ({
      key: r.customer_key,
      display_name: r.customer_name,
      current: num(r.gallons),
      prior: priorMonthLocked ? priorMonthCustomerByKey.get(r.customer_key) ?? 0 : null,
    }))
  );
  const packageMovers = findMaterialMovers(
    packagesCurrent.rows.map((r) => ({
      key: r.package_key,
      display_name: r.package_label,
      current: num(r.gallons),
      prior: priorMonthLocked ? priorMonthPackageByKey.get(r.package_key) ?? 0 : null,
    }))
  );

  // ---- Concentration + category mix ----
  const concentration = computeConcentration(
    customersCurrent.rows.map((r) => ({
      key: r.customer_key,
      display_name: r.customer_name,
      gallons: num(r.gallons),
      is_intercompany: r.is_intercompany,
    }))
  );
  const categoryMix = computeCategoryMix(
    packagesCurrent.rows.map((r) => ({
      package_key: r.package_key,
      package_label: r.package_label,
      family: r.family,
      gallons: num(r.gallons),
    }))
  );

  // ---- YTD ----
  const ytdCurrent = aggregateYtd(
    ytdCurrentRows.rows.map((r) => ({
      period_year: r.period_year, period_month: r.period_month,
      total_gallons: num(r.total_gallons),
    })), year, month
  );
  const ytdPrior = aggregateYtd(
    ytdPriorRows.rows.map((r) => ({
      period_year: r.period_year, period_month: r.period_month,
      total_gallons: num(r.total_gallons),
    })), priorYear, month
  );
  const ytdPriorGallons = ytdPriorRows.rows.length > 0 ? ytdPrior.ytd_gallons : null;
  const ytdDelta = deltaSet(ytdCurrent.ytd_gallons, ytdPriorGallons);

  // ---- Trends ----
  const allTrend: ExecTrendRow[] = trendRows.rows.map((r) => ({
    period_year: r.period_year,
    period_month: r.period_month,
    label: monthLabel(r.period_year, r.period_month),
    total_gallons: num(r.total_gallons),
    is_locked: r.is_locked,
  }));
  const trend12 = allTrend.slice(-TREND_MONTHS_LONG);
  const trend6 = allTrend.slice(-TREND_MONTHS_SHORT);

  // ---- Operator notes (PR 003E shape mapped to UI section keys) ----
  const operatorNotesView = operatorNotes.exists
    ? ({
        ...(Object.fromEntries(
          SECTION_KEYS.map((k) => [k, operatorNotes.sections[k] ?? ""])
        ) as Record<SectionKey, string>),
        completed_at: operatorNotes.completed_at,
        completed_by: operatorNotes.completed_by,
      })
    : null;

  // ---- Readiness ----
  const alertCounts = alertRows.rows[0] ?? {
    package_total: 0, customer_total: 0, dq_total: 0, pending_total: 0, resolved_total: 0,
  };
  const readiness = evaluateReadiness({
    hasActiveFile: !!activeRow,
    hasBoardPeriodRow: !!boardRow,
    isAlreadyLocked: boardRow?.status === "locked",
    pendingPackageAlerts: 0,
    pendingCustomerAlerts: 0,
    pendingDataQualityAlerts: 0,
    operatorNotesExists: operatorNotes.exists,
    operatorNotesComplete: operatorNotes.is_complete,
  });
  const blockers = readiness.blockers.filter((b) => b !== "already_locked");
  if (alertCounts.pending_total > 0) {
    blockers.push(`pending_alerts_total:${alertCounts.pending_total}`);
  }
  const isLocked = boardRow?.status === "locked";
  const ready = isLocked && blockers.length === 0;
  if (!isLocked) blockers.unshift("period_not_locked");

  const reopenCount = lockHistory.filter((e) => e.event_type === "reopened").length;

  // ---- Compose BoardExecutiveDashboard ----
  const periodInfo: BoardPeriodView["period"] = {
    year, month, label: monthLabel(year, month),
    status: boardRow?.status ?? null,
    locked_at: toIso(boardRow?.locked_at ?? null),
    locked_by: boardRow?.locked_by ?? null,
  };
  const activeFile: BoardPeriodView["activeFile"] = activeRow
    ? {
        file_id: activeRow.file_id,
        filename: activeRow.filename,
        version_no: activeRow.version_no,
        uploaded_at: toIso(activeRow.uploaded_at),
        uploaded_by: activeRow.uploaded_by,
        file_hash_prefix: activeRow.file_hash.slice(0, 8),
        total_gallons: activeRow.computed_customer_sum,
        source_total_gallons: activeRow.source_total_row,
        reconstructed_total_gallons: activeRow.computed_customer_sum,
        has_total_discrepancy: activeRow.has_total_discrepancy,
      }
    : null;

  const priorMonthBlock = priorMonthMetrics
    ? {
        total_gallons: num(priorMonthMetrics.total_gallons),
        customer_count: num(priorMonthMetrics.customer_count),
        package_count: num(priorMonthMetrics.package_count),
        fact_row_count: num(priorMonthMetrics.fact_row_count),
        ...deltaSet(num(currentMetrics.total_gallons), num(priorMonthMetrics.total_gallons)),
      }
    : null;
  const priorYearBlock = priorYearMetrics
    ? {
        total_gallons: num(priorYearMetrics.total_gallons),
        customer_count: num(priorYearMetrics.customer_count),
        package_count: num(priorYearMetrics.package_count),
        fact_row_count: num(priorYearMetrics.fact_row_count),
        ...deltaSet(num(currentMetrics.total_gallons), num(priorYearMetrics.total_gallons)),
      }
    : null;

  // PR 012B — finance overlay (null if not configured / unreachable / no data).
  const financeLoader = opts.financeOverlayLoader ?? loadFinanceOverlay;
  const finance = await financeLoader(year, month);

  // Monthly volume goal (working_days * editable daily target). Never blocks
  // the dashboard: a failure here degrades to null.
  const volumeGoal = await getVolumeGoal(year, month).catch(() => null);

  return {
    period: periodInfo,
    readiness: { ready, blockers },
    activeFile,
    currentMetrics: {
      total_gallons: num(currentMetrics.total_gallons),
      customer_count: num(currentMetrics.customer_count),
      package_count: num(currentMetrics.package_count),
      fact_row_count: num(currentMetrics.fact_row_count),
    },
    priorMonth: priorMonthBlock,
    priorYear: priorYearBlock,
    ytd: {
      current_year_gallons: ytdCurrent.ytd_gallons,
      prior_year_gallons: ytdPriorGallons,
      delta_gallons: ytdDelta.delta_gallons,
      delta_pct: ytdDelta.delta_pct,
      months_included: ytdCurrent.months_included,
      months_missing: ytdCurrent.months_missing,
    },
    reopenCount,
    trend6,
    trend12,
    topCustomers,
    customerConcentration: {
      top_customer_share: concentration.top_customer_share,
      top_customer_name: concentration.top_customer_name,
      top5_share: concentration.top5_share,
      intercompany_share: concentration.intercompany_share,
      external_share: concentration.external_share,
    },
    customerMovers: shapeMovers(customerMovers),
    topPackages,
    categoryMix,
    packageMovers: shapeMovers(packageMovers),
    operatorNotes: operatorNotesView,
    alertSummary: {
      package_alerts_total: num(alertCounts.package_total),
      customer_alerts_total: num(alertCounts.customer_total),
      data_quality_alerts_total: num(alertCounts.dq_total),
      resolved_alerts_total: num(alertCounts.resolved_total),
      pending_alerts_total: num(alertCounts.pending_total),
    },
    lockHistory: lockHistory.map((e) => ({
      event_id: e.event_id,
      event_type: e.event_type,
      event_at: e.event_at,
      event_by: e.event_by,
      prior_status: e.prior_status,
      new_status: e.new_status,
      file_id: e.file_id,
      version_no: e.version_no,
      filename: e.filename,
    })),
    finance,
    volumeGoal,
  };
}

function shapeMovers(r: { topGainers: MoverOutputRow[]; topDecliners: MoverOutputRow[] }) {
  return {
    topGainers: r.topGainers.map((m) => ({ ...m })),
    topDecliners: r.topDecliners.map((m) => ({ ...m })),
  };
}
