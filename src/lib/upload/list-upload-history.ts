/**
 * src/lib/upload/list-upload-history.ts
 *
 * PR 003C — Read helper for the admin upload history table.
 *
 * Source of truth: u1d_ops.volume_files (one row per ingested version)
 * joined to u1d_ops.board_periods so the UI can show the current period
 * status alongside the upload row. Rows ordered newest-first.
 *
 * Pure read function with dependency injection on the pool — same pattern
 * used by the allowlist helper and the version resolver. Tests stub the
 * pool directly.
 */
import type { Pool, QueryResultRow } from "pg";

export type UploadHistoryRow = {
  file_id: number;
  filename: string;
  file_hash: string;
  file_hash_prefix: string; // first 8 hex chars — already what we show on disk
  period_year: number;
  period_month: number;
  version_no: number;
  is_active: boolean;
  is_superseded: boolean;
  has_total_discrepancy: boolean;
  uploaded_at: string;       // ISO timestamp
  uploaded_by: string;
  staged_at: string | null;
  reviewed_at: string | null;
  locked_at: string | null;
  status: "open" | "staged" | "in_review" | "locked" | "superseded" | "reopened" | null;
};

type Row = QueryResultRow & {
  file_id: number | string;
  filename: string;
  file_hash: string;
  period_year: number;
  period_month: number;
  version_no: number;
  is_active: boolean;
  is_superseded: boolean;
  has_total_discrepancy: boolean;
  uploaded_at: Date | string;
  uploaded_by: string;
  staged_at: Date | string | null;
  reviewed_at: Date | string | null;
  locked_at: Date | string | null;
  status: string | null;
};

const HISTORY_QUERY = `
  SELECT
    vf.file_id::int                          AS file_id,
    vf.filename                              AS filename,
    vf.file_hash                             AS file_hash,
    vf.period_year::int                      AS period_year,
    vf.period_month::int                     AS period_month,
    vf.version_no::int                       AS version_no,
    vf.is_active                             AS is_active,
    vf.is_superseded                         AS is_superseded,
    vf.has_total_discrepancy                 AS has_total_discrepancy,
    vf.uploaded_at                           AS uploaded_at,
    vf.uploaded_by                           AS uploaded_by,
    vf.staged_at                             AS staged_at,
    vf.reviewed_at                           AS reviewed_at,
    vf.locked_at                             AS locked_at,
    bp.status                                AS status
  FROM u1d_ops.volume_files vf
  LEFT JOIN u1d_ops.board_periods bp
    ON bp.period_year = vf.period_year
   AND bp.period_month = vf.period_month
  ORDER BY vf.uploaded_at DESC, vf.file_id DESC
  LIMIT $1
`;

/**
 * Hard cap so a misconfigured caller can never ask for an unbounded scan.
 * The UI uses 20; the cap is generous for ad-hoc admin queries.
 */
export const MAX_HISTORY_LIMIT = 100;

function toIsoOrNull(v: Date | string | null): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return v; // already a string from pg's string-mode return
}

export async function listUploadHistory(
  pool: Pool,
  limit = 20
): Promise<UploadHistoryRow[]> {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`listUploadHistory: limit must be a positive integer, got ${limit}`);
  }
  const effective = Math.min(limit, MAX_HISTORY_LIMIT);
  const r = await pool.query<Row>(HISTORY_QUERY, [effective]);

  return r.rows.map((row): UploadHistoryRow => ({
    file_id: typeof row.file_id === "string" ? parseInt(row.file_id, 10) : row.file_id,
    filename: row.filename,
    file_hash: row.file_hash,
    file_hash_prefix: row.file_hash.slice(0, 8),
    period_year: row.period_year,
    period_month: row.period_month,
    version_no: row.version_no,
    is_active: row.is_active,
    is_superseded: row.is_superseded,
    has_total_discrepancy: row.has_total_discrepancy,
    uploaded_at: row.uploaded_at instanceof Date ? row.uploaded_at.toISOString() : row.uploaded_at,
    uploaded_by: row.uploaded_by,
    staged_at: toIsoOrNull(row.staged_at),
    reviewed_at: toIsoOrNull(row.reviewed_at),
    locked_at: toIsoOrNull(row.locked_at),
    status: (row.status ?? null) as UploadHistoryRow["status"],
  }));
}
