/**
 * src/lib/i18n/dictionaries.ts
 *
 * EN/ES string tables for the dashboard UI. English is the source of truth:
 * `Dict = typeof en`, so the Spanish table is compile-time forced to define
 * every key the English one does. Add a key to `en`, and TypeScript will fail
 * the build until `es` has it too. This is what guarantees "nothing left
 * untranslated" for the whole-app pass.
 *
 * Number / date formatting is NOT here — that lives in brand.ts (fmtNum,
 * fmtPct, formatPeriod) and already takes a locale argument.
 */
import type { Locale } from "./locale";

const en = {
  nav: {
    overview: "Overview",
    customers: "Customers",
    products: "Products",
    production: "Production",
    reconciliation: "Reconciliation",
    board: "Board",
    admin: "Admin",
    language: "Language",
  },
  common: {
    company: "U1DYNAMICS MANUFACTURING LLC",
    gallons: "gallons",
    total: "TOTAL",
    line: "Line",
    revenue: "Revenue",
  },
  production: {
    title: "Production",
    noData: "No production data loaded yet.",
    subtitle: (period: string, gallons: string, days: number) =>
      `Latest month: ${period} · ${gallons} gallons · ${days} working days`,
    kpiMonthProduction: "Month Production",
    kpiMonthProductionSub: "gallons produced",
    kpiDailyAverage: "Daily Average",
    kpiDailyAverageSub: (days: number) => `across ${days} working days`,
    kpiUtilization: "Overall Utilization",
    kpiUtilizationSub: "actual ÷ (target/day × days)",
    kpiHeadroom: "Monthly Headroom",
    kpiHeadroomSub: "gallons of slack vs 80% target",
    capacityTitle: "Capacity vs Actual Production — by Line",
    capacityNote: (period: string) =>
      `${period} · Monthly target = (target gal/day × days that line ran). Bar shows actual ÷ target.`,
    thDaysRun: "Days Run",
    thMaxPerDay: "Max gal/day",
    thTargetPerDay: "Target gal/day",
    thMonthlyTarget: "Monthly Target",
    thProduced: "Produced",
    thUtilization: "Utilization",
    notScheduled: "not scheduled",
    statusAtLimit: "AT LIMIT",
    statusHot: "HOT",
    statusOk: "OK",
    statusRoom: "ROOM",
    statusIdle: "IDLE",
    marginTitle: "Contribution Margin by Filling Line",
    marginWindowLatest: "Latest invoice month",
    marginWindowTrailing: (label: string) => `Trailing ${label}`,
    marginEndingPrefix: "ending",
    marginNoteBody:
      "Revenue − product COGS from QuickBooks (Ultrachem + U1Dynamics, external sales), attributed to each filling line. Excludes filling labor & line overhead (Version B).",
    marginIntercompany: (amount: string) =>
      ` Intercompany eliminated: ${amount} of U1Dynamics→Ultrachem sales removed to avoid double-counting.`,
    marginNotConfigured:
      "Finance warehouse not connected (U1D_FINANCE_DATABASE_URL unset). Margin by line will populate once the finance read replica is wired.",
    marginNoData:
      "No U1Dynamics invoice data in this window yet. As QuickBooks sync populates the u1dynamics entity, contribution margin per line will appear here.",
    thProductCogs: "Product COGS",
    thContribution: "Contribution",
    thMarginPct: "Margin %",
    thGallons: "Gallons",
    thRevPerGal: "$/gal",
    thContribPerGal: "Contrib/gal",
    totalMapped: "TOTAL (mapped)",
    mappedCoverage: (pct: string) => `Mapped ${pct} of window revenue to a line.`,
    unmappedLabel: (amount: string) => ` Unmapped: ${amount}`,
    unmappedTop: (names: string) =>
      ` — top: ${names}. Extend LINE_RULES in line-margin.ts to capture these.`,
    footer:
      "Capacity sourced from u1d_ops.production_lines · Actuals rolled up from u1d_ops.production_daily · Margin from u1p_finance.invoice_lines (read-only, u1dynamics).",
  },
};

export type Dict = typeof en;

const es: Dict = {
  nav: {
    overview: "Resumen",
    customers: "Clientes",
    products: "Productos",
    production: "Producción",
    reconciliation: "Reconciliación",
    board: "Directorio",
    admin: "Administración",
    language: "Idioma",
  },
  common: {
    company: "U1DYNAMICS MANUFACTURING LLC",
    gallons: "galones",
    total: "TOTAL",
    line: "Línea",
    revenue: "Ingresos",
  },
  production: {
    title: "Producción",
    noData: "Aún no se han cargado datos de producción.",
    subtitle: (period: string, gallons: string, days: number) =>
      `Último mes: ${period} · ${gallons} galones · ${days} días hábiles`,
    kpiMonthProduction: "Producción del Mes",
    kpiMonthProductionSub: "galones producidos",
    kpiDailyAverage: "Promedio Diario",
    kpiDailyAverageSub: (days: number) => `en ${days} días hábiles`,
    kpiUtilization: "Utilización General",
    kpiUtilizationSub: "real ÷ (objetivo/día × días)",
    kpiHeadroom: "Margen Mensual",
    kpiHeadroomSub: "galones de holgura vs objetivo 80%",
    capacityTitle: "Capacidad vs Producción Real — por Línea",
    capacityNote: (period: string) =>
      `${period} · Objetivo mensual = (objetivo gal/día × días que operó la línea). La barra muestra real ÷ objetivo.`,
    thDaysRun: "Días Operados",
    thMaxPerDay: "Máx gal/día",
    thTargetPerDay: "Objetivo gal/día",
    thMonthlyTarget: "Objetivo Mensual",
    thProduced: "Producido",
    thUtilization: "Utilización",
    notScheduled: "no programada",
    statusAtLimit: "AL LÍMITE",
    statusHot: "ALTA",
    statusOk: "OK",
    statusRoom: "MARGEN",
    statusIdle: "INACTIVA",
    marginTitle: "Margen de Contribución por Línea de Llenado",
    marginWindowLatest: "Último mes facturado",
    marginWindowTrailing: (label: string) => `Últimos ${label}`,
    marginEndingPrefix: "hasta",
    marginNoteBody:
      "Ingresos − costo de producto desde QuickBooks (Ultrachem + U1Dynamics, ventas externas), atribuido a cada línea de llenado. Excluye mano de obra de llenado y gastos generales de línea (Versión B).",
    marginIntercompany: (amount: string) =>
      ` Intercompañía eliminada: ${amount} de ventas U1Dynamics→Ultrachem removidas para evitar doble conteo.`,
    marginNotConfigured:
      "Almacén financiero no conectado (U1D_FINANCE_DATABASE_URL sin configurar). El margen por línea se completará cuando se conecte la réplica de lectura financiera.",
    marginNoData:
      "Aún no hay datos de facturación de U1Dynamics en esta ventana. A medida que QuickBooks sincronice la entidad u1dynamics, el margen de contribución por línea aparecerá aquí.",
    thProductCogs: "Costo de Producto",
    thContribution: "Contribución",
    thMarginPct: "Margen %",
    thGallons: "Galones",
    thRevPerGal: "$/gal",
    thContribPerGal: "Contrib/gal",
    totalMapped: "TOTAL (mapeado)",
    mappedCoverage: (pct: string) => `Mapeado ${pct} de los ingresos de la ventana a una línea.`,
    unmappedLabel: (amount: string) => ` Sin mapear: ${amount}`,
    unmappedTop: (names: string) =>
      ` — principales: ${names}. Extienda LINE_RULES en line-margin.ts para capturarlos.`,
    footer:
      "Capacidad de u1d_ops.production_lines · Reales consolidados de u1d_ops.production_daily · Margen de u1p_finance.invoice_lines (solo lectura, u1dynamics).",
  },
};

const DICTS: Record<Locale, Dict> = { en, es };

export function getDict(locale: Locale): Dict {
  return DICTS[locale];
}
