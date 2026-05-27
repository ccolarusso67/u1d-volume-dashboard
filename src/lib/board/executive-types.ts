/**
 * src/lib/board/executive-types.ts
 *
 * PR 005A — Shape returned by getBoardExecutiveDashboard().
 *
 * Superset of BoardPeriodView (PR 004A) with YoY, YTD, trends, customer
 * intelligence, category mix, and management-attention fields. Keep both
 * types side-by-side so the PR-004D email send path and other callers
 * that depend on BoardPeriodView keep working unchanged.
 */
import type { BoardPeriodView } from "./types";
import type { MixSliceRow } from "./mix";

export type ExecMetricSet = {
  total_gallons: number;
  customer_count: number;
  package_count: number;
  fact_row_count: number;
};

export type ExecDeltaSet = {
  delta_gallons: number | null;
  delta_pct: number | null;
};

export type ExecTrendRow = {
  period_year: number;
  period_month: number;
  label: string;
  total_gallons: number;
  is_locked: boolean;
};

export type ExecCustomerRow = {
  customer_key: string | null;
  customer_name: string;
  is_intercompany: boolean;
  gallons: number;
  share_pct: number | null;
  prior_month_gallons: number | null;
  prior_year_gallons: number | null;
  mom_delta_gallons: number | null;
  mom_delta_pct: number | null;
  yoy_delta_gallons: number | null;
  yoy_delta_pct: number | null;
};

export type ExecPackageRow = {
  package_key: string | null;
  package_label: string;
  family: string;
  gallons: number;
  share_pct: number | null;
  prior_month_gallons: number | null;
  prior_year_gallons: number | null;
  mom_delta_gallons: number | null;
  mom_delta_pct: number | null;
  yoy_delta_gallons: number | null;
  yoy_delta_pct: number | null;
};

export type ExecMoverRow = {
  key: string;
  display_name: string;
  current: number;
  prior: number;
  delta_gallons: number;
  delta_pct: number | null;
};

export type BoardExecutiveDashboard = {
  /** Period info (label, status, locked metadata). */
  period: BoardPeriodView["period"];
  /** Readiness gate (mirrors BoardPeriodView). */
  readiness: BoardPeriodView["readiness"];
  /** Active file metadata (mirrors BoardPeriodView). */
  activeFile: BoardPeriodView["activeFile"];

  // ---- Executive snapshot ----
  currentMetrics: ExecMetricSet;
  priorMonth: (ExecMetricSet & ExecDeltaSet) | null;
  priorYear: (ExecMetricSet & ExecDeltaSet) | null;
  ytd: {
    current_year_gallons: number;
    prior_year_gallons: number | null;
    delta_gallons: number | null;
    delta_pct: number | null;
    months_included: number;
    months_missing: number;
  };
  reopenCount: number;

  // ---- Volume trends ----
  trend6: ExecTrendRow[];
  trend12: ExecTrendRow[];

  // ---- Customer intelligence ----
  topCustomers: ExecCustomerRow[];
  customerConcentration: {
    top_customer_share: number | null;
    top_customer_name: string | null;
    top5_share: number | null;
    intercompany_share: number | null;
    external_share: number | null;
  };
  customerMovers: {
    topGainers: ExecMoverRow[];
    topDecliners: ExecMoverRow[];
  };

  // ---- Product / package mix ----
  topPackages: ExecPackageRow[];
  categoryMix: {
    total_gallons: number;
    slices: MixSliceRow[];
  };
  packageMovers: {
    topGainers: ExecMoverRow[];
    topDecliners: ExecMoverRow[];
  };

  // ---- Operational narrative + management attention ----
  operatorNotes: BoardPeriodView["operatorNotes"];

  // ---- Close quality / audit ----
  alertSummary: BoardPeriodView["alertSummary"];
  lockHistory: BoardPeriodView["lockHistory"];
};
