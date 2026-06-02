/**
 * src/lib/finance/get-monthly-pnl.ts
 *
 * PR 012A — read canonical monthly P&L from the finance Postgres.
 *
 * Source table: u1p_finance.monthly_pnl (one row per company_id × month ×
 * report_basis). Populated by ultra1plus-finance-mcp's PnlSyncJob, which
 * pulls the QuickBooks ProfitAndLossStandard report directly. This is the
 * AUDITED canonical number — do NOT derive P&L from invoice_lines (the
 * connector audit found two bugs that inflate that path by ~2.66x).
 *
 * Three helpers:
 *   - getMonthlyPnl(year, month) — single month
 *   - getMonthlyPnlRange(start, end) — array, one row per month
 *   - getTrailing12MonthsPnl(year, month) — summed aggregate
 */
import type { Pool } from "pg";
import { U1D_COMPANY_ID } from "./db-pool";
import { safeQuery, safeQueryOne } from "./safe-query";
import type { MonthlyPnl, PnlAggregate } from "./types";

type Basis = "accrual" | "cash";

const SELECT_COLS = `
  TO_CHAR(month, 'YYYY-MM-DD') AS month,
  report_basis,
  income, cogs, gross_profit,
  operating_expenses, other_income, other_expenses,
  net_income,
  TO_CHAR(snapshot_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS snapshot_at
`;

/** Single-month P&L for U1Dynamics. Returns null if not synced. */
export async function getMonthlyPnl(
  pool: Pool,
  year: number,
  month: number,
  basis: Basis = "accrual"
): Promise<MonthlyPnl | null> {
  const monthFirst = `${year}-${String(month).padStart(2, "0")}-01`;
  return safeQueryOne<MonthlyPnl>(
    pool,
    `SELECT ${SELECT_COLS}
       FROM monthly_pnl
      WHERE company_id = $1
        AND month = $2::date
        AND report_basis = $3`,
    [U1D_COMPANY_ID, monthFirst, basis]
  );
}

/**
 * Range of monthly P&L rows for U1Dynamics, ordered by month ASC.
 * Both bounds inclusive (YYYY-MM-DD strings, first-of-month).
 */
export async function getMonthlyPnlRange(
  pool: Pool,
  monthStartIso: string,
  monthEndIso: string,
  basis: Basis = "accrual"
): Promise<MonthlyPnl[]> {
  return safeQuery<MonthlyPnl>(
    pool,
    `SELECT ${SELECT_COLS}
       FROM monthly_pnl
      WHERE company_id = $1
        AND month >= $2::date
        AND month <= $3::date
        AND report_basis = $4
      ORDER BY month ASC`,
    [U1D_COMPANY_ID, monthStartIso, monthEndIso, basis]
  );
}

/**
 * Trailing 12 months ending at (and including) the given period.
 *
 * Returns a single aggregate plus derived margin percentages and the count
 * of months actually present in the warehouse (so the board can disclose
 * gap-in-data on the methodology slide if the connector hasn't fully
 * backfilled yet).
 */
export async function getTrailing12MonthsPnl(
  pool: Pool,
  asOfYear: number,
  asOfMonth: number,
  basis: Basis = "accrual"
): Promise<PnlAggregate> {
  // End = first of (asOfYear, asOfMonth). Start = end - 11 months.
  const endDate = new Date(Date.UTC(asOfYear, asOfMonth - 1, 1));
  const startDate = new Date(endDate);
  startDate.setUTCMonth(startDate.getUTCMonth() - 11);
  const startIso = startDate.toISOString().slice(0, 10);
  const endIso = endDate.toISOString().slice(0, 10);
  const rows = await getMonthlyPnlRange(pool, startIso, endIso, basis);
  return aggregatePnl(rows);
}

/** Pure helper — sum a list of monthly P&L rows + derive margin pcts. */
export function aggregatePnl(rows: MonthlyPnl[]): PnlAggregate {
  const sum = rows.reduce(
    (acc, r) => ({
      income: acc.income + Number(r.income),
      cogs: acc.cogs + Number(r.cogs),
      gross_profit: acc.gross_profit + Number(r.gross_profit),
      operating_expenses: acc.operating_expenses + Number(r.operating_expenses),
      other_income: acc.other_income + Number(r.other_income),
      other_expenses: acc.other_expenses + Number(r.other_expenses),
      net_income: acc.net_income + Number(r.net_income),
    }),
    { income: 0, cogs: 0, gross_profit: 0, operating_expenses: 0, other_income: 0, other_expenses: 0, net_income: 0 }
  );
  return {
    ...sum,
    gross_margin_pct: sum.income > 0 ? sum.gross_profit / sum.income : 0,
    net_margin_pct: sum.income > 0 ? sum.net_income / sum.income : 0,
    months_included: rows.length,
  };
}
