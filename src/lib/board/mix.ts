/**
 * src/lib/board/mix.ts
 *
 * PR 005A — Pure helper: category mix from per-package facts.
 *
 * Reuses categorizeFamily() from PR 002 so the executive dashboard's
 * Oil / Coolant / WW / DEF / Other split matches the 6-month trend
 * chart's bucketing on the public /` page.
 */
import { categorizeFamily, type CategoryLabel } from "../queries/category";

export type MixInputRow = {
  package_key: string;
  package_label: string;
  family: string;
  gallons: number;
};

export type MixSliceRow = {
  category: CategoryLabel;
  gallons: number;
  share: number;
};

export type MixResult = {
  total_gallons: number;
  slices: MixSliceRow[];
};

export function computeCategoryMix(rows: MixInputRow[]): MixResult {
  const buckets = new Map<CategoryLabel, number>();
  let total = 0;
  for (const r of rows) {
    const cat = categorizeFamily(r.family);
    const g = Number.isFinite(r.gallons) ? r.gallons : 0;
    buckets.set(cat, (buckets.get(cat) ?? 0) + g);
    total += g;
  }
  const slices: MixSliceRow[] = [];
  // Deterministic order for the UI.
  for (const cat of ["Oil", "Coolant", "WW", "DEF", "Other"] as CategoryLabel[]) {
    const gallons = buckets.get(cat) ?? 0;
    if (gallons === 0) continue;
    slices.push({
      category: cat,
      gallons,
      share: total > 0 ? gallons / total : 0,
    });
  }
  return { total_gallons: total, slices };
}
