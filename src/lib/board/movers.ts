/**
 * src/lib/board/movers.ts
 *
 * PR 005A — Pure helper: identify the top-N material gainers and decliners
 * given current vs prior period buckets.
 *
 * Material thresholds:
 *   - Require minimum prior-period gallons (default 100) so a customer
 *     going from 5 to 500 doesn't dominate the "biggest movers" list with
 *     a +9,900% headline.
 *   - Sort by absolute gallons change, not percentage change. This is the
 *     board-grade signal — a customer that went up 5,000 gal matters more
 *     than one that went up 100% on a 50-gal base.
 *
 * Output is an opinionated tuple: top N gainers + top N decliners,
 * separately. The UI renders them side-by-side.
 */

export type MoverInputRow<K extends string = string> = {
  key: K;
  display_name: string;
  current: number;
  prior: number | null;
};

export type MoverOutputRow = {
  key: string;
  display_name: string;
  current: number;
  prior: number;
  delta_gallons: number;
  delta_pct: number | null;
};

export type FindMoversOptions = {
  /** Top N gainers + top N decliners returned. Default 3. */
  topN?: number;
  /** Minimum prior-period gallons required for inclusion. Default 100. */
  minPriorGallons?: number;
};

export type MoversResult = {
  topGainers: MoverOutputRow[];
  topDecliners: MoverOutputRow[];
};

function asNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return 0;
}

/**
 * Find the top N material gainers + top N material decliners.
 *
 * Rows with `prior === null` (no prior-period locked data for that key)
 * are EXCLUDED — you can't compute a meaningful delta. The UI surfaces
 * "new this month" separately via the top-customers / top-packages tables.
 */
export function findMaterialMovers<K extends string>(
  rows: MoverInputRow<K>[],
  options?: FindMoversOptions
): MoversResult {
  const topN = options?.topN ?? 3;
  const minPrior = options?.minPriorGallons ?? 100;

  // Compute deltas, filter by minimum prior, then split into gainers/decliners.
  const enriched: MoverOutputRow[] = [];
  for (const r of rows) {
    if (r.prior === null || !Number.isFinite(r.prior)) continue;
    if (r.prior < minPrior) continue;
    const current = asNumber(r.current);
    const prior = asNumber(r.prior);
    const delta = current - prior;
    enriched.push({
      key: r.key,
      display_name: r.display_name,
      current,
      prior,
      delta_gallons: delta,
      delta_pct: prior > 0 ? delta / prior : null,
    });
  }

  const gainers = enriched
    .filter((r) => r.delta_gallons > 0)
    .sort((a, b) => b.delta_gallons - a.delta_gallons)
    .slice(0, topN);

  const decliners = enriched
    .filter((r) => r.delta_gallons < 0)
    .sort((a, b) => a.delta_gallons - b.delta_gallons) // most-negative first
    .slice(0, topN);

  return { topGainers: gainers, topDecliners: decliners };
}
