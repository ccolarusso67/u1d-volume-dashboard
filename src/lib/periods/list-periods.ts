/**
 * src/lib/periods/list-periods.ts
 *
 * PR 003F — Listing helper for the /admin/periods index.
 *
 * Source: u1d_ops.board_periods (one row per tracked period). LEFT JOINs
 * pull the active volume_files row and the monthly_operator_notes row;
 * subqueries count pending alerts per period.
 *
 * Readiness + nextAction are computed in JS from the joined columns via
 * evaluateReadiness(), so the index button mirrors what the lock helper
 * and the readiness endpoint would say.
 */
import type { Pool, QueryResultRow } from "pg";
import { evaluateReadiness } from "../review/readiness";

export type NextActionTone = "primary" | "warning" | "neutral" | "success";

export type PeriodIndexRow = {
  period: {
    year: number;
    month: number;
    label: string;
  };
  status: string | null;
  activeFile: {
    file_id: number;
    filename: string;
    version_no: number;
    uploaded_at: string | null;
    uploaded_by: string | null;
    file_hash_prefix: string;
  } | null;
  alertCounts: {
    pending_package: number;
    pending_customer: number;
    pending_data_quality: number;
  };
  operatorNotes: {
    exists: boolean;
    complete: boolean;
    completed_at: string | null;
    completed_by: string | null;
  };
  readiness: {
    ready: boolean;
    blockers: string[];
  };
  nextAction: {
    label: string;
    href: string;
    tone: NextActionTone;
  };
};

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type DbRow = QueryResultRow & {
  period_year: number;
  period_month: number;
  status: string | null;
  file_id: number | null;
  filename: string | null;
  version_no: number | null;
  uploaded_at: Date | string | null;
  uploaded_by: string | null;
  file_hash: string | null;
  pending_package: number;
  pending_customer: number;
  pending_data_quality: number;
  notes_exists: boolean;
  notes_complete: boolean;
  notes_completed_at: Date | string | null;
  notes_completed_by: string | null;
};

const QUERY = `
  SELECT
    bp.period_year::int                       AS period_year,
    bp.period_month::int                      AS period_month,
    bp.status                                 AS status,

    vf.file_id::int                           AS file_id,
    vf.filename                               AS filename,
    vf.version_no::int                        AS version_no,
    vf.uploaded_at                            AS uploaded_at,
    vf.uploaded_by                            AS uploaded_by,
    vf.file_hash                              AS file_hash,

    COALESCE((
      SELECT COUNT(*) FROM u1d_ops.package_alerts pa
       WHERE pa.file_id = vf.file_id AND pa.status = 'pending'
    ), 0)::int                                AS pending_package,
    COALESCE((
      SELECT COUNT(*) FROM u1d_ops.customer_alerts ca
       WHERE ca.file_id = vf.file_id AND ca.status = 'pending'
    ), 0)::int                                AS pending_customer,
    COALESCE((
      SELECT COUNT(*) FROM u1d_ops.data_quality_alerts dqa
       WHERE dqa.file_id = vf.file_id AND dqa.status = 'pending'
    ), 0)::int                                AS pending_data_quality,

    (mon.period_year IS NOT NULL)             AS notes_exists,
    COALESCE(
      mon.completed_at IS NOT NULL
        AND length(coalesce(trim(mon.capacity_md), '')) > 0
        AND length(coalesce(trim(mon.supply_chain_md), '')) > 0
        AND length(coalesce(trim(mon.quality_md), '')) > 0
        AND length(coalesce(trim(mon.initiatives_md), '')) > 0
        AND length(coalesce(trim(mon.risks_md), '')) > 0,
      FALSE
    )                                          AS notes_complete,
    mon.completed_at                          AS notes_completed_at,
    mon.completed_by                          AS notes_completed_by

  FROM u1d_ops.board_periods bp
  LEFT JOIN u1d_ops.volume_files vf
    ON vf.period_year = bp.period_year
   AND vf.period_month = bp.period_month
   AND vf.is_active = TRUE
  LEFT JOIN u1d_ops.monthly_operator_notes mon
    ON mon.period_year = bp.period_year
   AND mon.period_month = bp.period_month

  ORDER BY bp.period_year DESC, bp.period_month DESC
  LIMIT $1
`;

function periodLabel(year: number, month: number): string {
  const m = MONTHS_EN[month - 1] ?? `Month ${month}`;
  return `${m} ${year}`;
}

function toIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

/**
 * Decide the most useful next action for an operator looking at this period.
 *
 * Ordering of checks reflects the operator's natural sequence: get the file
 * in, kill alerts, complete notes, lock. Locked periods → view-only.
 *
 * Returns label + href + tone; the UI renders a button with the matching
 * palette.
 */
function pickNextAction(
  year: number,
  month: number,
  status: string | null,
  hasActiveFile: boolean,
  pendingPackage: number,
  pendingCustomer: number,
  pendingDq: number,
  notesExists: boolean,
  notesComplete: boolean,
  ready: boolean
): PeriodIndexRow["nextAction"] {
  if (status === "locked") {
    return {
      label: "View locked report",
      href: `/admin/review/${year}/${month}`,
      tone: "success",
    };
  }
  if (!hasActiveFile) {
    return {
      label: "Upload",
      href: `/admin/upload`,
      tone: "primary",
    };
  }
  if (pendingPackage + pendingCustomer + pendingDq > 0) {
    return {
      label: "Resolve alerts",
      href: `/admin/review/${year}/${month}`,
      tone: "warning",
    };
  }
  if (!notesExists || !notesComplete) {
    return {
      label: "Complete notes",
      href: `/admin/operator-notes/${year}/${month}`,
      tone: "primary",
    };
  }
  if (ready) {
    return {
      label: "Lock ready",
      href: `/admin/review/${year}/${month}`,
      tone: "primary",
    };
  }
  return {
    label: "Review",
    href: `/admin/review/${year}/${month}`,
    tone: "neutral",
  };
}

export async function listPeriods(
  pool: Pool,
  options?: { limit?: number }
): Promise<PeriodIndexRow[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 60, 240));
  const r = await pool.query<DbRow>(QUERY, [limit]);
  return r.rows.map((row): PeriodIndexRow => {
    const hasActiveFile = row.file_id !== null;
    const readiness = evaluateReadiness({
      hasActiveFile,
      hasBoardPeriodRow: true, // joined from board_periods; always present
      isAlreadyLocked: row.status === "locked",
      pendingPackageAlerts: row.pending_package,
      pendingCustomerAlerts: row.pending_customer,
      pendingDataQualityAlerts: row.pending_data_quality,
      operatorNotesExists: row.notes_exists,
      operatorNotesComplete: row.notes_complete,
    });
    return {
      period: {
        year: row.period_year,
        month: row.period_month,
        label: periodLabel(row.period_year, row.period_month),
      },
      status: row.status,
      activeFile: hasActiveFile
        ? {
            file_id: row.file_id!,
            filename: row.filename ?? "",
            version_no: row.version_no ?? 0,
            uploaded_at: toIso(row.uploaded_at),
            uploaded_by: row.uploaded_by,
            file_hash_prefix: (row.file_hash ?? "").slice(0, 8),
          }
        : null,
      alertCounts: {
        pending_package: row.pending_package,
        pending_customer: row.pending_customer,
        pending_data_quality: row.pending_data_quality,
      },
      operatorNotes: {
        exists: row.notes_exists,
        complete: row.notes_complete,
        completed_at: toIso(row.notes_completed_at),
        completed_by: row.notes_completed_by,
      },
      readiness,
      nextAction: pickNextAction(
        row.period_year,
        row.period_month,
        row.status,
        hasActiveFile,
        row.pending_package,
        row.pending_customer,
        row.pending_data_quality,
        row.notes_exists,
        row.notes_complete,
        readiness.ready
      ),
    };
  });
}
