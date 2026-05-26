/**
 * src/lib/review/get-period-review.ts
 *
 * PR 003D — Aggregates everything the /admin/review/[year]/[month] page
 * needs in a single helper. Eight parallel queries against u1d_ops:
 *
 *   1. board_periods       — period status + audit timestamps
 *   2. active volume_files — file_id, version, hash, totals
 *   3. prior volume_files  — superseded versions for the same period
 *   4. alert counts        — single pivot query
 *   5. package_alerts      — pending list (for resolution UI)
 *   6. customer_alerts     — pending list
 *   7. data_quality_alerts — pending list
 *   8. volume_fact preview — JOINed to customers + packages
 *
 * Pure read function with dependency injection on the pool. Tests stub
 * the pool with pattern-matched responders.
 */
import type { Pool, QueryResultRow } from "pg";
import { getOperatorNotes } from "../operator-notes/get-operator-notes";
import type { OperatorNotes } from "../operator-notes/types";
import { evaluateReadiness } from "./readiness";
import { listPeriodEvents } from "./list-period-events";
import type { PeriodLockEventView } from "./period-events-types";
import type {
  PeriodReview,
  ActiveVolumeFile,
  VolumeFileVersion,
  PackageAlert,
  CustomerAlert,
  DataQualityAlert,
  VolumeFactPreview,
  AlertSummary,
  BoardPeriodStatus,
} from "./types";

const DEFAULT_FACT_LIMIT = 200;

type BoardPeriodRow = QueryResultRow & {
  status: string;
  locked_at: Date | string | null;
  locked_by: string | null;
  reviewed_at: Date | string | null;
  reviewed_by: string | null;
};

type VolumeFileRow = QueryResultRow & {
  file_id: number;
  filename: string;
  file_hash: string;
  version_no: number;
  is_active: boolean;
  is_superseded: boolean;
  uploaded_at: Date | string;
  uploaded_by: string;
  staged_at: Date | string | null;
  reviewed_at: Date | string | null;
  locked_at: Date | string | null;
  source_total_row: number | null;
  computed_customer_sum: number;
  has_total_discrepancy: boolean;
  discrepancy_amount: number | null;
};

type AlertCountsRow = QueryResultRow & {
  pending_package: number;
  pending_customer: number;
  pending_data_quality: number;
  resolved_total: number;
  total: number;
};

function toIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

function toIsoRequired(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : v;
}

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isNaN(n) ? fallback : n;
  }
  return fallback;
}

export async function getPeriodReview(
  pool: Pool,
  year: number,
  month: number,
  options?: { volumeFactLimit?: number }
): Promise<PeriodReview> {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new Error(`getPeriodReview: invalid year ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`getPeriodReview: invalid month ${month}`);
  }
  const factLimit = options?.volumeFactLimit ?? DEFAULT_FACT_LIMIT;

  const [
    periodRows,
    activeRows,
    priorRows,
    alertCountsRows,
    packageAlertRows,
    customerAlertRows,
    dqAlertRows,
    factRows,
    operatorNotes,
    periodEvents,
  ] = await Promise.all([
    pool.query<BoardPeriodRow>(
      `SELECT status, locked_at, locked_by, reviewed_at, reviewed_by
         FROM u1d_ops.board_periods
        WHERE period_year = $1 AND period_month = $2`,
      [year, month]
    ),
    pool.query<VolumeFileRow>(
      `SELECT
         file_id::int, filename, file_hash, version_no::int,
         is_active, is_superseded,
         uploaded_at, uploaded_by,
         staged_at, reviewed_at, locked_at,
         source_total_row::float8, computed_customer_sum::float8,
         has_total_discrepancy, discrepancy_amount::float8
       FROM u1d_ops.volume_files
       WHERE period_year = $1 AND period_month = $2 AND is_active = TRUE
       LIMIT 1`,
      [year, month]
    ),
    pool.query<VolumeFileRow>(
      `SELECT
         file_id::int, filename, file_hash, version_no::int,
         is_active, is_superseded,
         uploaded_at, uploaded_by,
         staged_at, reviewed_at, locked_at,
         source_total_row::float8, computed_customer_sum::float8,
         has_total_discrepancy, discrepancy_amount::float8
       FROM u1d_ops.volume_files
       WHERE period_year = $1 AND period_month = $2 AND is_active = FALSE
       ORDER BY version_no DESC`,
      [year, month]
    ),
    pool.query<AlertCountsRow>(
      `SELECT
         (SELECT COUNT(*) FROM u1d_ops.package_alerts pa
            JOIN u1d_ops.volume_files vf USING (file_id)
           WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE
             AND pa.status = 'pending')::int      AS pending_package,
         (SELECT COUNT(*) FROM u1d_ops.customer_alerts ca
            JOIN u1d_ops.volume_files vf USING (file_id)
           WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE
             AND ca.status = 'pending')::int      AS pending_customer,
         (SELECT COUNT(*) FROM u1d_ops.data_quality_alerts dqa
            JOIN u1d_ops.volume_files vf USING (file_id)
           WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE
             AND dqa.status = 'pending')::int     AS pending_data_quality,
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM u1d_ops.package_alerts pa
              JOIN u1d_ops.volume_files vf USING (file_id)
             WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE
               AND pa.status <> 'pending'
            UNION ALL
            SELECT 1 FROM u1d_ops.customer_alerts ca
              JOIN u1d_ops.volume_files vf USING (file_id)
             WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE
               AND ca.status <> 'pending'
            UNION ALL
            SELECT 1 FROM u1d_ops.data_quality_alerts dqa
              JOIN u1d_ops.volume_files vf USING (file_id)
             WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE
               AND dqa.status <> 'pending'
         ) s)::int                                AS resolved_total,
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM u1d_ops.package_alerts pa
              JOIN u1d_ops.volume_files vf USING (file_id)
             WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE
            UNION ALL
            SELECT 1 FROM u1d_ops.customer_alerts ca
              JOIN u1d_ops.volume_files vf USING (file_id)
             WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE
            UNION ALL
            SELECT 1 FROM u1d_ops.data_quality_alerts dqa
              JOIN u1d_ops.volume_files vf USING (file_id)
             WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE
         ) t)::int                                AS total`,
      [year, month]
    ),
    pool.query(
      `SELECT pa.alert_id::int, pa.file_id::int,
              pa.raw_label, pa.gallons_observed::float8, pa.status,
              pa.mapped_to_package_key, pa.resolved_by, pa.resolved_at,
              pa.notes, pa.created_at
         FROM u1d_ops.package_alerts pa
         JOIN u1d_ops.volume_files vf USING (file_id)
        WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE
          AND pa.status = 'pending'
        ORDER BY pa.alert_id ASC`,
      [year, month]
    ),
    pool.query(
      `SELECT ca.alert_id::int, ca.file_id::int,
              ca.raw_label, ca.gallons_observed::float8, ca.status,
              ca.mapped_to_customer_key, ca.resolved_by, ca.resolved_at,
              ca.notes, ca.created_at
         FROM u1d_ops.customer_alerts ca
         JOIN u1d_ops.volume_files vf USING (file_id)
        WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE
          AND ca.status = 'pending'
        ORDER BY ca.alert_id ASC`,
      [year, month]
    ),
    pool.query(
      `SELECT dqa.alert_id::int, dqa.file_id::int,
              dqa.alert_kind, dqa.severity, dqa.message, dqa.payload,
              dqa.status, dqa.resolved_by, dqa.resolved_at, dqa.created_at
         FROM u1d_ops.data_quality_alerts dqa
         JOIN u1d_ops.volume_files vf USING (file_id)
        WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE
          AND dqa.status = 'pending'
        ORDER BY dqa.alert_id ASC`,
      [year, month]
    ),
    pool.query(
      `SELECT
         c.customer_key, c.display_name AS customer_display_name, c.is_intercompany,
         p.package_key, p.display_name AS package_display_name, p.family,
         vf_facts.gallons::float8 AS gallons
       FROM u1d_ops.volume_files vf
       JOIN u1d_ops.volume_fact vf_facts ON vf_facts.file_id = vf.file_id
       JOIN u1d_ops.customers c ON c.customer_key = vf_facts.customer_key
       JOIN u1d_ops.packages p  ON p.package_key  = vf_facts.package_key
      WHERE vf.period_year = $1 AND vf.period_month = $2 AND vf.is_active = TRUE
      ORDER BY vf_facts.gallons DESC NULLS LAST
      LIMIT $3`,
      [year, month, factLimit]
    ),
    getOperatorNotes(pool, year, month),
    listPeriodEvents(pool, year, month, 50),
  ]);

  // -----------------------------------------------------------------------
  // Shape into typed results
  // -----------------------------------------------------------------------

  const periodRow = periodRows.rows[0] ?? null;
  const activeRow = activeRows.rows[0] ?? null;

  const activeFile: ActiveVolumeFile | null = activeRow
    ? {
        file_id: activeRow.file_id,
        filename: activeRow.filename,
        file_hash: activeRow.file_hash,
        file_hash_prefix: activeRow.file_hash.slice(0, 8),
        version_no: activeRow.version_no,
        uploaded_at: toIsoRequired(activeRow.uploaded_at),
        uploaded_by: activeRow.uploaded_by,
        staged_at: toIso(activeRow.staged_at),
        reviewed_at: toIso(activeRow.reviewed_at),
        locked_at: toIso(activeRow.locked_at),
        source_total_row: activeRow.source_total_row,
        computed_customer_sum: asNumber(activeRow.computed_customer_sum),
        has_total_discrepancy: activeRow.has_total_discrepancy,
        discrepancy_amount: activeRow.discrepancy_amount,
        total_gallons: asNumber(activeRow.computed_customer_sum),
      }
    : null;

  const priorVersions: VolumeFileVersion[] = priorRows.rows.map((r) => ({
    file_id: r.file_id,
    filename: r.filename,
    version_no: r.version_no,
    is_active: r.is_active,
    is_superseded: r.is_superseded,
    uploaded_at: toIsoRequired(r.uploaded_at),
    uploaded_by: r.uploaded_by,
    file_hash_prefix: r.file_hash.slice(0, 8),
    has_total_discrepancy: r.has_total_discrepancy,
  }));

  const cnt = alertCountsRows.rows[0] ?? {
    pending_package: 0,
    pending_customer: 0,
    pending_data_quality: 0,
    resolved_total: 0,
    total: 0,
  };
  const alertSummary: AlertSummary = {
    pendingPackageAlerts: asNumber(cnt.pending_package),
    pendingCustomerAlerts: asNumber(cnt.pending_customer),
    pendingDataQualityAlerts: asNumber(cnt.pending_data_quality),
    resolvedAlerts: asNumber(cnt.resolved_total),
    totalAlerts: asNumber(cnt.total),
  };

  const packageAlerts: PackageAlert[] = packageAlertRows.rows.map((r) => ({
    alert_id: r.alert_id as number,
    file_id: r.file_id as number,
    raw_label: r.raw_label as string,
    gallons_observed: asNumber(r.gallons_observed),
    status: r.status as PackageAlert["status"],
    mapped_to_package_key: (r.mapped_to_package_key as string | null) ?? null,
    resolved_by: (r.resolved_by as string | null) ?? null,
    resolved_at: toIso(r.resolved_at as Date | string | null),
    notes: (r.notes as string | null) ?? null,
    created_at: toIsoRequired(r.created_at as Date | string),
  }));

  const customerAlerts: CustomerAlert[] = customerAlertRows.rows.map((r) => ({
    alert_id: r.alert_id as number,
    file_id: r.file_id as number,
    raw_label: r.raw_label as string,
    gallons_observed: asNumber(r.gallons_observed),
    status: r.status as CustomerAlert["status"],
    mapped_to_customer_key: (r.mapped_to_customer_key as string | null) ?? null,
    resolved_by: (r.resolved_by as string | null) ?? null,
    resolved_at: toIso(r.resolved_at as Date | string | null),
    notes: (r.notes as string | null) ?? null,
    created_at: toIsoRequired(r.created_at as Date | string),
  }));

  const dataQualityAlerts: DataQualityAlert[] = dqAlertRows.rows.map((r) => ({
    alert_id: r.alert_id as number,
    file_id: r.file_id as number,
    alert_kind: r.alert_kind as string,
    severity: r.severity as DataQualityAlert["severity"],
    message: r.message as string,
    payload: (r.payload as Record<string, unknown> | null) ?? null,
    status: r.status as DataQualityAlert["status"],
    resolved_by: (r.resolved_by as string | null) ?? null,
    resolved_at: toIso(r.resolved_at as Date | string | null),
    created_at: toIsoRequired(r.created_at as Date | string),
  }));

  const volumeFacts: VolumeFactPreview[] = factRows.rows.map((r) => ({
    customer_key: r.customer_key as string,
    customer_display_name: r.customer_display_name as string,
    is_intercompany: r.is_intercompany as boolean,
    package_key: r.package_key as string,
    package_display_name: r.package_display_name as string,
    family: r.family as string,
    gallons: asNumber(r.gallons),
  }));

  // -----------------------------------------------------------------------
  // Compute lock readiness via the single-source-of-truth evaluateReadiness().
  // Same module is consumed by /api/period/[year]/[month]/readiness and by
  // lockPeriod() inside its transaction, so the UI button, the deck-readiness
  // contract, and the actual lock gate agree on the same rules.
  // -----------------------------------------------------------------------

  const readiness = evaluateReadiness({
    hasActiveFile: !!activeFile,
    hasBoardPeriodRow: !!periodRow,
    isAlreadyLocked: periodRow?.status === "locked",
    pendingPackageAlerts: alertSummary.pendingPackageAlerts,
    pendingCustomerAlerts: alertSummary.pendingCustomerAlerts,
    pendingDataQualityAlerts: alertSummary.pendingDataQualityAlerts,
    operatorNotesExists: operatorNotes.exists,
    operatorNotesComplete: operatorNotes.is_complete,
  });
  const canLock = readiness.ready;
  const lockBlockedReasons = readiness.blockers;

  return {
    operatorNotes,
    periodEvents,
    period: {
      year,
      month,
      status: (periodRow?.status as BoardPeriodStatus | undefined) ?? null,
      locked_at: toIso(periodRow?.locked_at ?? null),
      locked_by: periodRow?.locked_by ?? null,
      reviewed_at: toIso(periodRow?.reviewed_at ?? null),
      reviewed_by: periodRow?.reviewed_by ?? null,
    },
    activeFile,
    priorVersions,
    alertSummary,
    packageAlerts,
    customerAlerts,
    dataQualityAlerts,
    volumeFacts,
    canLock,
    lockBlockedReasons,
  };
}
