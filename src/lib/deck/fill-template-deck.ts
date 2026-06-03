/**
 * src/lib/deck/fill-template-deck.ts
 *
 * SCAFFOLDING (PR-013, WIP) — "template-fill" board deck generation.
 *
 * Instead of drawing the deck procedurally (generate-monthly-deck-v2.ts), this
 * path takes the hand-built WorldClass template .pptx as a fixed layout and
 * substitutes the month's live values into {{TOKENS}} embedded in the slides.
 * That makes the template itself the single source of design truth.
 *
 * STATUS: not yet wired into the download/email route. The procedural v2
 * generator remains the live path until this is fully tokenized + QA'd.
 *
 * What works now:
 *   - Engine: fillTemplateDeck() — unzip → replace {{TOKENS}} in slide XML → rezip.
 *   - Tokens wired from live data: period label, slide-2 hero KPIs, slide-5 working capital.
 *
 * Pending (see DECK-TEMPLATE-FILL-PLAN.md):
 *   - Tokenize the remaining slides (3,4,6,7,8,9) in the template .pptx.
 *   - Slides needing 4-year history (customer-book trend 2023→2026, realized $/gal)
 *     require new queries — the BoardExecutiveDashboard contract does not carry them yet.
 *   - Wire fillTemplateDeck into the admin deck route behind a flag, then QA.
 *
 * No new dependency: jszip is already present (transitive via pptxgenjs).
 */
import JSZip from "jszip";
import type { BoardExecutiveDashboard } from "../board/executive-types";

const NA = "—";

// ---- local formatting (kept independent of the procedural generator) ----

function moneyShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function moneyFull(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

function pctOf(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function shortGallons(n: number): string {
  if (Math.abs(n) >= 1000) return `${Math.round(n / 1000)}K`;
  return String(Math.round(n));
}

function signedPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return NA;
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n * 100).toFixed(0)}%`;
}

/**
 * Map the executive dashboard to the template's {{TOKENS}}.
 * Tokens not yet tokenized in the .pptx are harmless extras; tokens left in the
 * .pptx with no value here render literally, so only emit ones we can fill.
 */
export function buildDeckTokens(view: BoardExecutiveDashboard): Record<string, string> {
  const f = view.finance;
  const t: Record<string, string> = {
    PERIOD_LABEL: view.period.label,
    VOLUME_SHORT: shortGallons(view.currentMetrics.total_gallons),
    VOLUME_MOM_LINE:
      view.priorMonth && view.priorMonth.delta_pct !== null
        ? `${signedPct(view.priorMonth.delta_pct)} vs prior month`
        : "vs prior month",
    TOP5_SHARE: view.customerConcentration.top5_share !== null
      ? pctOf(view.customerConcentration.top5_share)
      : NA,
  };

  // Slide 6 — top-5 accounts (name + share)
  const tc = view.topCustomers ?? [];
  for (let i = 0; i < 5; i++) {
    const c = tc[i];
    t[`ACCT${i + 1}_NAME`] = c
      ? c.customer_name + (c.is_intercompany ? " · intercompany" : "")
      : NA;
    t[`ACCT${i + 1}_SHARE`] = c && c.share_pct !== null ? pctOf(c.share_pct) : NA;
  }

  if (f) {
    const tm = f.trailing_12m;
    const wc = f.working_capital;
    t.REVENUE_TTM = moneyShort(tm.income);
    t.GROSS_MARGIN = pctOf(tm.gross_margin_pct);
    t.NET_INCOME_TTM = moneyShort(tm.net_income);
    t.NWC_SHORT = moneyShort(wc.net_position);
    t.NWC_FULL = moneyFull(wc.net_position);
    t.AR_FULL = moneyFull(wc.total_ar);
    t.AP_FULL = moneyFull(wc.total_ap);
    t.AP_AR_RATIO = wc.ap_to_ar_ratio !== null ? wc.ap_to_ar_ratio.toFixed(1) : NA;
    // Slide 4 — margin detail
    const cur = f.current;
    t.CURRENT_MARGIN = cur && cur.income ? pctOf(cur.gross_profit / cur.income) : NA;
    t.GP_PER_POINT = moneyShort(tm.income / 100); // ≈ gross profit per 1pt of GM
  } else {
    Object.assign(t, {
      REVENUE_TTM: NA, GROSS_MARGIN: NA, NET_INCOME_TTM: NA,
      NWC_SHORT: NA, NWC_FULL: NA, AR_FULL: NA, AP_FULL: NA, AP_AR_RATIO: NA,
      CURRENT_MARGIN: NA, GP_PER_POINT: NA,
    });
  }
  return t;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Replace every {{TOKEN}} in the template's slide XML with its value and
 * return a fresh .pptx buffer. Slides without tokens pass through untouched.
 */
export async function fillTemplateDeck(
  templateBuf: Buffer,
  tokens: Record<string, string>
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(templateBuf);
  const slidePaths = Object.keys(zip.files).filter((p) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(p)
  );

  for (const p of slidePaths) {
    let xml = await zip.files[p].async("string");
    xml = xml.replace(/\{\{([A-Z0-9_]+)\}\}/g, (whole, key: string) =>
      key in tokens ? xmlEscape(tokens[key]) : whole
    );
    zip.file(p, xml);
  }

  return (await zip.generateAsync({ type: "nodebuffer" })) as Buffer;
}
