/**
 * src/lib/finance/line-margin.ts
 *
 * VERSION A — Contribution margin per filling line.
 *
 *   Contribution margin = Revenue − Product COGS, attributed to each
 *   production parent line (Line 1..6). This is NOT a fully-loaded margin:
 *   it excludes per-line conversion cost (filling labor, line overhead,
 *   depreciation). Those are Version B and require a maintained cost model.
 *
 * Sources (two databases, merged in JS — they live in separate pools):
 *   - Revenue + product cost: finance warehouse invoice_lines, scoped to
 *     U1D_COMPANY_ID. COGS = quantity × per-unit cost, with avg_cost from
 *     product_catalog as the fallback when the invoice line carries no cost
 *     (QuickBooks often leaves line-level cost at 0).
 *   - Produced gallons per line: u1d_ops.mv_production_monthly (main pool).
 *
 * Each finance product is bucketed into a parent line by an ordered
 * keyword rule engine (classifyLine). Order matters: specific containers
 * (DEF, 5QT, DRUM, PAIL) are tested before the generic GALLON/QT rules.
 * Anything unmatched lands in an "Unmapped" bucket whose top products are
 * surfaced so the rules can be extended against real SKU names.
 *
 * Shared physical lines (Line 3 = 5QT + gallon oil + gallon coolant,
 * Line 5 = two DEF SKUs) are reported at the parent-line level, which is
 * the correct granularity for a margin view — you can't split a Line-3
 * gallon into oil vs coolant from billing data alone.
 */
import { getFinancePool } from "./db-pool";
import { getPool } from "../db-pool";
import { safeQuery, safeQueryOne } from "./safe-query";

/**
 * Entities included in the filling-line margin view. Production happens under
 * U1Dynamics, but real market revenue is booked under Ultrachem (U1Dynamics
 * sells most of its output intercompany to Ultrachem, which then sells to the
 * market). So margin per line must span both entities. Deliberately NOT the
 * full five-company set, and deliberately NOT routed through U1D_COMPANY_ID
 * (that constant stays pinned to 'u1dynamics' for every other U1D-scoped view).
 */
export const MARGIN_COMPANY_IDS = ["u1p_ultrachem", "u1dynamics"];

/**
 * Intercompany elimination. Sales between the two in-group entities (chiefly
 * U1Dynamics → "Ultrachem LLC", which is most of U1Dynamics' book) must be
 * removed so the same gallons aren't counted twice — once when U1Dynamics
 * bills Ultrachem and again when Ultrachem bills the market. Matched on the
 * invoice customer name (case-insensitive POSIX regex). The eliminated total
 * is surfaced in the report so the adjustment is auditable, not hidden.
 */
const INTERCOMPANY_RE = "ULTRACHEM|U1\\s*DYNAMICS|ULTRA\\s*1\\s*PLUS|ULTRA1PLUS";

// ---------------------------------------------------------------------------
// Classification rules — product string -> production parent line.
// Tested top-to-bottom; first match wins.
// ---------------------------------------------------------------------------

export type LineRule = { parent: string; label: string; test: RegExp };

export const LINE_RULES: LineRule[] = [
  // DEF is sold as 2.5-gal jugs — must beat the PAIL (5 GAL) and GALLON rules.
  { parent: "Line 5", label: "DEF (Line 5)", test: /\bDEF\b|DIESEL\s*EXHAUST|UREA|2\s*[x*]\s*2\.?5|1\s*[x*]\s*2\.?5|2\.5\s*GAL/i },
  // Totes / IBCs (275 / 330 gal).
  { parent: "Line 6", label: "Totes (Line 6)", test: /\bTOTE\b|\bIBC\b|\b275\b|\b330\b/i },
  // Drums (55 gal).
  { parent: "Line 2", label: "Drums (Line 2)", test: /\bDRUM\b|\b55\s*GAL|55\s*GL/i },
  // 5-quart bottles — must beat the generic QUART rule.
  { parent: "Line 3", label: "Line 3 (5QT / Gallon)", test: /\b5\s*QT|\b5QT\b|5\s*QUART/i },
  // Pails (5 gal) — must beat the generic GALLON rule.
  { parent: "Line 4", label: "Pail (Line 4)", test: /\bPAIL\b|\b5\s*GAL|5\s*GL\b/i },
  // Small bottles: quarts + liters -> Line 1.
  { parent: "Line 1", label: "Quarts (Line 1)", test: /\bQUART\b|\bQT\b|\b1\s*QT|\bLITER\b|\bLITRE\b|\bL\b|\b1L\b|\bQRT\b/i },
  // 1-gallon jugs (oil or coolant) + generic jugs -> Line 3.
  { parent: "Line 3", label: "Line 3 (5QT / Gallon)", test: /\bGALLON\b|\b1\s*GAL|\bGAL\b|\bJUG\b/i },
];

const PARENT_ORDER = ["Line 1", "Line 2", "Line 3", "Line 4", "Line 5", "Line 6"];
const PARENT_LABEL: Record<string, string> = {
  "Line 1": "Quarts (Line 1)",
  "Line 2": "Drums (Line 2)",
  "Line 3": "5QT + Gallon (Line 3)",
  "Line 4": "Pail (Line 4)",
  "Line 5": "DEF (Line 5)",
  "Line 6": "Totes (Line 6)",
};

export function classifyLine(text: string): string | null {
  const t = (text || "").toUpperCase();
  for (const r of LINE_RULES) {
    if (r.test.test(t)) return r.parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProductRow = {
  is_intercompany: boolean;
  product_name: string;
  category: string;
  revenue: number;
  cogs: number;
  qty: number;
};

export type LineMarginRow = {
  parent_line: string;
  label: string;
  revenue: number;
  cogs: number;
  contribution: number;
  marginPct: number | null;
  gallons: number;
  revPerGal: number | null;
  contribPerGal: number | null;
};

export type LineMarginReport = {
  configured: boolean; // finance DB reachable / env set
  hasData: boolean; // any classified revenue in the window
  windowEnd: string | null; // first day of latest invoice month
  months: number;
  lines: LineMarginRow[];
  totalRevenue: number;
  totalCogs: number;
  totalContribution: number;
  totalGallons: number;
  unmappedRevenue: number;
  unmappedTop: { product_name: string; revenue: number }[];
  mappedPctOfRevenue: number; // share of revenue that landed on a line
  intercompanyEliminated: number; // revenue removed as intercompany
};

const EMPTY: LineMarginReport = {
  configured: false, hasData: false, windowEnd: null, months: 3,
  lines: [], totalRevenue: 0, totalCogs: 0, totalContribution: 0, totalGallons: 0,
  unmappedRevenue: 0, unmappedTop: [], mappedPctOfRevenue: 0, intercompanyEliminated: 0,
};

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function getLineMargin(months: number): Promise<LineMarginReport> {
  const m = Math.max(1, Math.round(months));
  let financePool;
  try {
    financePool = getFinancePool();
  } catch {
    return { ...EMPTY, months: m }; // U1D_FINANCE_DATABASE_URL not set
  }

  // Window anchored on the latest invoice month across the included entities.
  const maxRow = await safeQueryOne<{ d: string | null }>(
    financePool,
    `SELECT TO_CHAR(DATE_TRUNC('month', MAX(i.txn_date)),'YYYY-MM-DD') AS d
       FROM invoices i WHERE i.company_id = ANY($1)`,
    [MARGIN_COMPANY_IDS]
  );
  const end = maxRow?.d ?? null;
  if (!end) return { ...EMPTY, configured: true, months: m };

  // Per-product revenue + COGS over the trailing window. COGS prefers the
  // line cost; falls back to product_catalog.avg_cost when the line is 0/null.
  const products = await safeQuery<ProductRow>(
    financePool,
    `
    SELECT
      (COALESCE(c.full_name, c.company_name, '') ~* $4) AS is_intercompany,
      COALESCE(NULLIF(TRIM(il.description),''), pc.name, NULLIF(il.sku,''), il.item_id, '(unnamed)') AS product_name,
      COALESCE(pc.category,'') AS category,
      COALESCE(SUM(il.line_total),0)::float8 AS revenue,
      COALESCE(SUM(il.quantity * COALESCE(NULLIF(il.cost,0), pc.avg_cost, 0)),0)::float8 AS cogs,
      COALESCE(SUM(il.quantity),0)::float8 AS qty
    FROM invoice_lines il
    JOIN invoices i ON i.txn_id = il.invoice_txn_id
    LEFT JOIN customers c
      ON c.customer_id = i.customer_id AND c.company_id = il.company_id
    LEFT JOIN product_catalog pc
      ON pc.item_id = il.item_id AND pc.company_id = il.company_id
    WHERE il.company_id = ANY($1)
      AND i.txn_date >= ($2::date - make_interval(months => $3 - 1))
      AND i.txn_date <  ($2::date + INTERVAL '1 month')
    GROUP BY 1, 2, 3
    `,
    [MARGIN_COMPANY_IDS, end, m, INTERCOMPANY_RE]
  );

  // Produced gallons per parent line over the same window (main pool, u1d_ops).
  const endDate = new Date(end + "T00:00:00Z");
  const endOrd = endDate.getUTCFullYear() * 12 + (endDate.getUTCMonth() + 1);
  const startOrd = endOrd - (m - 1);
  let gallonsByParent = new Map<string, number>();
  try {
    const prodPool = getPool();
    const prodRows = await safeQuery<{ parent_line: string; gallons: number }>(
      prodPool,
      `
      SELECT pl.parent_line,
             COALESCE(SUM(mv.gallons),0)::float8 AS gallons
        FROM u1d_ops.production_lines pl
        LEFT JOIN u1d_ops.mv_production_monthly mv
          ON mv.line_key = pl.line_key
         AND (mv.period_year * 12 + mv.period_month) BETWEEN $1 AND $2
       WHERE pl.is_active = TRUE
       GROUP BY pl.parent_line
      `,
      [startOrd, endOrd]
    );
    gallonsByParent = new Map(prodRows.map((r) => [r.parent_line, r.gallons]));
  } catch {
    gallonsByParent = new Map();
  }

  // Classify + aggregate. Intercompany lines are removed up front.
  const agg = new Map<string, { revenue: number; cogs: number }>();
  let unmappedRevenue = 0;
  let intercompanyEliminated = 0;
  const unmapped: { product_name: string; revenue: number }[] = [];
  for (const p of products) {
    if (p.is_intercompany) {
      intercompanyEliminated += p.revenue;
      continue;
    }
    const parent = classifyLine(`${p.product_name} ${p.category}`);
    if (!parent) {
      unmappedRevenue += p.revenue;
      if (p.revenue > 0) unmapped.push({ product_name: p.product_name, revenue: p.revenue });
      continue;
    }
    const cur = agg.get(parent) ?? { revenue: 0, cogs: 0 };
    cur.revenue += p.revenue;
    cur.cogs += p.cogs;
    agg.set(parent, cur);
  }

  const lines: LineMarginRow[] = PARENT_ORDER
    .map((parent) => {
      const a = agg.get(parent) ?? { revenue: 0, cogs: 0 };
      const gallons = gallonsByParent.get(parent) ?? 0;
      const contribution = a.revenue - a.cogs;
      return {
        parent_line: parent,
        label: PARENT_LABEL[parent],
        revenue: a.revenue,
        cogs: a.cogs,
        contribution,
        marginPct: a.revenue > 0 ? contribution / a.revenue : null,
        gallons,
        revPerGal: gallons > 0 ? a.revenue / gallons : null,
        contribPerGal: gallons > 0 ? contribution / gallons : null,
      };
    })
    .filter((r) => r.revenue !== 0 || r.gallons !== 0);

  const totalRevenue = lines.reduce((s, r) => s + r.revenue, 0) + unmappedRevenue;
  const totalCogs = lines.reduce((s, r) => s + r.cogs, 0);
  const totalContribution = lines.reduce((s, r) => s + r.contribution, 0);
  const totalGallons = lines.reduce((s, r) => s + r.gallons, 0);
  const mappedRevenue = lines.reduce((s, r) => s + r.revenue, 0);

  unmapped.sort((a, b) => b.revenue - a.revenue);

  return {
    configured: true,
    hasData: mappedRevenue > 0 || unmappedRevenue > 0,
    windowEnd: end,
    months: m,
    lines,
    totalRevenue,
    totalCogs,
    totalContribution,
    totalGallons,
    unmappedRevenue,
    unmappedTop: unmapped.slice(0, 8),
    mappedPctOfRevenue: totalRevenue > 0 ? mappedRevenue / totalRevenue : 0,
    intercompanyEliminated,
  };
}
