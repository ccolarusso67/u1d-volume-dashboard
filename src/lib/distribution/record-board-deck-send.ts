/**
 * src/lib/distribution/record-board-deck-send.ts
 *
 * PR 004D — Append-only write helper for u1d_ops.board_deck_sends.
 *
 * Used for both successful sends AND failed attempts. Callers should write
 * an audit row even on failure so distribution attempts are never lost.
 */
import type { Pool, QueryResultRow } from "pg";
import type { BoardDeckSendRecord, RecordSendInput } from "./types";

type DbRow = QueryResultRow & {
  send_id: number | string;
  period_year: number;
  period_month: number;
  file_id: number | string | null;
  version_no: number | null;
  deck_filename: string;
  distribution_list_id: number | string | null;
  sent_at: Date | string;
  sent_by: string;
  provider: string;
  provider_message_id: string | null;
  subject: string;
  to_emails: string[];
  cc_emails: string[];
  bcc_count: number;
  status: "sent" | "failed";
  error_message: string | null;
  metadata: Record<string, unknown> | null;
};

const INSERT_SQL = `
  INSERT INTO u1d_ops.board_deck_sends (
    period_year, period_month, file_id, version_no, deck_filename,
    distribution_list_id, sent_by, provider, provider_message_id,
    subject, to_emails, cc_emails, bcc_count, status, error_message,
    metadata
  ) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8, $9,
    $10, $11, $12, $13, $14, $15,
    $16::jsonb
  )
  RETURNING
    send_id, period_year, period_month, file_id, version_no, deck_filename,
    distribution_list_id, sent_at, sent_by, provider, provider_message_id,
    subject, to_emails, cc_emails, bcc_count, status, error_message, metadata
`;

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : v;
}

function asNumber(v: number | string | null): number | null {
  if (v === null) return null;
  if (typeof v === "number") return v;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

export async function recordBoardDeckSend(
  pool: Pick<Pool, "query">,
  input: RecordSendInput
): Promise<BoardDeckSendRecord> {
  const reasons: string[] = [];
  if (!Number.isInteger(input.period_year) || input.period_year < 2020 || input.period_year > 2100) {
    reasons.push("invalid_period_year");
  }
  if (!Number.isInteger(input.period_month) || input.period_month < 1 || input.period_month > 12) {
    reasons.push("invalid_period_month");
  }
  if (!input.sent_by || input.sent_by.trim().length === 0) {
    reasons.push("sent_by_required");
  }
  if (!input.provider || input.provider.trim().length === 0) {
    reasons.push("provider_required");
  }
  if (input.status !== "sent" && input.status !== "failed") {
    reasons.push("invalid_status");
  }
  if (!Number.isInteger(input.bcc_count) || input.bcc_count < 0) {
    reasons.push("invalid_bcc_count");
  }
  if (reasons.length > 0) {
    throw new Error(`recordBoardDeckSend: validation failed (${reasons.join(", ")})`);
  }

  const r = await pool.query<DbRow>(INSERT_SQL, [
    input.period_year,
    input.period_month,
    input.file_id,
    input.version_no,
    input.deck_filename,
    input.distribution_list_id,
    input.sent_by.trim(),
    input.provider.trim(),
    input.provider_message_id,
    input.subject,
    input.to_emails,
    input.cc_emails,
    input.bcc_count,
    input.status,
    input.error_message ?? null,
    JSON.stringify(input.metadata ?? {}),
  ]);

  const row = r.rows[0];
  return {
    send_id: asNumber(row.send_id) ?? 0,
    period_year: row.period_year,
    period_month: row.period_month,
    file_id: asNumber(row.file_id),
    version_no: row.version_no,
    deck_filename: row.deck_filename,
    distribution_list_id: asNumber(row.distribution_list_id),
    sent_at: toIso(row.sent_at),
    sent_by: row.sent_by,
    provider: row.provider,
    provider_message_id: row.provider_message_id,
    subject: row.subject,
    to_emails: row.to_emails ?? [],
    cc_emails: row.cc_emails ?? [],
    bcc_count: row.bcc_count,
    status: row.status,
    error_message: row.error_message,
    metadata: row.metadata ?? {},
  };
}
