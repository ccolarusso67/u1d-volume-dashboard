/**
 * src/lib/operator-notes/get-operator-notes.ts
 *
 * PR 003E — Read helper for the period's operator notes.
 *
 * Returns an OperatorNotes object even when no row exists yet (sections
 * default to null, exists=false, is_complete=false). Callers can render
 * the empty form against the same shape they get for a saved row.
 */
import type { Pool, QueryResultRow } from "pg";
import type { OperatorNotes, SectionKey } from "./types";
import { SECTION_KEYS } from "./types";
import { isComplete } from "./is-complete";

type Row = QueryResultRow & {
  capacity_md: string | null;
  supply_chain_md: string | null;
  quality_md: string | null;
  initiatives_md: string | null;
  risks_md: string | null;
  completed_at: Date | string | null;
  completed_by: string | null;
  updated_at: Date | string | null;
  updated_by: string | null;
};

function toIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

function emptyNotes(year: number, month: number): OperatorNotes {
  const sections = Object.fromEntries(
    SECTION_KEYS.map((k) => [k, null])
  ) as Record<SectionKey, string | null>;
  return {
    period_year: year,
    period_month: month,
    sections,
    completed_at: null,
    completed_by: null,
    updated_at: null,
    updated_by: null,
    is_complete: false,
    exists: false,
  };
}

export async function getOperatorNotes(
  pool: Pool,
  year: number,
  month: number
): Promise<OperatorNotes> {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new Error(`getOperatorNotes: invalid year ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`getOperatorNotes: invalid month ${month}`);
  }

  const r = await pool.query<Row>(
    `SELECT capacity_md, supply_chain_md, quality_md, initiatives_md, risks_md,
            completed_at, completed_by, updated_at, updated_by
       FROM u1d_ops.monthly_operator_notes
      WHERE period_year = $1 AND period_month = $2
      LIMIT 1`,
    [year, month]
  );

  if (r.rows.length === 0) return emptyNotes(year, month);

  const row = r.rows[0];
  const sections: Record<SectionKey, string | null> = {
    capacity_production: row.capacity_md,
    supply_chain: row.supply_chain_md,
    quality_incidents: row.quality_md,
    initiatives: row.initiatives_md,
    risks: row.risks_md,
  };

  const completed_at = toIso(row.completed_at);
  return {
    period_year: year,
    period_month: month,
    sections,
    completed_at,
    completed_by: row.completed_by ?? null,
    updated_at: toIso(row.updated_at),
    updated_by: row.updated_by ?? null,
    is_complete: isComplete({ sections, completed_at }),
    exists: true,
  };
}
