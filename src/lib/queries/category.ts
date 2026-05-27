/**
 * src/lib/queries/category.ts
 *
 * Canonical mapping of u1d_ops.packages.family -> dashboard category label.
 *
 * The family values are constrained by the catalog migration to four lowercase
 * tokens (oil / coolant / washer_fluid / def). The dashboard groups them into
 * five display categories. This module is the single source of truth.
 *
 * SQL CASE statements in queries (notably getMonthlyCategoryTrend) MUST mirror
 * the categorizeFamily() implementation below. If you change this map, also
 * update every SQL CASE that compares on `p.family`.
 */

export type PackageFamily = "oil" | "coolant" | "washer_fluid" | "def";
export type CategoryLabel = "Oil" | "Coolant" | "WW" | "DEF" | "Other";

/**
 * Lowercase family values from the packages catalog -> board-deck category.
 */
export const CATEGORY_MAP: Record<PackageFamily, CategoryLabel> = {
  oil: "Oil",
  coolant: "Coolant",
  washer_fluid: "WW",
  def: "DEF",
};

/**
 * Canonical mapping. Returns "Other" for any input that is not one of the
 * four catalog families — that bucket should stay empty in production but is
 * the safe fallback if a new family is added without updating this map.
 */
export function categorizeFamily(family: string | null | undefined): CategoryLabel {
  if (!family) return "Other";
  const key = family.toLowerCase() as PackageFamily;
  return CATEGORY_MAP[key] ?? "Other";
}

/**
 * Display order for the stacked-bar chart, top-of-stack first.
 *
 * Heavy/operational categories sit on top; DEF and Other sit at the bottom
 * so the visual emphasis matches the board narrative.
 */
export const CATEGORY_DISPLAY_ORDER: readonly CategoryLabel[] = [
  "Oil",
  "Coolant",
  "WW",
  "DEF",
  "Other",
];
