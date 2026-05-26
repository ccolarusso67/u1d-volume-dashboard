/**
 * src/lib/distribution/list-distribution-lists.ts
 *
 * PR 004D — Read helper: summary of every distribution list with
 * per-role active recipient counts. Used by the admin distribution
 * page and the board dashboard's distribution panel.
 */
import type { Pool, QueryResultRow } from "pg";
import type { BoardDistributionListSummary } from "./types";

type Row = QueryResultRow & {
  list_id: number | string;
  name: string;
  description: string | null;
  is_active: boolean;
  active_to_count: number;
  active_cc_count: number;
  active_bcc_count: number;
};

const QUERY = `
  SELECT
    bdl.list_id::bigint AS list_id,
    bdl.name,
    bdl.description,
    bdl.is_active,
    COALESCE((SELECT COUNT(*) FROM u1d_ops.board_distribution_recipients r
              WHERE r.list_id = bdl.list_id AND r.is_active = TRUE AND r.recipient_type = 'to'), 0)::int  AS active_to_count,
    COALESCE((SELECT COUNT(*) FROM u1d_ops.board_distribution_recipients r
              WHERE r.list_id = bdl.list_id AND r.is_active = TRUE AND r.recipient_type = 'cc'), 0)::int  AS active_cc_count,
    COALESCE((SELECT COUNT(*) FROM u1d_ops.board_distribution_recipients r
              WHERE r.list_id = bdl.list_id AND r.is_active = TRUE AND r.recipient_type = 'bcc'), 0)::int AS active_bcc_count
  FROM u1d_ops.board_distribution_lists bdl
  ORDER BY bdl.is_active DESC, bdl.name
`;

function asNumber(v: number | string): number {
  if (typeof v === "number") return v;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
}

export async function listDistributionLists(
  pool: Pick<Pool, "query">
): Promise<BoardDistributionListSummary[]> {
  const r = await pool.query<Row>(QUERY);
  return r.rows.map((row) => ({
    list_id: asNumber(row.list_id),
    name: row.name,
    description: row.description,
    is_active: row.is_active,
    active_to_count: row.active_to_count,
    active_cc_count: row.active_cc_count,
    active_bcc_count: row.active_bcc_count,
  }));
}
