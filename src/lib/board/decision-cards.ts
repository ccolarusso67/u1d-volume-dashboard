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
 * Bilingual: each getter takes a locale and emits EN or ES. Thresholds and
 * tone logic are identical across languages.
 */
import type { BoardExecutiveDashboard, BoardFinanceOverlay } from "./executive-types";
import type { Locale } from "@/lib/i18n/locale";

export type DecisionTone = "neutral" | "attention" | "urgent";

export type DecisionCard = {
  title: string;
  body: string;
  tone: DecisionTone;
};

export type DecisionThresholds = {
  gross_margin_floor_pct: number;
  volume_to_revenue_growth_ratio: number;
  ap_to_ar_urgent_ratio: number;
  top_customer_share_floor: number;
};

export const DEFAULT_THRESHOLDS: DecisionThresholds = {
  gross_margin_floor_pct: 0.25,
  volume_to_revenue_growth_ratio: 2.0,
  ap_to_ar_urgent_ratio: 3.0,
  top_customer_share_floor: 0.5,
};

// ---------------------------------------------------------------------------
// Locale strings
// ---------------------------------------------------------------------------

type DStrings = {
  localeCode: "en-US" | "es-ES";
  title: string;
  defaultTopCustomerName: string;
  volMixShift: (vol: string, ratio: string, rev: string) => string;
  volTracking: (signedPct: string) => string;
  volNoBaseline: string;
  marginBelowFloor: (gm: string, gap: string, floor: string) => string;
  marginWithinTarget: (gm: string) => string;
  cashRatioText: (ratio: string) => string;
  cashNegative: (net: string, ar: string, ap: string, ratioText: string) => string;
  cashPositive: (net: string) => string;
  customerConcentrated: (name: string, share: string) => string;
  customerWithinBounds: string;
};

const EN: DStrings = {
  localeCode: "en-US",
  title: "Decision for Management",
  defaultTopCustomerName: "the top customer",
  volMixShift: (vol, ratio, rev) =>
    `Volume YoY (+${vol}) growing ${ratio}× faster than revenue (+${rev}). ` +
    `Confirm whether the mix shift toward lower-priced channels is deliberate (e.g. intercompany ramp) or a pricing leak.`,
  volTracking: (signedPct) =>
    `Volume tracking ${signedPct} YoY. Confirm whether the underlying customer / channel mix is the intended one.`,
  volNoBaseline:
    `No prior-year baseline available yet. Confirm the volume target for the next quarter so future cycles have a benchmark.`,
  marginBelowFloor: (gm, gap, floor) =>
    `Gross margin at ${gm} (trailing 12M) is ${gap} below the ${floor} industry reference. ` +
    `Confirm the lever to close the gap: input-cost reduction, batch-size optimization, or external-account pricing adjustment.`,
  marginWithinTarget: (gm) =>
    `Gross margin at ${gm} is within target. ` +
    `Confirm whether to invest the margin headroom in growth (incremental capacity, distributor onboarding) or take it as profit.`,
  cashRatioText: (ratio) => `AP running ${ratio}× AR `,
  cashNegative: (net, ar, ap, ratioText) =>
    `Net working capital is ${net} (AR ${ar} vs AP ${ap}). ` +
    `${ratioText}is funding operations on vendor credit. ` +
    `Confirm the collection-acceleration plan and the vendor-terms posture for the next 60 days.`,
  cashPositive: (net) =>
    `Net working capital positive at ${net}. ` +
    `Confirm whether the cash cushion supports the planned capex / inventory build for the next quarter.`,
  customerConcentrated: (name, share) =>
    `${name} represents ${share} of this period's gallons. ` +
    `Confirm whether the diversification plan is on track or whether this concentration is the long-term operating shape.`,
  customerWithinBounds:
    `Customer concentration within typical bounds. ` +
    `Confirm the top three accounts have signed forecasts for the upcoming quarter.`,
};

const ES: DStrings = {
  localeCode: "es-ES",
  title: "Decisión para la Gerencia",
  defaultTopCustomerName: "el cliente principal",
  volMixShift: (vol, ratio, rev) =>
    `El volumen interanual (+${vol}) crece ${ratio}× más rápido que los ingresos (+${rev}). ` +
    `Confirmar si el cambio de mezcla hacia canales de menor precio es deliberado (p. ej. crecimiento intercompañía) o una fuga de precio.`,
  volTracking: (signedPct) =>
    `El volumen avanza ${signedPct} interanual. Confirmar si la mezcla subyacente de clientes / canales es la prevista.`,
  volNoBaseline:
    `Aún no hay base del año anterior disponible. Confirmar el objetivo de volumen para el próximo trimestre para que los ciclos futuros tengan referencia.`,
  marginBelowFloor: (gm, gap, floor) =>
    `El margen bruto de ${gm} (12M móviles) está ${gap} por debajo de la referencia de industria de ${floor}. ` +
    `Confirmar la palanca para cerrar la brecha: reducción de costo de insumos, optimización de tamaño de lote o ajuste de precio en cuentas externas.`,
  marginWithinTarget: (gm) =>
    `El margen bruto de ${gm} está dentro del objetivo. ` +
    `Confirmar si invertir el margen excedente en crecimiento (capacidad incremental, incorporación de distribuidores) o tomarlo como utilidad.`,
  cashRatioText: (ratio) => `CxP corriendo ${ratio}× CxC `,
  cashNegative: (net, ar, ap, ratioText) =>
    `El capital de trabajo neto es ${net} (CxC ${ar} vs CxP ${ap}). ` +
    `${ratioText}está financiando las operaciones con crédito de proveedores. ` +
    `Confirmar el plan de aceleración de cobros y la postura de términos con proveedores para los próximos 60 días.`,
  cashPositive: (net) =>
    `Capital de trabajo neto positivo en ${net}. ` +
    `Confirmar si el colchón de efectivo respalda la inversión de capex / inventario prevista para el próximo trimestre.`,
  customerConcentrated: (name, share) =>
    `${name} representa ${share} de los galones de este período. ` +
    `Confirmar si el plan de diversificación está en marcha o si esta concentración es la forma operativa de largo plazo.`,
  customerWithinBounds:
    `Concentración de clientes dentro de los límites típicos. ` +
    `Confirmar que las tres cuentas principales tengan pronósticos firmados para el próximo trimestre.`,
};

function dstr(locale: Locale): DStrings {
  return locale === "es" ? ES : EN;
}

// ---------------------------------------------------------------------------
// Per-slide cards
// ---------------------------------------------------------------------------

/** Volume slide — mix-shift detection. */
export function getVolumeDecisionCard(
  view: BoardExecutiveDashboard,
  locale: Locale = "en",
  t: DecisionThresholds = DEFAULT_THRESHOLDS
): DecisionCard {
  const S = dstr(locale);
  const volPct = view.priorYear?.delta_pct ?? null;
  const revPct = view.finance?.trailing_12m ? deriveRevenueGrowthPct(view.finance) : null;

  if (volPct !== null && revPct !== null && revPct !== 0) {
    const ratio = Math.abs(volPct / revPct);
    if (volPct > 0 && revPct > 0 && ratio >= t.volume_to_revenue_growth_ratio) {
      return {
        title: S.title,
        body: S.volMixShift(pctFmt(volPct, S), ratio.toFixed(1), pctFmt(revPct, S)),
        tone: "attention",
      };
    }
  }

  return {
    title: S.title,
    body:
      view.priorYear?.delta_pct !== null && view.priorYear?.delta_pct !== undefined
        ? S.volTracking(formatSignedPct(view.priorYear.delta_pct, S))
        : S.volNoBaseline,
    tone: "neutral",
  };
}

/** Margin slide — gross margin vs floor. */
export function getMarginDecisionCard(
  view: BoardExecutiveDashboard,
  locale: Locale = "en",
  t: DecisionThresholds = DEFAULT_THRESHOLDS
): DecisionCard | null {
  if (!view.finance) return null;
  const S = dstr(locale);
  const gmPct = view.finance.trailing_12m.gross_margin_pct;
  const floor = t.gross_margin_floor_pct;

  if (gmPct < floor) {
    const gap = floor - gmPct;
    return {
      title: S.title,
      body: S.marginBelowFloor(pctFmt(gmPct, S), pctFmt(gap, S), pctFmt(floor, S)),
      tone: gmPct < 0.15 ? "urgent" : "attention",
    };
  }

  return { title: S.title, body: S.marginWithinTarget(pctFmt(gmPct, S)), tone: "neutral" };
}

/** Cash slide — net working capital. */
export function getCashDecisionCard(
  view: BoardExecutiveDashboard,
  locale: Locale = "en",
  t: DecisionThresholds = DEFAULT_THRESHOLDS
): DecisionCard | null {
  if (!view.finance) return null;
  const S = dstr(locale);
  const wc = view.finance.working_capital;
  if (wc.total_ar === 0 && wc.total_ap === 0) return null;

  if (wc.net_position < 0) {
    const ratio = wc.ap_to_ar_ratio;
    const urgent = ratio !== null && ratio >= t.ap_to_ar_urgent_ratio;
    const ratioText = ratio !== null ? S.cashRatioText(ratio.toFixed(1)) : "";
    return {
      title: S.title,
      body: S.cashNegative(usdFmt(wc.net_position), usdFmt(wc.total_ar), usdFmt(wc.total_ap), ratioText),
      tone: urgent ? "urgent" : "attention",
    };
  }

  return { title: S.title, body: S.cashPositive(usdFmt(wc.net_position)), tone: "neutral" };
}

/** Customer intelligence slide — concentration. */
export function getCustomerDecisionCard(
  view: BoardExecutiveDashboard,
  locale: Locale = "en",
  t: DecisionThresholds = DEFAULT_THRESHOLDS
): DecisionCard {
  const S = dstr(locale);
  const top = view.customerConcentration.top_customer_share;
  if (top !== null && top >= t.top_customer_share_floor) {
    const name = view.customerConcentration.top_customer_name ?? S.defaultTopCustomerName;
    return {
      title: S.title,
      body: S.customerConcentrated(name, pctFmt(top, S)),
      tone: top >= 0.7 ? "attention" : "neutral",
    };
  }
  return { title: S.title, body: S.customerWithinBounds, tone: "neutral" };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveRevenueGrowthPct(finance: BoardFinanceOverlay): number | null {
  if (finance.pnl_trend.length < 24) return null;
  const recent12 = finance.pnl_trend.slice(-12);
  const prior12 = finance.pnl_trend.slice(-24, -12);
  const r = recent12.reduce((s, x) => s + Number(x.income), 0);
  const p = prior12.reduce((s, x) => s + Number(x.income), 0);
  if (p === 0) return null;
  return (r - p) / p;
}

function pctFmt(p: number, S: DStrings): string {
  return `${(p * 100).toLocaleString(S.localeCode, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function formatSignedPct(p: number, S: DStrings): string {
  const sign = p > 0 ? "+" : "";
  return `${sign}${pctFmt(p, S)}`;
}

function usdFmt(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
