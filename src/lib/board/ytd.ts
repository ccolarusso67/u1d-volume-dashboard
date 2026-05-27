/**
 * src/lib/board/ytd.ts
 *
 * PR 005A — Pure helper: aggregate YTD totals + month-by-month trend rows.
 */

export type MonthTotalRow = {
  period_year: number;
  period_month: number;
  total_gallons: number;
};

export type YtdResult = {
  ytd_gallons: number;
  months_included: number;
  months_missing: number;
};

/**
 * Sum locked monthly totals from January through `throughMonth` inclusive
 * for `year`. Returns the count of months that actually had data so the
 * UI can render "YTD (4 of 5 months locked)".
 */
export function aggregateYtd(
  rows: MonthTotalRow[],
  year: number,
  throughMonth: number
): YtdResult {
  let total = 0;
  let included = 0;
  for (const r of rows) {
    if (r.period_year !== year) continue;
    if (r.period_month < 1 || r.period_month > throughMonth) continue;
    total += Number.isFinite(r.total_gallons) ? r.total_gallons : 0;
    included += 1;
  }
  return {
    ytd_gallons: total,
    months_included: included,
    months_missing: throughMonth - included,
  };
}
