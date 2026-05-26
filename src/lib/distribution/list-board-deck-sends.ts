/**
 * src/lib/distribution/list-board-deck-sends.ts
 *
 * PR 004D — Read helper: recent send audit rows for a period.
 */
import type { Pool, QueryResultRow } from "pg";
import type { BoardDeckSendRecord } from "./types";

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

const MAX_LIMIT = 50;

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : v;
}

function asNumber(v: number | string | null): number | null {
  if (v === null) return null;
  if (typeof v === "number") return v;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

export async function listBoardDeckSends(
  pool: Pick<Pool, "query">,
  year: number,
  month: number,
  limit = 10
): Promise<BoardDeckSendRecord[]> {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new Error(`listBoardDeckSends: invalid year ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`listBoardDeckSends: invalid month ${month}`);
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`listBoardDeckSends: limit must be a positive integer, got ${limit}`);
  }
  const effective = Math.min(limit, MAX_LIMIT);

  const r = await pool.query<DbRow>(
    `SELECT send_id, period_year, period_month, file_id, version_no,
            deck_filename, distribution_list_id, sent_at, sent_by,
            provider, provider_message_id, subject,
            to_emails, cc_emails, bcc_count, status, error_message,
            metadata
       FROM u1d_ops.board_deck_sends
      WHERE period_year = $1 AND period_month = $2
      ORDER BY sent_at DESC, send_id DESC
      LIMIT $3`,
    [year, month, effective]
  );

  return r.rows.map((row) => ({
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
  }));
}

/**
 * Find the most-recent successful send for a (period, distribution_list)
 * within the last `lookbackHours`. Used by the duplicate-send guard.
 */
export async function findRecentSuccessfulSend(
  pool: Pick<Pool, "query">,
  year: number,
  month: number,
  distributionListId: number,
  lookbackHours = 24
): Promise<{ send_id: number; sent_at: string; sent_by: string } | null> {
  const r = await pool.query<{ send_id: number | string; sent_at: Date | string; sent_by: string }>(
    `SELECT send_id, sent_at, sent_by
       FROM u1d_ops.board_deck_sends
      WHERE period_year = $1 AND period_month = $2
        AND distribution_list_id = $3
        AND status = 'sent'
        AND sent_at >= NOW() - ($4::int * INTERVAL '1 hour')
      ORDER BY sent_at DESC
      LIMIT 1`,
    [year, month, distributionListId, lookbackHours]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    send_id: asNumber(row.send_id) ?? 0,
    sent_at: toIso(row.sent_at),
    sent_by: row.sent_by,
  };
}
