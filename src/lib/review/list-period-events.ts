/**
 * src/lib/review/list-period-events.ts
 *
 * PR 003G — Read helper for u1d_ops.period_lock_events.
 *
 * Returns events newest-first for the review page's Lock history panel.
 * Filename / version_no are LEFT-JOINed from volume_files so a deleted
 * or missing file_id surfaces as null without throwing.
 */
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type {
  PeriodEventType,
  PeriodLockEventView,
} from "./period-events-types";

type DbRow = QueryResultRow & {
  event_id: number | string;
  period_year: number;
  period_month: number;
  file_id: number | string | null;
  event_type: string;
  event_at: Date | string;
  event_by: string;
  prior_status: string | null;
  new_status: string;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  filename: string | null;
  version_no: number | null;
};

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : v;
}

function asNumber(v: number | string | null): number | null {
  if (v === null) return null;
  if (typeof v === "number") return v;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

const MAX_LIMIT = 100;

export async function listPeriodEvents(
  poolOrClient: Pick<Pool | PoolClient, "query">,
  year: number,
  month: number,
  limit = 20
): Promise<PeriodLockEventView[]> {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new Error(`listPeriodEvents: invalid year ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`listPeriodEvents: invalid month ${month}`);
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`listPeriodEvents: limit must be a positive integer, got ${limit}`);
  }
  const effective = Math.min(limit, MAX_LIMIT);

  const r = await poolOrClient.query<DbRow>(
    `SELECT
       e.event_id::bigint AS event_id,
       e.period_year::int  AS period_year,
       e.period_month::int AS period_month,
       e.file_id::bigint   AS file_id,
       e.event_type        AS event_type,
       e.event_at          AS event_at,
       e.event_by          AS event_by,
       e.prior_status      AS prior_status,
       e.new_status        AS new_status,
       e.reason            AS reason,
       e.metadata          AS metadata,
       vf.filename         AS filename,
       vf.version_no::int  AS version_no
     FROM u1d_ops.period_lock_events e
     LEFT JOIN u1d_ops.volume_files vf ON vf.file_id = e.file_id
     WHERE e.period_year = $1 AND e.period_month = $2
     ORDER BY e.event_at DESC, e.event_id DESC
     LIMIT $3`,
    [year, month, effective]
  );

  return r.rows.map((row): PeriodLockEventView => ({
    event_id: asNumber(row.event_id) ?? 0,
    period_year: row.period_year,
    period_month: row.period_month,
    file_id: asNumber(row.file_id),
    event_type: row.event_type as PeriodEventType,
    event_at: toIso(row.event_at),
    event_by: row.event_by,
    prior_status: row.prior_status,
    new_status: row.new_status,
    reason: row.reason,
    metadata: row.metadata ?? {},
    filename: row.filename,
    version_no: row.version_no,
  }));
}
