/**
 * src/lib/finance/types.ts
 *
 * PR 012A — typed shapes for the finance Postgres rows U1D consumes.
 *
 * Mirrors the columns defined in ultra1plus-finance-mcp/db/migrations/
 * (001_initial_schema + 002_multi_company). U1D reads these views/tables
 * but never writes to them.
 */

export type MonthlyPnl = {
  /** ISO date string YYYY-MM-DD (first of month) */
  month: string;
  /** "accrual" | "cash" */
  report_basis: string;
  income: number;
  cogs: number;
  gross_profit: number;
  operating_expenses: number;
  other_income: number;
  other_expenses: number;
  net_income: number;
  /** ISO timestamp from QB sync */
  snapshot_at: string;
};

export type AgingBuckets = {
  current_bucket: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_91_plus: number;
};

export type ArAgingRow = AgingBuckets & {
  customer_id: string | null;
  customer_name: string;
  total_open_balance: number;
  snapshot_at: string;
};

export type ApAgingRow = AgingBuckets & {
  vendor_name: string;
  total_open_balance: number;
  snapshot_at: string;
};

export type SyncHealthRow = {
  job_name: string;
  /** "idle" | "running" | "success" | "error" */
  status: string;
  last_run_at: string | null;
  last_success_at: string | null;
  records_synced: number;
  error_message: string | null;
};

/** Aggregate of multiple monthly P&L rows (e.g. trailing 12). */
export type PnlAggregate = {
  income: number;
  cogs: number;
  gross_profit: number;
  operating_expenses: number;
  other_income: number;
  other_expenses: number;
  net_income: number;
  gross_margin_pct: number; // 0..1
  net_margin_pct: number;   // 0..1
  months_included: number;
};

/** Working capital snapshot derived from AR + AP aging. */
export type WorkingCapitalSnapshot = {
  total_ar: number;
  total_ap: number;
  /** total_ar - total_ap. Negative = AP exceeds AR. */
  net_position: number;
  /** total_ap / total_ar. null when total_ar is 0. */
  ap_to_ar_ratio: number | null;
  ar_aging: AgingBuckets;
  ap_aging: AgingBuckets;
  ar_top_concentration: { name: string; balance: number; share_pct: number } | null;
  ap_top_concentration: { name: string; balance: number; share_pct: number } | null;
  /** Most recent snapshot_at across AR + AP rows; null if both empty. */
  snapshot_at: string | null;
};
