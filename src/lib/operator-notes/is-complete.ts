/**
 * src/lib/operator-notes/is-complete.ts
 *
 * PR 003E — Single source of truth for "are the operator notes complete?"
 *
 * Definition used everywhere (form, readiness contract, lock helper):
 *   - Every section is non-null and contains at least one non-whitespace
 *     character.
 *   - completed_at is set (an admin explicitly marked it complete).
 *
 * Both halves matter:
 *   - All-sections-filled prevents accidental "complete" with blank slides.
 *   - completed_at prevents auto-marking complete on draft saves.
 */
import type { OperatorNotes, SectionKey } from "./types";
import { SECTION_KEYS } from "./types";

export function allSectionsFilled(
  sections: Record<SectionKey, string | null>
): boolean {
  for (const k of SECTION_KEYS) {
    const v = sections[k];
    if (v === null || v === undefined) return false;
    if (typeof v !== "string") return false;
    if (v.trim().length === 0) return false;
  }
  return true;
}

export function isComplete(notes: Pick<OperatorNotes, "sections" | "completed_at">): boolean {
  return notes.completed_at !== null && allSectionsFilled(notes.sections);
}
