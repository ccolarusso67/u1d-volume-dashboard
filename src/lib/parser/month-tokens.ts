/**
 * Map of month tokens that appear in filenames.
 *
 * Matches all U1DYNAMICS_VOLUME_<MONTH>_<YEAR>.xlsx variants we've seen:
 *   JAN (2025), JANUARY (2026), JUNE (2025), JUL (2023),
 *   SEPTIEMBRE (2025), SEPT (2024), SEP (2023),
 *   DECEMBER (2025), DIC (2023, 2024),
 *   ABRIL/ABR/APR/APRIL, etc.
 *
 * We keep Spanish tokens (ENE/AGO/DIC/SEPTIEMBRE) so the parser can ingest
 * historical files written by either workflow.
 */
export const MONTH_TOKENS: Record<string, number> = {
  JAN: 1,  JANUARY: 1,   ENE: 1,  ENERO: 1,
  FEB: 2,  FEBRUARY: 2,  FEBRERO: 2,
  MAR: 3,  MARCH: 3,     MARZO: 3,
  APR: 4,  APRIL: 4,     ABR: 4,  ABRIL: 4,
  MAY: 5,  MAYO: 5,
  JUN: 6,  JUNE: 6,      JUNIO: 6,
  JUL: 7,  JULY: 7,      JULIO: 7,
  AUG: 8,  AUGUST: 8,    AGO: 8,  AGOSTO: 8,
  SEP: 9,  SEPT: 9,      SEPTEMBER: 9, SEPTIEMBRE: 9,
  OCT: 10, OCTOBER: 10,  OCTUBRE: 10,
  NOV: 11, NOVEMBER: 11, NOVIEMBRE: 11,
  DEC: 12, DECEMBER: 12, DIC: 12, DICIEMBRE: 12,
};

/**
 * Parse (year, month) from a filename like:
 *   U1DYNAMICS_VOLUME_MAR_2026.xlsx
 *   U1DYNAMICS_VOLUME_SEPTIEMBRE_2025.xlsx
 *   U1DYNAMICS_VOLUME_DIC_2024.xlsx
 */
export function parsePeriodFromFilename(
  filename: string
): { year: number; month: number } | null {
  const base = filename.replace(/\.xlsx$/i, "");
  const parts = base.split("_");
  if (parts.length < 4) return null;
  const monthToken = parts[2]!.toUpperCase();
  const year = parseInt(parts[3]!, 10);
  if (isNaN(year)) return null;
  const month = MONTH_TOKENS[monthToken];
  if (!month) return null;
  return { year, month };
}
