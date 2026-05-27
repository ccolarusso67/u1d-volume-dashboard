/**
 * src/lib/operator-notes/save-operator-notes.ts
 *
 * PR 003E — UPSERT helper for operator notes.
 *
 * Three modes:
 *   - draft         → write section deltas, leave completion fields alone
 *   - mark_complete → write deltas AND stamp completed_at/_by. Refuses
 *                     when any section is empty after merge (we cannot mark
 *                     "complete" with blank slides — the readiness contract
 *                     depends on this guarantee).
 *   - reopen        → clear completed_at/_by; sections optional. Used when
 *                     an admin needs to change a previously-locked narrative
 *                     before re-locking the period.
 *
 * One pool call, one DB round trip. Mode-specific SQL is generated inline
 * rather than fanning out across helper functions — easier to audit.
 */
import type { Pool } from "pg";
import type { OperatorNotes, SectionUpdates, SaveMode, SectionKey } from "./types";
import { SECTION_DB_COLUMN, SECTION_KEYS } from "./types";
import { allSectionsFilled } from "./is-complete";
import { getOperatorNotes } from "./get-operator-notes";

export type SaveResult =
  | { ok: true; notes: OperatorNotes }
  | { ok: false; reason: string; notes?: OperatorNotes };

export async function saveOperatorNotes(
  pool: Pool,
  year: number,
  month: number,
  updates: SectionUpdates,
  updatedBy: string,
  mode: SaveMode
): Promise<SaveResult> {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return { ok: false, reason: "invalid_year" };
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { ok: false, reason: "invalid_month" };
  }
  if (!updatedBy) {
    return { ok: false, reason: "updated_by_required" };
  }

  // Build the column list dynamically from the requested updates.
  // Each section in `updates` maps to a DB column; null is an allowed
  // value (drafted then cleared). Sections not in `updates` are not
  // touched.
  const cols: string[] = ["period_year", "period_month", "updated_at", "updated_by"];
  const placeholders: string[] = ["$1", "$2", "NOW()", "$3"];
  const params: unknown[] = [year, month, updatedBy];
  let nextParam = 4;

  for (const key of SECTION_KEYS) {
    if (key in updates) {
      const dbCol = SECTION_DB_COLUMN[key];
      cols.push(dbCol);
      placeholders.push(`$${nextParam}`);
      params.push(updates[key] ?? null);
      nextParam++;
    }
  }

  // mark_complete: must have all sections (in DB after the upsert) filled.
  // To know that, we have to compute the merged result first.
  if (mode === "mark_complete") {
    const existing = await getOperatorNotes(pool, year, month);
    const merged: Record<SectionKey, string | null> = { ...existing.sections };
    for (const key of SECTION_KEYS) {
      if (key in updates) merged[key] = updates[key] ?? null;
    }
    if (!allSectionsFilled(merged)) {
      return {
        ok: false,
        reason: "sections_incomplete",
        notes: existing,
      };
    }
    cols.push("completed_at", "completed_by");
    placeholders.push("NOW()", `$${nextParam}`);
    params.push(updatedBy);
    nextParam++;
  }

  // SET clause for the conflict path. Skip the PK columns (period_year/_month)
  // and treat updated_at/_by as always-overwritten.
  const setClauses: string[] = [];
  for (let i = 2; i < cols.length; i++) {
    const c = cols[i];
    setClauses.push(`${c} = EXCLUDED.${c}`);
  }

  // reopen wipes completion fields regardless of what's in `updates`.
  if (mode === "reopen") {
    // Append the reopen-specific overrides to the SET clause; INSERT path
    // sets them to NULL too via constant placeholders.
    cols.push("completed_at", "completed_by");
    placeholders.push("NULL", "NULL");
    setClauses.push("completed_at = NULL", "completed_by = NULL");
  }

  const sql = `
    INSERT INTO u1d_ops.monthly_operator_notes (${cols.join(", ")})
    VALUES (${placeholders.join(", ")})
    ON CONFLICT (period_year, period_month) DO UPDATE
      SET ${setClauses.join(", ")}
  `;

  await pool.query(sql, params);
  const refreshed = await getOperatorNotes(pool, year, month);
  return { ok: true, notes: refreshed };
}
