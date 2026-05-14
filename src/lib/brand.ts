/**
 * U1Dynamics brand constants and number/date formatters.
 *
 * Defaults to en-US (the dashboard UI runs in English). The es-ES variants
 * are available for the board deck workflow, which is generated separately
 * and remains in Spanish.
 *
 * Colors and typography match the board deck (navy/red, Georgia for
 * headings, Calibri for body).
 */
export const BRAND = {
  colors: {
    navy: "#003C71",
    navyDeep: "#002647",
    red: "#E1261C",
    white: "#FFFFFF",
    lightGray: "#F5F5F5",
    gray: "#595959",
    grayLight: "#BFBFBF",
    success: "#2E7D32",
  },
  fonts: {
    heading: 'Georgia, "Times New Roman", serif',
    body: 'Calibri, "Segoe UI", Arial, sans-serif',
  },
};

const MONTHS_EN = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const MONTHS_ES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

export type Locale = "en" | "es";

/**
 * Format a (year, month) as a short period label.
 *   formatPeriod(2026, 3)       → "Mar 2026"
 *   formatPeriod(2026, 3, "es") → "Mar 2026"
 *   formatPeriod(2025, 12, "es") → "Dic 2025"
 */
export function formatPeriod(
  year: number,
  month: number,
  locale: Locale = "en"
): string {
  const months = locale === "es" ? MONTHS_ES : MONTHS_EN;
  return `${months[month - 1]} ${year}`;
}

/**
 * Format a number with locale-appropriate thousands and decimal separators.
 *   fmtNum(175319.376)            → "175,319"
 *   fmtNum(175319.376, 3)         → "175,319.376"
 *   fmtNum(175319.376, 0, "es")   → "175.319"
 */
export function fmtNum(
  n: number | null | undefined,
  decimals = 0,
  locale: Locale = "en"
): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const localeCode = locale === "es" ? "es-ES" : "en-US";
  return Number(n).toLocaleString(localeCode, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a fractional value as a percentage.
 *   fmtPct(0.483)               → "+48.3%"
 *   fmtPct(-0.12, 1, false)     → "-12.0%"
 *   fmtPct(0.931, 1, false)     → "93.1%"   (share — no "+" prefix)
 */
export function fmtPct(
  n: number | null | undefined,
  decimals = 1,
  showSign = true,
  locale: Locale = "en"
): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const sign = showSign && n > 0 ? "+" : "";
  const localeCode = locale === "es" ? "es-ES" : "en-US";
  return (
    sign +
    Number(n * 100).toLocaleString(localeCode, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }) +
    "%"
  );
}
