/**
 * src/lib/operator-notes/types.ts
 *
 * PR 003E — Operator notes domain types.
 *
 * The DB columns retain the historical *_md suffix (markdown text); the
 * UI labels and API field names use the friendlier section identifiers
 * (capacity_production, supply_chain, quality_incidents, initiatives,
 * risks). Mapping happens in the helper layer so callers do not have to
 * remember the DB column quirks.
 */

/** The five narrative sections for the board deck operator slides. */
export const SECTION_KEYS = [
  "capacity_production",
  "supply_chain",
  "quality_incidents",
  "initiatives",
  "risks",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_LABELS: Record<SectionKey, string> = {
  capacity_production: "Capacity & Production",
  supply_chain: "Supply Chain",
  quality_incidents: "Quality & Incidents",
  initiatives: "Initiatives",
  risks: "Risks",
};

/** Mapping between API/UI section keys and the actual DB column names. */
export const SECTION_DB_COLUMN: Record<SectionKey, string> = {
  capacity_production: "capacity_md",
  supply_chain: "supply_chain_md",
  quality_incidents: "quality_md",
  initiatives: "initiatives_md",
  risks: "risks_md",
};

/** What the helpers return for one period's notes. */
export type OperatorNotes = {
  period_year: number;
  period_month: number;
  sections: Record<SectionKey, string | null>;
  completed_at: string | null;
  completed_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
  /** True iff every section has at least one non-whitespace character
   * AND completed_at is set. */
  is_complete: boolean;
  /** True iff a row exists in u1d_ops.monthly_operator_notes for the period. */
  exists: boolean;
};

/** Input shape for saveOperatorNotes(). */
export type SectionUpdates = Partial<Record<SectionKey, string | null>>;

/**
 * Save modes:
 *   - draft         — UPSERT sections, do not touch completed_at/_by
 *   - mark_complete — UPSERT sections AND set completed_at=NOW(), completed_by=$
 *                     ONLY IF every section is now non-empty; otherwise the
 *                     helper returns an error and refuses to mark complete.
 *   - reopen        — clear completed_at/_by; sections optional.
 */
export type SaveMode = "draft" | "mark_complete" | "reopen";
