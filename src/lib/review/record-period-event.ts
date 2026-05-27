/**
 * src/lib/review/record-period-event.ts
 *
 * PR 003G — Insert one row into u1d_ops.period_lock_events.
 *
 * Designed to run inside an EXISTING transaction. The accepted type is
 * `Pick<PoolClient, "query">` so the helper works with:
 *   - a pg PoolClient inside an open TX (lockPeriod / reopenPeriod)
 *   - a raw Pool reference for ad-hoc administrative use
 *   - a stub in tests
 *
 * The helper does NOT open a new connection, does NOT BEGIN, and does
 * NOT commit. Lock/reopen own the transaction lifecycle; this helper
 * is one statement inside it.
 */
import type { PoolClient, QueryResultRow } from "pg";
import {
  PeriodEventValidationError,
  type PeriodEventInput,
  type PeriodLockEvent,
  type PeriodEventType,
} from "./period-events-types";

const EVENT_TYPES: PeriodEventType[] = ["locked", "reopened"];

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

const INSERT_SQL = `
  INSERT INTO u1d_ops.period_lock_events (
    period_year,
    period_month,
    file_id,
    event_type,
    event_by,
    prior_status,
    new_status,
    reason,
    metadata
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
  RETURNING
    event_id,
    period_year,
    period_month,
    file_id,
    event_type,
    event_at,
    event_by,
    prior_status,
    new_status,
    reason,
    metadata
`;

export async function recordPeriodEvent(
  client: Pick<PoolClient, "query">,
  input: PeriodEventInput
): Promise<PeriodLockEvent> {
  const reasons: string[] = [];

  if (!Number.isInteger(input.periodYear) || input.periodYear < 2020 || input.periodYear > 2100) {
    reasons.push("invalid_period_year");
  }
  if (!Number.isInteger(input.periodMonth) || input.periodMonth < 1 || input.periodMonth > 12) {
    reasons.push("invalid_period_month");
  }
  if (typeof input.eventBy !== "string" || input.eventBy.trim().length === 0) {
    reasons.push("event_by_required");
  }
  if (!EVENT_TYPES.includes(input.eventType)) {
    reasons.push("invalid_event_type");
  }
  if (typeof input.newStatus !== "string" || input.newStatus.trim().length === 0) {
    reasons.push("new_status_required");
  }

  // Defensive: metadata must serialize. Caller already provides a plain object
  // but a circular reference or BigInt would explode at JSON.stringify here.
  const metadata = input.metadata ?? {};
  let metadataJson: string;
  try {
    metadataJson = JSON.stringify(metadata);
  } catch (err) {
    reasons.push(
      "metadata_not_serializable:" + (err instanceof Error ? err.message : "unknown")
    );
    metadataJson = "{}";
  }

  if (reasons.length > 0) {
    throw new PeriodEventValidationError(reasons);
  }

  const r = await client.query<DbRow>(INSERT_SQL, [
    input.periodYear,
    input.periodMonth,
    input.fileId, // BIGINT NULL — driver handles null
    input.eventType,
    input.eventBy.trim(),
    input.priorStatus ?? null,
    input.newStatus,
    input.reason ?? null,
    metadataJson,
  ]);

  const row = r.rows[0];
  return {
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
  };
}
