/**
 * src/lib/board/list-board-periods.ts
 *
 * PR 004A — Listing helper for the /board index.
 *
 * Returns locked periods only, newest first. Two-step approach:
 *   1. Single SQL pulls every locked period with its total gallons
 *      (joined to the active locked volume_files row).
 *   2. JS computes MoM% by looking up each row's prior calendar month
 *      in the result map.
 *
 * Why JS for MoM: the alternative is a LATERAL subquery or self-join,
 * both of which trade legibility for marginal speed. With ≤60 rows the
 * JS pass is negligible.
 */
import type { Pool, QueryResultRow } from "pg";
import { monthLabel, priorMonth, safePct } from "./metrics";
import type { BoardPeriodIndexRow } from "./types";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;

type Row = QueryResultRow & {
  period_year: number;
  period_month: number;
  status: string;
  locked_at: Date | string | null;
  locked_by: string | null;
  total_gallons: number | null;
  operator_notes_complete: boolean;
};

const QUERY = `
  SELECT
    bp.period_year::int                                  AS period_year,
    bp.period_month::int                                 AS period_month,
    bp.status                                            AS status,
    bp.locked_at                                         AS locked_at,
    bp.locked_by                                         AS locked_by,
    (
      SELECT COALESCE(SUM(vf.gallons), 0)::float8
        FROM u1d_ops.volume_fact vf
        JOIN u1d_ops.volume_files file
          ON file.file_id = vf.file_id
       WHERE file.period_year = bp.period_year
         AND file.period_month = bp.period_month
         AND file.is_active = TRUE
         AND file.locked_at IS NOT NULL
    )                                                    AS total_gallons,
    COALESCE(
      mon.completed_at IS NOT NULL
        AND length(coalesce(trim(mon.capacity_md), '')) > 0
        AND length(coalesce(trim(mon.supply_chain_md), '')) > 0
        AND length(coalesce(trim(mon.quality_md), '')) > 0
        AND length(coalesce(trim(mon.initiatives_md), '')) > 0
        AND length(coalesce(trim(mon.risks_md), '')) > 0,
      FALSE
    )                                                    AS operator_notes_complete
  FROM u1d_ops.board_periods bp
  LEFT JOIN u1d_ops.monthly_operator_notes mon
    ON mon.period_year = bp.period_year
   AND mon.period_month = bp.period_month
  WHERE bp.status = 'locked'
  ORDER BY bp.period_year DESC, bp.period_month DESC
  LIMIT $1
`;

function toIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

export async function listBoardPeriods(
  pool: Pick<Pool, "query">,
  options?: { limit?: number }
): Promise<BoardPeriodIndexRow[]> {
  const reqLimit = options?.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(reqLimit) || reqLimit <= 0) {
    throw new Error(`listBoardPeriods: limit must be a positive integer, got ${reqLimit}`);
  }
  const limit = Math.min(reqLimit, MAX_LIMIT);

  const r = await pool.query<Row>(QUERY, [limit]);

  // Build a (year, month) → total_gallons map so we can compute MoM in JS
  // without a second round-trip.
  const totals = new Map<string, number>();
  for (const row of r.rows) {
    const key = `${row.period_year}-${row.period_month}`;
    totals.set(key, num(row.total_gallons) ?? 0);
  }

  return r.rows.map((row): BoardPeriodIndexRow => {
    const total = num(row.total_gallons);
    const prior = priorMonth(row.period_year, row.period_month);
    const priorKey = `${prior.year}-${prior.month}`;
    const priorTotal = totals.has(priorKey) ? totals.get(priorKey)! : null;
    return {
      period: {
        year: row.period_year,
        month: row.period_month,
        label: monthLabel(row.period_year, row.period_month),
      },
      status: row.status,
      locked_at: toIso(row.locked_at),
      locked_by: row.locked_by,
      total_gallons: total,
      prior_month_total_gallons: priorTotal,
      month_over_month_delta_pct:
        priorTotal === null ? null : safePct((total ?? 0) - priorTotal, priorTotal),
      operator_notes_complete: !!row.operator_notes_complete,
      href: `/board/${row.period_year}/${row.period_month}`,
    };
  });
}
