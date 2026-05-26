/**
 * src/lib/distribution/get-distribution-list.ts
 *
 * PR 004D — Read helper: load one distribution list with its recipients.
 * Returns null when the list doesn't exist; the caller decides whether
 * that's a 404 (route) or a "configure first" UI state.
 */
import type { Pool, QueryResultRow } from "pg";
import type { BoardDistributionList, RecipientType } from "./types";

type ListRow = QueryResultRow & {
  list_id: number | string;
  name: string;
  description: string | null;
  is_active: boolean;
};

type RecipientRow = QueryResultRow & {
  recipient_id: number | string;
  email: string;
  display_name: string | null;
  recipient_type: string;
  is_active: boolean;
};

function asNumber(v: number | string): number {
  if (typeof v === "number") return v;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
}

export async function getDistributionList(
  pool: Pick<Pool, "query">,
  listId: number
): Promise<BoardDistributionList | null> {
  if (!Number.isInteger(listId) || listId <= 0) {
    throw new Error(`getDistributionList: invalid listId ${listId}`);
  }

  const listResult = await pool.query<ListRow>(
    `SELECT list_id, name, description, is_active
       FROM u1d_ops.board_distribution_lists
      WHERE list_id = $1`,
    [listId]
  );
  if (listResult.rows.length === 0) return null;
  const list = listResult.rows[0];

  const recipientsResult = await pool.query<RecipientRow>(
    `SELECT recipient_id, email, display_name, recipient_type, is_active
       FROM u1d_ops.board_distribution_recipients
      WHERE list_id = $1
      ORDER BY is_active DESC, recipient_type, LOWER(email)`,
    [listId]
  );

  const recipients = recipientsResult.rows.map((r) => ({
    recipient_id: asNumber(r.recipient_id),
    email: r.email,
    display_name: r.display_name,
    recipient_type: r.recipient_type as RecipientType,
    is_active: r.is_active,
  }));

  const counts = {
    active_to_count: recipients.filter((r) => r.is_active && r.recipient_type === "to").length,
    active_cc_count: recipients.filter((r) => r.is_active && r.recipient_type === "cc").length,
    active_bcc_count: recipients.filter((r) => r.is_active && r.recipient_type === "bcc").length,
  };

  return {
    list_id: asNumber(list.list_id),
    name: list.name,
    description: list.description,
    is_active: list.is_active,
    ...counts,
    recipients,
  };
}
