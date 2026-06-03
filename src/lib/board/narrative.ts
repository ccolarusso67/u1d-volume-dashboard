/**
 * src/lib/board/narrative.ts
 *
 * Deterministic board commentary generated only from the executive dashboard
 * payload. This module deliberately avoids external calls and free-form data.
 *
 * Bilingual: generateBoardNarrative(view, locale) emits EN or ES. All sentence
 * templates and number/word formatting are locale-aware; the logic, ordering,
 * and severity thresholds are identical across languages.
 */
import type { BoardExecutiveDashboard, ExecDeltaSet } from "./executive-types";
import type { Locale } from "@/lib/i18n/locale";

export type NarrativeSeverity = "positive" | "neutral" | "watch" | "risk";

export type BoardNarrativeBullet = {
  text: string;
  severity: NarrativeSeverity;
};

export type BoardNarrativeSection = {
  id: "executive-readout" | "key-observations" | "management-focus" | "data-limitations";
  title: string;
  paragraphs?: string[];
  bullets?: BoardNarrativeBullet[];
};

export type BoardNarrative = {
  sections: BoardNarrativeSection[];
};

const TOP_CUSTOMER_WATCH = 0.25;
const TOP_CUSTOMER_RISK = 0.4;
const TOP5_WATCH = 0.65;
const TOP5_RISK = 0.8;
const INTERCOMPANY_WATCH = 0.5;
const PACKAGE_WATCH = 0.25;
const CATEGORY_WATCH = 0.5;

type CountNoun = { one: string; other: string };

// ---------------------------------------------------------------------------
// Locale string tables. EN is the reference; ES mirrors every entry.
// ---------------------------------------------------------------------------

type NarrativeStrings = {
  localeCode: "en-US" | "es-ES";
  gallonsWord: string;
  nouns: {
    activeCustomer: CountNoun;
    packageType: CountNoun;
    operationalAlert: CountNoun;
    pendingAlert: CountNoun;
    alert: CountNoun;
    lockedMonth: CountNoun;
    reopen: CountNoun;
  };
  sectionTitles: { readout: string; observations: string; focus: string; limitations: string };
  closedLine: (period: string, gallons: string, customers: string, packages: string) => string;
  priorMonthLabel: string;
  priorYearLabel: (year: number) => string;
  comparisonZeroBase: (direction: string, deltaText: string, label: string) => string;
  comparisonNormal: (direction: string, pct: string, deltaText: string, label: string) => string;
  dirIncreased: string;
  dirDecreased: string;
  dirFlat: string;
  // limitations
  noPriorMonth: string;
  noPriorYear: string;
  noPriorYtd: string;
  noMix: string;
  // fallback focus
  focusMonitorConc: string;
  focusUseMovers: string;
  // ytd
  ytdReadoutBase: (gallons: string, months: string) => string;
  ytdReadoutNoPrior: (base: string) => string;
  ytdReadoutZeroBase: (base: string) => string;
  ytdReadoutDelta: (base: string, dir: string, pct: string, delta: string) => string;
  ytdDirUp: string;
  ytdDirDown: string;
  ytdDirFlat: string;
  ytdObsNoPrior: (months: string) => string;
  ytdObsZeroBase: (months: string) => string;
  ytdObsDelta: (dir: string, pct: string, delta: string) => string;
  ytdMonthsOf: (included: number, total: number) => string;
  // concentration
  topCustomer: (name: string, share: string) => string;
  reviewDependency: (name: string) => string;
  defaultTopCustomerName: string;
  top5: (share: string) => string;
  assessConcentration: string;
  intercompany: (share: string) => string;
  separateInterco: string;
  externalAccounts: (share: string) => string;
  // mix
  mixLed: (category: string, share: string) => string;
  reviewMix: (category: string) => string;
  topPackage: (label: string, share: string) => string;
  confirmPackage: (label: string) => string;
  // close
  pendingRemain: (countStr: string, one: boolean) => string;
  resolvePending: (countStr: string) => string;
  resolvedDuringClose: (countStr: string, one: boolean) => string;
  noAlerts: string;
  reopensRequired: (countStr: string) => string;
  reviewReopen: string;
  stableNoReopen: string;
};

const EN: NarrativeStrings = {
  localeCode: "en-US",
  gallonsWord: "gallons",
  nouns: {
    activeCustomer: { one: "active customer", other: "active customers" },
    packageType: { one: "package type", other: "package types" },
    operationalAlert: { one: "operational alert", other: "operational alerts" },
    pendingAlert: { one: "pending alert", other: "pending alerts" },
    alert: { one: "alert", other: "alerts" },
    lockedMonth: { one: "locked month", other: "locked months" },
    reopen: { one: "reopen", other: "reopens" },
  },
  sectionTitles: {
    readout: "Executive readout",
    observations: "Key observations",
    focus: "Management focus",
    limitations: "Data limitations",
  },
  closedLine: (period, gallons, customers, packages) =>
    `${period} closed at ${gallons} across ${customers} and ${packages}.`,
  priorMonthLabel: "the prior month",
  priorYearLabel: (year) => `the same month in ${year}`,
  comparisonZeroBase: (direction, deltaText, label) =>
    `Volume ${direction} by ${deltaText} versus ${label}; percentage comparison is not meaningful because the prior base was zero.`,
  comparisonNormal: (direction, pct, deltaText, label) =>
    `Volume ${direction} ${pct} (${deltaText}) versus ${label}.`,
  dirIncreased: "increased",
  dirDecreased: "decreased",
  dirFlat: "was flat",
  noPriorMonth: "Prior-month comparison is not available because no locked prior-month data was found.",
  noPriorYear: "Prior-year comparison is not available because no locked same-month prior-year data was found.",
  noPriorYtd: "Prior-year YTD comparison is not available because comparable locked YTD data was not found.",
  noMix: "Product/package mix is not available because no package volume rows were present.",
  focusMonitorConc: "Continue monitoring customer and package concentration as the next close is prepared.",
  focusUseMovers: "Use current-period movers to confirm whether visible mix shifts require management action.",
  ytdReadoutBase: (gallons, months) => `Year-to-date volume is ${gallons} across ${months}`,
  ytdReadoutNoPrior: (base) => `${base}.`,
  ytdReadoutZeroBase: (base) => `${base}; percentage comparison to prior YTD is not meaningful because the prior base was zero.`,
  ytdReadoutDelta: (base, dir, pct, delta) => `${base}, ${dir} ${pct} (${delta}) versus prior YTD.`,
  ytdDirUp: "up",
  ytdDirDown: "down",
  ytdDirFlat: "flat",
  ytdObsNoPrior: (months) => `YTD includes ${months} locked for the current year; prior-year YTD comparison is not available.`,
  ytdObsZeroBase: (months) => `YTD includes ${months} locked; prior-year percentage comparison is not meaningful because the prior base was zero.`,
  ytdObsDelta: (dir, pct, delta) => `YTD volume is ${dir} ${pct} (${delta}) versus prior YTD.`,
  ytdMonthsOf: (included, total) => `${included} of ${total} months`,
  topCustomer: (name, share) => `${name} represents ${share} of monthly gallons.`,
  reviewDependency: (name) => `Review customer dependency for ${name} before the next board cycle.`,
  defaultTopCustomerName: "The top customer",
  top5: (share) => `The top five customers account for ${share} of monthly gallons.`,
  assessConcentration: "Assess whether top-customer concentration changes commercial or operational exposure.",
  intercompany: (share) => `Intercompany volume represents ${share} of monthly gallons; external demand should be reviewed separately.`,
  separateInterco: "Separate intercompany volume from external demand when reviewing market-facing performance.",
  externalAccounts: (share) => `External accounts represent ${share} of monthly gallons.`,
  mixLed: (category, share) => `Product mix is led by ${category} at ${share} of monthly gallons.`,
  reviewMix: (category) => `Review whether the ${category} mix concentration affects near-term production and supply planning.`,
  topPackage: (label, share) => `${label} is the largest package at ${share} of monthly gallons.`,
  confirmPackage: (label) => `Confirm whether ${label} concentration changes inventory, capacity, or service-risk assumptions.`,
  pendingRemain: (countStr, one) => `${countStr} ${one ? "remains" : "remain"} pending after close.`,
  resolvePending: (countStr) => `Resolve or disposition ${countStr} before distribution follow-up.`,
  resolvedDuringClose: (countStr, one) => `${countStr} ${one ? "was" : "were"} resolved during close, with no pending alerts remaining.`,
  noAlerts: "No operational alerts were recorded for this close.",
  reopensRequired: (countStr) => `The period required ${countStr} before final lock.`,
  reviewReopen: "Review reopen drivers and confirm the final locked file is the version used for board distribution.",
  stableNoReopen: "The period remained stable after first lock; no reopens were recorded.",
};

const ES: NarrativeStrings = {
  localeCode: "es-ES",
  gallonsWord: "galones",
  nouns: {
    activeCustomer: { one: "cliente activo", other: "clientes activos" },
    packageType: { one: "tipo de presentación", other: "tipos de presentación" },
    operationalAlert: { one: "alerta operativa", other: "alertas operativas" },
    pendingAlert: { one: "alerta pendiente", other: "alertas pendientes" },
    alert: { one: "alerta", other: "alertas" },
    lockedMonth: { one: "mes bloqueado", other: "meses bloqueados" },
    reopen: { one: "reapertura", other: "reaperturas" },
  },
  sectionTitles: {
    readout: "Resumen ejecutivo",
    observations: "Observaciones clave",
    focus: "Foco de gestión",
    limitations: "Limitaciones de datos",
  },
  closedLine: (period, gallons, customers, packages) =>
    `${period} cerró en ${gallons} entre ${customers} y ${packages}.`,
  priorMonthLabel: "el mes anterior",
  priorYearLabel: (year) => `el mismo mes de ${year}`,
  comparisonZeroBase: (direction, deltaText, label) =>
    `El volumen ${direction} en ${deltaText} frente a ${label}; la comparación porcentual no es significativa porque la base anterior era cero.`,
  comparisonNormal: (direction, pct, deltaText, label) =>
    `El volumen ${direction} ${pct} (${deltaText}) frente a ${label}.`,
  dirIncreased: "aumentó",
  dirDecreased: "disminuyó",
  dirFlat: "se mantuvo plano",
  noPriorMonth: "La comparación con el mes anterior no está disponible porque no se encontraron datos bloqueados del mes anterior.",
  noPriorYear: "La comparación interanual no está disponible porque no se encontraron datos bloqueados del mismo mes del año anterior.",
  noPriorYtd: "La comparación acumulada interanual no está disponible porque no se encontraron datos acumulados bloqueados comparables.",
  noMix: "La mezcla de productos/presentaciones no está disponible porque no había filas de volumen por presentación.",
  focusMonitorConc: "Continuar monitoreando la concentración de clientes y presentaciones a medida que se prepara el próximo cierre.",
  focusUseMovers: "Usar los impulsores del período actual para confirmar si los cambios de mezcla visibles requieren acción de la gerencia.",
  ytdReadoutBase: (gallons, months) => `El volumen acumulado del año es ${gallons} en ${months}`,
  ytdReadoutNoPrior: (base) => `${base}.`,
  ytdReadoutZeroBase: (base) => `${base}; la comparación porcentual con el acumulado anterior no es significativa porque la base anterior era cero.`,
  ytdReadoutDelta: (base, dir, pct, delta) => `${base}, ${dir} ${pct} (${delta}) frente al acumulado del año anterior.`,
  ytdDirUp: "arriba",
  ytdDirDown: "abajo",
  ytdDirFlat: "plano",
  ytdObsNoPrior: (months) => `El acumulado incluye ${months} bloqueados para el año actual; la comparación acumulada con el año anterior no está disponible.`,
  ytdObsZeroBase: (months) => `El acumulado incluye ${months} bloqueados; la comparación porcentual con el año anterior no es significativa porque la base anterior era cero.`,
  ytdObsDelta: (dir, pct, delta) => `El volumen acumulado está ${dir} ${pct} (${delta}) frente al acumulado del año anterior.`,
  ytdMonthsOf: (included, total) => `${included} de ${total} meses`,
  topCustomer: (name, share) => `${name} representa ${share} de los galones mensuales.`,
  reviewDependency: (name) => `Revisar la dependencia del cliente ${name} antes del próximo ciclo del directorio.`,
  defaultTopCustomerName: "El cliente principal",
  top5: (share) => `Los cinco clientes principales representan ${share} de los galones mensuales.`,
  assessConcentration: "Evaluar si la concentración del cliente principal cambia la exposición comercial u operativa.",
  intercompany: (share) => `El volumen intercompañía representa ${share} de los galones mensuales; la demanda externa debe revisarse por separado.`,
  separateInterco: "Separar el volumen intercompañía de la demanda externa al revisar el desempeño de mercado.",
  externalAccounts: (share) => `Las cuentas externas representan ${share} de los galones mensuales.`,
  mixLed: (category, share) => `La mezcla de productos está liderada por ${category} con ${share} de los galones mensuales.`,
  reviewMix: (category) => `Revisar si la concentración de la mezcla de ${category} afecta la planificación de producción y suministro a corto plazo.`,
  topPackage: (label, share) => `${label} es la presentación más grande con ${share} de los galones mensuales.`,
  confirmPackage: (label) => `Confirmar si la concentración de ${label} cambia los supuestos de inventario, capacidad o riesgo de servicio.`,
  pendingRemain: (countStr) => `${countStr} permanece(n) pendiente(s) tras el cierre.`,
  resolvePending: (countStr) => `Resolver o disponer ${countStr} antes del seguimiento de distribución.`,
  resolvedDuringClose: (countStr) => `${countStr} se resolvió(eron) durante el cierre, sin alertas pendientes restantes.`,
  noAlerts: "No se registraron alertas operativas en este cierre.",
  reopensRequired: (countStr) => `El período requirió ${countStr} antes del bloqueo final.`,
  reviewReopen: "Revisar las causas de las reaperturas y confirmar que el archivo bloqueado final es la versión usada para la distribución al directorio.",
  stableNoReopen: "El período se mantuvo estable tras el primer bloqueo; no se registraron reaperturas.",
};

function strings(locale: Locale): NarrativeStrings {
  return locale === "es" ? ES : EN;
}

export function generateBoardNarrative(view: BoardExecutiveDashboard, locale: Locale = "en"): BoardNarrative {
  const S = strings(locale);
  const keyObservations: BoardNarrativeBullet[] = [];
  const managementFocus: BoardNarrativeBullet[] = [];
  const limitations: BoardNarrativeBullet[] = [];

  const totalGallons = view.currentMetrics.total_gallons;
  const customerCount = view.currentMetrics.customer_count;
  const packageCount = view.currentMetrics.package_count;

  const readout: string[] = [
    S.closedLine(
      view.period.label,
      formatGallons(totalGallons, S),
      formatCount(customerCount, S.nouns.activeCustomer, S),
      formatCount(packageCount, S.nouns.packageType, S)
    ),
  ];

  const mom = comparisonSentence(view.priorMonth, S.priorMonthLabel, S);
  if (mom) {
    readout.push(mom.text);
    keyObservations.push({ text: mom.observation, severity: mom.severity });
  } else {
    limitations.push({ text: S.noPriorMonth, severity: "neutral" });
  }

  const yoy = comparisonSentence(view.priorYear, S.priorYearLabel(view.period.year - 1), S);
  if (yoy) {
    keyObservations.push({ text: yoy.observation, severity: yoy.severity });
  } else {
    limitations.push({ text: S.noPriorYear, severity: "neutral" });
  }

  if (view.ytd.months_included > 0) {
    readout.push(ytdReadout(view, S));
    keyObservations.push({
      text: ytdObservation(view, S),
      severity: view.ytd.delta_gallons === null ? "neutral" : severityForDelta(view.ytd.delta_gallons),
    });
  }

  if (view.ytd.prior_year_gallons === null) {
    limitations.push({ text: S.noPriorYtd, severity: "neutral" });
  }

  addCloseNarrative(view, keyObservations, managementFocus, S);
  addConcentrationNarrative(view, keyObservations, managementFocus, S);
  addMixNarrative(view, keyObservations, managementFocus, limitations, S);

  if (managementFocus.length < 2) {
    managementFocus.push({ text: S.focusMonitorConc, severity: "neutral" });
  }
  if (managementFocus.length < 2) {
    managementFocus.push({ text: S.focusUseMovers, severity: "neutral" });
  }

  const sections: BoardNarrativeSection[] = [
    { id: "executive-readout", title: S.sectionTitles.readout, paragraphs: [readout.slice(0, 4).join(" ")] },
    { id: "key-observations", title: S.sectionTitles.observations, bullets: selectKeyObservations(keyObservations) },
    { id: "management-focus", title: S.sectionTitles.focus, bullets: managementFocus.slice(0, 5) },
  ];

  if (limitations.length > 0) {
    sections.push({ id: "data-limitations", title: S.sectionTitles.limitations, bullets: dedupeBullets(limitations) });
  }

  return { sections };
}

function addConcentrationNarrative(
  view: BoardExecutiveDashboard,
  observations: BoardNarrativeBullet[],
  focus: BoardNarrativeBullet[],
  S: NarrativeStrings
) {
  const concentration = view.customerConcentration;

  if (concentration.top_customer_share !== null) {
    const severity = concentration.top_customer_share >= TOP_CUSTOMER_RISK
      ? "risk"
      : concentration.top_customer_share >= TOP_CUSTOMER_WATCH ? "watch" : "neutral";
    const name = concentration.top_customer_name ?? S.defaultTopCustomerName;
    observations.push({
      text: S.topCustomer(name, formatShare(concentration.top_customer_share, S)),
      severity,
    });
    if (severity !== "neutral") {
      focus.push({ text: S.reviewDependency(name), severity });
    }
  }

  if (concentration.top5_share !== null && concentration.top5_share >= TOP5_WATCH) {
    const severity = concentration.top5_share >= TOP5_RISK ? "risk" : "watch";
    observations.push({ text: S.top5(formatShare(concentration.top5_share, S)), severity });
    focus.push({ text: S.assessConcentration, severity });
  }

  if (concentration.intercompany_share !== null) {
    if (concentration.intercompany_share >= INTERCOMPANY_WATCH) {
      observations.push({ text: S.intercompany(formatShare(concentration.intercompany_share, S)), severity: "watch" });
      focus.push({ text: S.separateInterco, severity: "watch" });
    } else if (concentration.external_share !== null) {
      observations.push({ text: S.externalAccounts(formatShare(concentration.external_share, S)), severity: "neutral" });
    }
  }
}

function addMixNarrative(
  view: BoardExecutiveDashboard,
  observations: BoardNarrativeBullet[],
  focus: BoardNarrativeBullet[],
  limitations: BoardNarrativeBullet[],
  S: NarrativeStrings
) {
  const topSlice = view.categoryMix.slices[0] ?? null;
  if (topSlice) {
    const severity = topSlice.share >= CATEGORY_WATCH ? "watch" : "neutral";
    observations.push({ text: S.mixLed(topSlice.category, formatShare(topSlice.share, S)), severity });
    if (severity === "watch") {
      focus.push({ text: S.reviewMix(topSlice.category), severity });
    }
  } else {
    limitations.push({ text: S.noMix, severity: "neutral" });
  }

  const topPackage = view.topPackages[0] ?? null;
  if (topPackage?.share_pct !== null && topPackage?.share_pct !== undefined) {
    const severity = topPackage.share_pct >= PACKAGE_WATCH ? "watch" : "neutral";
    observations.push({ text: S.topPackage(topPackage.package_label, formatShare(topPackage.share_pct, S)), severity });
    if (severity === "watch") {
      focus.push({ text: S.confirmPackage(topPackage.package_label), severity });
    }
  }
}

function addCloseNarrative(
  view: BoardExecutiveDashboard,
  observations: BoardNarrativeBullet[],
  focus: BoardNarrativeBullet[],
  S: NarrativeStrings
) {
  const pending = view.alertSummary.pending_alerts_total;
  const resolved = view.alertSummary.resolved_alerts_total;

  if (pending > 0) {
    observations.push({
      text: S.pendingRemain(formatCount(pending, S.nouns.operationalAlert, S), pending === 1),
      severity: "risk",
    });
    focus.push({ text: S.resolvePending(formatCount(pending, S.nouns.pendingAlert, S)), severity: "risk" });
  } else if (resolved > 0) {
    observations.push({
      text: S.resolvedDuringClose(formatCount(resolved, S.nouns.alert, S), resolved === 1),
      severity: "positive",
    });
  } else {
    observations.push({ text: S.noAlerts, severity: "neutral" });
  }

  if (view.reopenCount > 0) {
    observations.push({ text: S.reopensRequired(formatCount(view.reopenCount, S.nouns.reopen, S)), severity: "watch" });
    focus.push({ text: S.reviewReopen, severity: "watch" });
  } else {
    observations.push({ text: S.stableNoReopen, severity: "positive" });
  }
}

function comparisonSentence(
  comparison: (ExecDeltaSet & { total_gallons: number }) | null,
  label: string,
  S: NarrativeStrings
): { text: string; observation: string; severity: NarrativeSeverity } | null {
  if (!comparison) return null;

  const deltaGallons = comparison.delta_gallons;
  if (deltaGallons === null) return null;
  const deltaPct = comparison.delta_pct;
  const severity = severityForDelta(deltaGallons ?? 0);
  const direction = deltaGallons === 0 ? S.dirFlat : deltaGallons > 0 ? S.dirIncreased : S.dirDecreased;
  const deltaText = formatSignedGallons(deltaGallons, S);

  if (deltaPct === null) {
    const s = S.comparisonZeroBase(direction, deltaText, label);
    return { text: s, observation: s, severity };
  }

  const sentence = S.comparisonNormal(direction, formatAbsPercent(deltaPct, S), deltaText, label);
  return { text: sentence, observation: sentence, severity };
}

function ytdReadout(view: BoardExecutiveDashboard, S: NarrativeStrings): string {
  const base = S.ytdReadoutBase(
    formatGallons(view.ytd.current_year_gallons, S),
    formatCount(view.ytd.months_included, S.nouns.lockedMonth, S)
  );
  if (view.ytd.prior_year_gallons === null) return S.ytdReadoutNoPrior(base);
  if (view.ytd.delta_gallons === null || view.ytd.delta_pct === null) return S.ytdReadoutZeroBase(base);
  const dir = view.ytd.delta_gallons === 0 ? S.ytdDirFlat : view.ytd.delta_gallons > 0 ? S.ytdDirUp : S.ytdDirDown;
  return S.ytdReadoutDelta(base, dir, formatAbsPercent(view.ytd.delta_pct, S), formatSignedGallons(view.ytd.delta_gallons, S));
}

function ytdObservation(view: BoardExecutiveDashboard, S: NarrativeStrings): string {
  const months = S.ytdMonthsOf(view.ytd.months_included, view.ytd.months_included + view.ytd.months_missing);
  if (view.ytd.prior_year_gallons === null) return S.ytdObsNoPrior(months);
  if (view.ytd.delta_gallons === null || view.ytd.delta_pct === null) return S.ytdObsZeroBase(months);
  const dir = view.ytd.delta_gallons === 0 ? S.ytdDirFlat : view.ytd.delta_gallons > 0 ? S.ytdDirUp : S.ytdDirDown;
  return S.ytdObsDelta(dir, formatAbsPercent(view.ytd.delta_pct, S), formatSignedGallons(view.ytd.delta_gallons, S));
}

function severityForDelta(delta: number): NarrativeSeverity {
  if (delta > 0) return "positive";
  if (delta < 0) return "risk";
  return "neutral";
}

function formatGallons(value: number, S: NarrativeStrings): string {
  return `${Math.round(value).toLocaleString(S.localeCode)} ${S.gallonsWord}`;
}

function formatCount(value: number, noun: CountNoun, S: NarrativeStrings): string {
  const rounded = Math.round(value);
  return `${rounded.toLocaleString(S.localeCode)} ${rounded === 1 ? noun.one : noun.other}`;
}

function formatShare(value: number, S: NarrativeStrings): string {
  return formatAbsPercent(value, S);
}

function formatAbsPercent(value: number, S: NarrativeStrings): string {
  return `${Math.abs(value * 100).toLocaleString(S.localeCode, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function formatSignedGallons(value: number, S: NarrativeStrings): string {
  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toLocaleString(S.localeCode)} ${S.gallonsWord}`;
}

function dedupeBullets(bullets: BoardNarrativeBullet[]): BoardNarrativeBullet[] {
  const seen = new Set<string>();
  return bullets.filter((bullet) => {
    if (seen.has(bullet.text)) return false;
    seen.add(bullet.text);
    return true;
  });
}

function selectKeyObservations(bullets: BoardNarrativeBullet[]): BoardNarrativeBullet[] {
  const unique = dedupeBullets(bullets);
  const urgent = unique.filter((bullet) => bullet.severity === "risk" || bullet.severity === "watch");
  const remaining = unique.filter((bullet) => bullet.severity !== "risk" && bullet.severity !== "watch");
  return [...urgent, ...remaining].slice(0, 6);
}
