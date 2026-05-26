/**
 * src/lib/board/get-board-period.ts
 *
 * PR 004A — Aggregator for the executive monthly dashboard.
 *
 * Returns a BoardPeriodView whether the period is board-ready or blocked.
 * The UI branches on readiness.ready. Both branches share the same shape
 * so the page renders one component with conditional sections.
 *
 * Source-of-truth rules:
 *   1. ALL board metrics come from u1d_ops.volume_fact JOINed through
 *      u1d_ops.volume_files WHERE is_active = TRUE AND locked_at IS NOT NULL.
 *      Superseded files are never read. Unlocked files are never read.
 *   2. Prior-month comparison applies the same filter to the prior calendar
 *      month. Missing prior locked file → all prior_* fields null.
 *   3. Readiness blockers come from the shared evaluateReadiness() so the
 *      board page agrees with the admin review page and the lock helper.
 */
import type { Pool, QueryResultRow } from "pg";
import { evaluateReadiness } from "../review/readiness";
import { listPeriodEvents } from "../review/list-period-events";
import { getOperatorNotes } from "../operator-notes/get-operator-notes";
import { SECTION_KEYS, type SectionKey } from "../operator-notes/types";
import {
  monthLabel,
  priorMonth,
  calculateShare,
  monthOverMonth,
} from "./metrics";
import type { BoardPeriodView } from "./types";

const TOP_N = 10;

type ActiveFileRow = QueryResultRow & {
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

type BoardPeriodRow = QueryResultRow & {
  status: string;
  locked_at: Date | string | null;
  locked_by: string | null;
};

type AggregateRow = QueryResultRow & {
  total_gallons: number;
  customer_count: number;
  package_count: number;
  fact_row_count: number;
};

type CustomerSliceRow = QueryResultRow & {
  customer_key: string;
  customer_name: string;
  gallons: number;
};

type PackageSliceRow = QueryResultRow & {
  package_key: string;
  package_label: string;
  gallons: number;
};

type AlertCountsRow = QueryResultRow & {
  package_total: number;
  customer_total: number;
  dq_total: number;
  pending_total: number;
  resolved_total: number;
};

function toIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Query SQL — kept in module scope so each query is auditable in one place.
// All queries that hit volume_fact filter on is_active=TRUE AND locked_at IS
// NOT NULL — superseded or unlocked data must never reach the board.
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

const AGGREGATE_SQL = `
  SELECT
    COALESCE(SUM(vf.gallons), 0)::float8                              AS total_gallons,
    COUNT(DISTINCT vf.customer_key)::int                              AS customer_count,
    COUNT(DISTINCT vf.package_key)::int                               AS package_count,
    COUNT(*)::int                                                     AS fact_row_count
  FROM u1d_ops.volume_fact vf
  JOIN u1d_ops.volume_files file
    ON file.file_id = vf.file_id
  WHERE file.period_year = $1
    AND file.period_month = $2
    AND file.is_active = TRUE
    AND file.locked_at IS NOT NULL
`;

const TOP_CUSTOMERS_SQL = `
  SELECT vf.customer_key, COALESCE(c.display_name, vf.customer_key) AS customer_name,
         SUM(vf.gallons)::float8 AS gallons
    FROM u1d_ops.volume_fact vf
    JOIN u1d_ops.volume_files file ON file.file_id = vf.file_id
    LEFT JOIN u1d_ops.customers c  ON c.customer_key = vf.customer_key
   WHERE file.period_year = $1
     AND file.period_month = $2
     AND file.is_active = TRUE
     AND file.locked_at IS NOT NULL
   GROUP BY vf.customer_key, c.display_name
   ORDER BY SUM(vf.gallons) DESC NULLS LAST
   LIMIT $3
`;

const TOP_PACKAGES_SQL = `
  SELECT vf.package_key, COALESCE(p.display_name, vf.package_key) AS package_label,
         SUM(vf.gallons)::float8 AS gallons
    FROM u1d_ops.volume_fact vf
    JOIN u1d_ops.volume_files file ON file.file_id = vf.file_id
    LEFT JOIN u1d_ops.packages p   ON p.package_key = vf.package_key
   WHERE file.period_year = $1
     AND file.period_month = $2
     AND file.is_active = TRUE
     AND file.locked_at IS NOT NULL
   GROUP BY vf.package_key, p.display_name
   ORDER BY SUM(vf.gallons) DESC NULLS LAST
   LIMIT $3
`;

// Prior-month per-customer + per-package slices — used to compute deltas
// against the current top-N rows.
const PRIOR_BY_CUSTOMER_SQL = `
  SELECT vf.customer_key, SUM(vf.gallons)::float8 AS gallons
    FROM u1d_ops.volume_fact vf
    JOIN u1d_ops.volume_files file ON file.file_id = vf.file_id
   WHERE file.period_year = $1
     AND file.period_month = $2
     AND file.is_active = TRUE
     AND file.locked_at IS NOT NULL
   GROUP BY vf.customer_key
`;

const PRIOR_BY_PACKAGE_SQL = `
  SELECT vf.package_key, SUM(vf.gallons)::float8 AS gallons
    FROM u1d_ops.volume_fact vf
    JOIN u1d_ops.volume_files file ON file.file_id = vf.file_id
   WHERE file.period_year = $1
     AND file.period_month = $2
     AND file.is_active = TRUE
     AND file.locked_at IS NOT NULL
   GROUP BY vf.package_key
`;

const ALERT_COUNTS_SQL = `
  SELECT
    COALESCE((
      SELECT COUNT(*) FROM u1d_ops.package_alerts pa
        JOIN u1d_ops.volume_files vf USING (file_id)
       WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE
    ), 0)::int AS package_total,
    COALESCE((
      SELECT COUNT(*) FROM u1d_ops.customer_alerts ca
        JOIN u1d_ops.volume_files vf USING (file_id)
       WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE
    ), 0)::int AS customer_total,
    COALESCE((
      SELECT COUNT(*) FROM u1d_ops.data_quality_alerts dqa
        JOIN u1d_ops.volume_files vf USING (file_id)
       WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE
    ), 0)::int AS dq_total,
    COALESCE((
      SELECT COUNT(*) FROM (
        SELECT 1 FROM u1d_ops.package_alerts pa
          JOIN u1d_ops.volume_files vf USING (file_id)
         WHERE vf.period_year = $1 AND vf.period_month = $2
           AND vf.is_active = TRUE AND pa.status = 'pending'
        UNION ALL
        SELECT 1 FROM u1d_ops.customer_alerts ca
          JOIN u1d_ops.volume_files vf USING (file_id)
         WHERE vf.period_year = $1 AND vf.period_month = $2
           AND vf.is_active = TRUE AND ca.status = 'pending'
        UNION ALL
        SELECT 1 FROM u1d_ops.data_quality_alerts dqa
          JOIN u1d_ops.volume_files vf USING (file_id)
         WHERE vf.period_year = $1 AND vf.period_month = $2
           AND vf.is_active = TRUE AND dqa.status = 'pending'
      ) p
    ), 0)::int AS pending_total,
    COALESCE((
      SELECT COUNT(*) FROM (
        SELECT 1 FROM u1d_ops.package_alerts pa
          JOIN u1d_ops.volume_files vf USING (file_id)
         WHERE vf.period_year = $1 AND vf.period_month = $2
           AND vf.is_active = TRUE AND pa.status <> 'pending'
        UNION ALL
        SELECT 1 FROM u1d_ops.customer_alerts ca
          JOIN u1d_ops.volume_files vf USING (file_id)
         WHERE vf.period_year = $1 AND vf.period_month = $2
           AND vf.is_active = TRUE AND ca.status <> 'pending'
        UNION ALL
        SELECT 1 FROM u1d_ops.data_quality_alerts dqa
          JOIN u1d_ops.volume_files vf USING (file_id)
         WHERE vf.period_year = $1 AND vf.period_month = $2
           AND vf.is_active = TRUE AND dqa.status <> 'pending'
      ) r
    ), 0)::int AS resolved_total
`;

// ---------------------------------------------------------------------------

export async function getBoardPeriod(
  pool: Pick<Pool, "query">,
  year: number,
  month: number
): Promise<BoardPeriodView> {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new RangeError(`getBoardPeriod: invalid year ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`getBoardPeriod: invalid month ${month}`);
  }

  const prior = priorMonth(year, month);

  // 8 queries in parallel. Postgres handles the fan-out cleanly; the pool's
  // connection limit caps concurrency. Each subquery is bounded and uses
  // existing indexes (period_year, period_month on volume_files;
  // file_id on volume_fact).
  const [
    boardRows,
    activeRows,
    aggregateRows,
    topCustomerRows,
    topPackageRows,
    priorAggregateRows,
    priorByCustomerRows,
    priorByPackageRows,
    alertCountsRows,
    operatorNotes,
    lockHistory,
  ] = await Promise.all([
    pool.query<BoardPeriodRow>(BOARD_PERIOD_SQL, [year, month]),
    pool.query<ActiveFileRow>(ACTIVE_FILE_SQL, [year, month]),
    pool.query<AggregateRow>(AGGREGATE_SQL, [year, month]),
    pool.query<CustomerSliceRow>(TOP_CUSTOMERS_SQL, [year, month, TOP_N]),
    pool.query<PackageSliceRow>(TOP_PACKAGES_SQL, [year, month, TOP_N]),
    pool.query<AggregateRow>(AGGREGATE_SQL, [prior.year, prior.month]),
    pool.query<{ customer_key: string; gallons: number }>(PRIOR_BY_CUSTOMER_SQL, [prior.year, prior.month]),
    pool.query<{ package_key: string; gallons: number }>(PRIOR_BY_PACKAGE_SQL, [prior.year, prior.month]),
    pool.query<AlertCountsRow>(ALERT_COUNTS_SQL, [year, month]),
    // Reuse Phase-1 helpers. Both already type their return cleanly.
    getOperatorNotes(pool as Pool, year, month),
    listPeriodEvents(pool as Pool, year, month, 50),
  ]);

  const boardRow = boardRows.rows[0] ?? null;
  const activeRow = activeRows.rows[0] ?? null;
  const agg = aggregateRows.rows[0] ?? { total_gallons: 0, customer_count: 0, package_count: 0, fact_row_count: 0 };
  const priorAgg = priorAggregateRows.rows[0] ?? null;
  const alertCounts = alertCountsRows.rows[0] ?? {
    package_total: 0, customer_total: 0, dq_total: 0, pending_total: 0, resolved_total: 0,
  };

  // Prior-month aggregate is only meaningful if a prior LOCKED active file
  // exists. We detect that by checking whether the prior aggregate returned
  // any volume facts. Zero-row prior periods produce zero gallons, which is
  // ambiguous (could mean "no fact rows" or "no locked file"). Discriminate
  // via the per-customer slice: empty array iff no locked file existed.
  const priorHasLockedFile = priorByCustomerRows.rows.length > 0;
  const priorMonthTotal = priorHasLockedFile ? num(priorAgg?.total_gallons) : null;

  // Build lookup maps for prior slices.
  const priorByCustomer = new Map<string, number>(
    priorByCustomerRows.rows.map((r) => [r.customer_key, num(r.gallons)])
  );
  const priorByPackage = new Map<string, number>(
    priorByPackageRows.rows.map((r) => [r.package_key, num(r.gallons)])
  );

  const totalGallons = num(agg.total_gallons);
  // When no prior locked file exists, hide both delta fields. monthOverMonth
  // is a pure utility that returns delta = current when prior is null; for
  // board display, "no prior available" means both fields should be null.
  const mom = priorMonthTotal !== null
    ? monthOverMonth(totalGallons, priorMonthTotal)
    : { delta_gallons: null, delta_pct: null };

  // Compose top-customers + top-packages with deltas.
  const topCustomers: BoardPeriodView["topCustomers"] = topCustomerRows.rows.map((r) => {
    const gallons = num(r.gallons);
    const priorG = priorHasLockedFile ? (priorByCustomer.get(r.customer_key) ?? 0) : null;
    const m = priorG !== null
      ? monthOverMonth(gallons, priorG)
      : { delta_gallons: null, delta_pct: null };
    return {
      customer_key: r.customer_key,
      customer_name: r.customer_name,
      gallons,
      share_pct: calculateShare(gallons, totalGallons),
      prior_month_gallons: priorG,
      delta_gallons: m.delta_gallons,
      delta_pct: m.delta_pct,
    };
  });

  const topPackages: BoardPeriodView["topPackages"] = topPackageRows.rows.map((r) => {
    const gallons = num(r.gallons);
    const priorG = priorHasLockedFile ? (priorByPackage.get(r.package_key) ?? 0) : null;
    const m = priorG !== null
      ? monthOverMonth(gallons, priorG)
      : { delta_gallons: null, delta_pct: null };
    return {
      package_key: r.package_key,
      package_label: r.package_label,
      gallons,
      share_pct: calculateShare(gallons, totalGallons),
      prior_month_gallons: priorG,
      delta_gallons: m.delta_gallons,
      delta_pct: m.delta_pct,
    };
  });

  // Readiness — single source of truth.
  const readiness = evaluateReadiness({
    hasActiveFile: !!activeRow,
    hasBoardPeriodRow: !!boardRow,
    isAlreadyLocked: boardRow?.status === "locked",
    pendingPackageAlerts: 0, // computed via the SQL subquery below
    pendingCustomerAlerts: 0,
    pendingDataQualityAlerts: 0,
    operatorNotesExists: operatorNotes.exists,
    operatorNotesComplete: operatorNotes.is_complete,
  });

  // The board treats `already_locked` as the GOOD state, not a blocker.
  // Strip it from the blocker list and flip `ready` accordingly.
  const blockers = readiness.blockers.filter((b) => b !== "already_locked");
  // Add pending-alert blockers from the dedicated count query (more precise).
  if (alertCounts.pending_total > 0) {
    // Hide the boolean readiness signal (which read 0 above) and fill in
    // real counts. Order matches PR 003E for stable consumers.
    // We don't subdivide by kind here because the page's tooltip uses the
    // detailed counts from alertSummary.
    blockers.push(`pending_alerts_total:${alertCounts.pending_total}`);
  }
  // Board-ready = period status must be 'locked' AND no other blockers.
  const isLocked = boardRow?.status === "locked";
  const ready = isLocked && blockers.length === 0;
  // When NOT locked we surface the locked-state blocker so the UI shows
  // "this period is not yet locked" rather than silently treating it as ready.
  if (!isLocked) {
    blockers.unshift("period_not_locked");
  }

  // Operator notes mapped to UI section keys + completion fields.
  const operatorNotesView = operatorNotes.exists
    ? ({
        ...(Object.fromEntries(
          SECTION_KEYS.map((k) => [k, operatorNotes.sections[k] ?? ""])
        ) as Record<SectionKey, string>),
        completed_at: operatorNotes.completed_at,
        completed_by: operatorNotes.completed_by,
      })
    : null;

  return {
    period: {
      year,
      month,
      label: monthLabel(year, month),
      status: boardRow?.status ?? null,
      locked_at: toIso(boardRow?.locked_at ?? null),
      locked_by: boardRow?.locked_by ?? null,
    },
    readiness: { ready, blockers },
    activeFile: activeRow
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
      : null,
    headlineMetrics: {
      total_gallons: totalGallons,
      prior_month_total_gallons: priorMonthTotal,
      month_over_month_delta_gallons: mom.delta_gallons,
      month_over_month_delta_pct: mom.delta_pct,
      customer_count: num(agg.customer_count),
      package_count: num(agg.package_count),
      fact_row_count: num(agg.fact_row_count),
    },
    topCustomers,
    topPackages,
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
  };
}
