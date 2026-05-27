/**
 * src/lib/board/concentration.ts
 *
 * PR 005A — Pure helpers for customer concentration metrics.
 */

export type ConcentrationInput = {
  key: string;
  display_name: string;
  gallons: number;
  is_intercompany?: boolean;
};

export type ConcentrationResult = {
  top_customer_share: number | null;
  top_customer_name: string | null;
  top5_share: number | null;
  intercompany_share: number | null;
  external_share: number | null;
  total_gallons: number;
  customer_count: number;
};

/**
 * Customer concentration computed from a list of per-customer rows.
 *
 *   - top_customer_share: share of the largest customer
 *   - top5_share: combined share of the top 5 customers
 *   - intercompany_share: combined share of customers flagged is_intercompany
 *     (Ultra1Plus's primary intercompany counterparty is ULTRACHEM; this
 *     surface generalizes to any future intercompany account)
 *
 * Empty input → all null shares + zero totals.
 */
export function computeConcentration(
  rows: ConcentrationInput[]
): ConcentrationResult {
  if (rows.length === 0) {
    return {
      top_customer_share: null,
      top_customer_name: null,
      top5_share: null,
      intercompany_share: null,
      external_share: null,
      total_gallons: 0,
      customer_count: 0,
    };
  }
  const total = rows.reduce((acc, r) => acc + (r.gallons || 0), 0);
  if (total === 0) {
    return {
      top_customer_share: null,
      top_customer_name: null,
      top5_share: null,
      intercompany_share: null,
      external_share: null,
      total_gallons: 0,
      customer_count: rows.length,
    };
  }
  const sorted = [...rows].sort((a, b) => b.gallons - a.gallons);
  const intercompany = rows
    .filter((r) => r.is_intercompany === true)
    .reduce((acc, r) => acc + (r.gallons || 0), 0);
  const top5 = sorted.slice(0, 5).reduce((acc, r) => acc + (r.gallons || 0), 0);

  return {
    top_customer_share: sorted[0].gallons / total,
    top_customer_name: sorted[0].display_name,
    top5_share: top5 / total,
    intercompany_share: intercompany / total,
    external_share: (total - intercompany) / total,
    total_gallons: total,
    customer_count: rows.length,
  };
}
