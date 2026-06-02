/**
 * src/lib/board/decision-cards.ts
 *
 * PR 012B — auto-generate the "Decision for Management" cards that anchor
 * each board section.
 *
 * Every card is a pure function of the dashboard state + a threshold
 * config. The card asks the board to confirm a specific decision (not a
 * passive "FYI"). This is the McKinsey-style framing from the reconciliation
 * mockup Tony showed us.
 *
 * Operator override path: if monthly_operator_notes.decision_asks contains
 * a per-slide override, the helper will be wired by PR 012C to prefer it.
 * This file ships the auto-generation thresholds first.
 */
import type { BoardExecutiveDashboard, BoardFinanceOverlay } from "./executive-types";

export type DecisionTone = "neutral" | "attention" | "urgent";

export type DecisionCard = {
  /** Always "Decision for Management". Kept as a field so the renderer
   *  doesn't hard-code it. */
  title: string;
  /** 1-3 sentences. Plain English, no markdown. */
  body: string;
  /** Visual treatment hint for the renderer. */
  tone: DecisionTone;
};

export type DecisionThresholds = {
  /** Gross-margin floor below which a card is raised. Default 0.25 (25%). */
  gross_margin_floor_pct: number;
  /** Volume-vs-revenue growth ratio above which a mix-shift card is raised. Default 2.0. */
  volume_to_revenue_growth_ratio: number;
  /** AP/AR ratio above which a working-capital card is urgent. Default 3.0. */
  ap_to_ar_urgent_ratio: number;
  /** Top-customer share above which a concentration card is raised. Default 0.5 (50%). */
  top_customer_share_floor: number;
};

export const DEFAULT_THRESHOLDS: DecisionThresholds = {
  gross_margin_floor_pct: 0.25,
  volume_to_revenue_growth_ratio: 2.0,
  ap_to_ar_urgent_ratio: 3.0,
  top_customer_share_floor: 0.5,
};

const TITLE = "Decision for Management";

// ---------------------------------------------------------------------------
// Per-slide cards. Each returns the card the board should see for that slide.
// ---------------------------------------------------------------------------

/** Volume slide — mix-shift detection. */
export function getVolumeDecisionCard(
  view: BoardExecutiveDashboard,
  t: DecisionThresholds = DEFAULT_THRESHOLDS
): DecisionCard {
  const volPct = view.priorYear?.delta_pct ?? null;
  const revPct = view.finance?.trailing_12m
    ? deriveRevenueGrowthPct(view.finance)
    : null;

  // Need both signals to raise a mix-shift card.
  if (volPct !== null && revPct !== null && revPct !== 0) {
    const ratio = Math.abs(volPct / revPct);
    if (volPct > 0 && revPct > 0 && ratio >= t.volume_to_revenue_growth_ratio) {
      return {
        title: TITLE,
        body:
          `Volume YoY (+${pctFmt(volPct)}) growing ${ratio.toFixed(1)}× faster than revenue (+${pctFmt(revPct)}). ` +
          `Confirm whether the mix shift toward lower-priced channels is deliberate (e.g. intercompany ramp) or a pricing leak.`,
        tone: "attention",
      };
    }
  }

  // No financial signal yet — keep the framing operational.
  return {
    title: TITLE,
    body:
      view.priorYear?.delta_pct !== null && view.priorYear?.delta_pct !== undefined
        ? `Volume tracking ${formatSignedPct(view.priorYear.delta_pct)} YoY. ` +
          `Confirm whether the underlying customer / channel mix is the intended one.`
        : `No prior-year baseline available yet. Confirm the volume target for the next quarter so future cycles have a benchmark.`,
    tone: "neutral",
  };
}

/** Margin slide — gross margin vs floor. */
export function getMarginDecisionCard(
  view: BoardExecutiveDashboard,
  t: DecisionThresholds = DEFAULT_THRESHOLDS
): DecisionCard | null {
  if (!view.finance) return null; // no finance overlay → skip slide entirely
  const gmPct = view.finance.trailing_12m.gross_margin_pct;
  const floor = t.gross_margin_floor_pct;

  if (gmPct < floor) {
    const gap = floor - gmPct;
    return {
      title: TITLE,
      body:
        `Gross margin at ${pctFmt(gmPct)} (trailing 12M) is ${pctFmt(gap)} below the ${pctFmt(floor)} industry reference. ` +
        `Confirm the lever to close the gap: input-cost reduction, batch-size optimization, or external-account pricing adjustment.`,
      tone: gmPct < 0.15 ? "urgent" : "attention",
    };
  }

  return {
    title: TITLE,
    body:
      `Gross margin at ${pctFmt(gmPct)} is within target. ` +
      `Confirm whether to invest the margin headroom in growth (incremental capacity, distributor onboarding) or take it as profit.`,
    tone: "neutral",
  };
}

/** Cash slide — net working capital. */
export function getCashDecisionCard(
  view: BoardExecutiveDashboard,
  t: DecisionThresholds = DEFAULT_THRESHOLDS
): DecisionCard | null {
  if (!view.finance) return null;
  const wc = view.finance.working_capital;
  if (wc.total_ar === 0 && wc.total_ap === 0) return null;

  if (wc.net_position < 0) {
    const ratio = wc.ap_to_ar_ratio;
    const urgent = ratio !== null && ratio >= t.ap_to_ar_urgent_ratio;
    const ratioText = ratio !== null ? `AP running ${ratio.toFixed(1)}× AR ` : "";
    return {
      title: TITLE,
      body:
        `Net working capital is ${usdFmt(wc.net_position)} (AR ${usdFmt(wc.total_ar)} vs AP ${usdFmt(wc.total_ap)}). ` +
        `${ratioText}is funding operations on vendor credit. ` +
        `Confirm the collection-acceleration plan and the vendor-terms posture for the next 60 days.`,
      tone: urgent ? "urgent" : "attention",
    };
  }

  return {
    title: TITLE,
    body:
      `Net working capital positive at ${usdFmt(wc.net_position)}. ` +
      `Confirm whether the cash cushion supports the planned capex / inventory build for the next quarter.`,
    tone: "neutral",
  };
}

/** Customer intelligence slide — concentration. */
export function getCustomerDecisionCard(
  view: BoardExecutiveDashboard,
  t: DecisionThresholds = DEFAULT_THRESHOLDS
): DecisionCard {
  const top = view.customerConcentration.top_customer_share;
  if (top !== null && top >= t.top_customer_share_floor) {
    const name = view.customerConcentration.top_customer_name ?? "the top customer";
    return {
      title: TITLE,
      body:
        `${name} represents ${pctFmt(top)} of this period's gallons. ` +
        `Confirm whether the diversification plan is on track or whether this concentration is the long-term operating shape.`,
      tone: top >= 0.7 ? "attention" : "neutral",
    };
  }
  return {
    title: TITLE,
    body:
      `Customer concentration within typical bounds. ` +
      `Confirm the top three accounts have signed forecasts for the upcoming quarter.`,
    tone: "neutral",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveRevenueGrowthPct(finance: BoardFinanceOverlay): number | null {
  // The aggregate doesn't compute YoY directly — derive it from the trend
  // when we have at least 24 months. With only 12 months we can't compare
  // to the prior year, so return null (no card raised on this dimension).
  if (finance.pnl_trend.length < 24) return null;
  const recent12 = finance.pnl_trend.slice(-12);
  const prior12 = finance.pnl_trend.slice(-24, -12);
  const r = recent12.reduce((s, x) => s + Number(x.income), 0);
  const p = prior12.reduce((s, x) => s + Number(x.income), 0);
  if (p === 0) return null;
  return (r - p) / p;
}

function pctFmt(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

function formatSignedPct(p: number): string {
  const sign = p > 0 ? "+" : "";
  return `${sign}${pctFmt(p)}`;
}

function usdFmt(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  }
  return `${sign}$${abs.toFixed(0)}`;
}
