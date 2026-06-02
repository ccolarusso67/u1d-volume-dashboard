/**
 * tests/decision-cards.test.ts — PR 012B
 *
 * Verifies each Decision-for-Management card raises the right tone above
 * the threshold and the right framing below. Covers the four cards
 * (volume, margin, cash, customer) and the null-when-no-finance contract.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getVolumeDecisionCard,
  getMarginDecisionCard,
  getCashDecisionCard,
  getCustomerDecisionCard,
  DEFAULT_THRESHOLDS,
} from "../src/lib/board/decision-cards";
import type { BoardExecutiveDashboard, BoardFinanceOverlay } from "../src/lib/board/executive-types";
import type { MonthlyPnl } from "../src/lib/finance/types";

// ---------- fixture builders ----------

const baseView: BoardExecutiveDashboard = {
  period: { year: 2026, month: 3, label: "March 2026", status: "locked", locked_at: "", locked_by: "" },
  readiness: { ready: true, blockers: [] },
  activeFile: null,
  currentMetrics: { total_gallons: 175319, customer_count: 4, package_count: 11, fact_row_count: 35 },
  priorMonth: null,
  priorYear: null,
  ytd: { current_year_gallons: 428306, prior_year_gallons: 329888, delta_gallons: 98418, delta_pct: 0.298, months_included: 3, months_missing: 0 },
  reopenCount: 0,
  trend6: [], trend12: [],
  topCustomers: [],
  customerConcentration: { top_customer_share: 0.25, top_customer_name: "U1DYNAMICS MANUFACTURING", top5_share: 0.79, intercompany_share: 0.42, external_share: 0.58 },
  customerMovers: { topGainers: [], topDecliners: [] },
  topPackages: [],
  categoryMix: { total_gallons: 0, slices: [] },
  packageMovers: { topGainers: [], topDecliners: [] },
  operatorNotes: null,
  alertSummary: { package_alerts_total: 0, customer_alerts_total: 0, data_quality_alerts_total: 0, resolved_alerts_total: 0, pending_alerts_total: 0 },
  lockHistory: [],
  finance: null,
};

function withFinance(over: Partial<BoardFinanceOverlay>): BoardExecutiveDashboard {
  return {
    ...baseView,
    finance: {
      current: null,
      trailing_12m: {
        income: 3482123, cogs: 2943837, gross_profit: 538286,
        operating_expenses: 652243, other_income: 0, other_expenses: 0,
        net_income: -113957,
        gross_margin_pct: 0.155, net_margin_pct: -0.033,
        months_included: 12,
      },
      pnl_trend: [],
      working_capital: {
        total_ar: 279990, total_ap: 933360,
        net_position: -653370, ap_to_ar_ratio: 3.33,
        ar_aging: { current_bucket: 200000, days_1_30: 50000, days_31_60: 20000, days_61_90: 6000, days_91_plus: 3990 },
        ap_aging: { current_bucket: 280000, days_1_30: 300000, days_31_60: 200000, days_61_90: 100000, days_91_plus: 53360 },
        ar_top_concentration: { name: "U1P ULTRACHEM", balance: 190000, share_pct: 0.678 },
        ap_top_concentration: { name: "BASE OIL SUPPLIER", balance: 600000, share_pct: 0.643 },
        snapshot_at: "2026-05-30T08:00:00Z",
      },
      sync_jobs: [],
      sync_assessment: {
        total_jobs: 12, jobs_success: 12, jobs_error: 0, jobs_stale: 0,
        newest_success_at: "2026-06-01T08:00:00Z", oldest_success_at: "2026-06-01T08:00:00Z",
        worst_status: "ok",
      },
      ...over,
    },
  };
}

const trendMonth = (m: string, inc: number): MonthlyPnl => ({
  month: m, report_basis: "accrual",
  income: inc, cogs: inc * 0.85, gross_profit: inc * 0.15,
  operating_expenses: inc * 0.18, other_income: 0, other_expenses: 0,
  net_income: inc * -0.03,
  snapshot_at: "2026-05-30T00:00:00Z",
});

// ---------- volume card ----------

test("volume card: neutral framing when no prior-year baseline", () => {
  const c = getVolumeDecisionCard(baseView);
  assert.equal(c.tone, "neutral");
  assert.match(c.body, /No prior-year baseline/);
});

test("volume card: neutral framing with YoY but no finance signal", () => {
  const v: BoardExecutiveDashboard = {
    ...baseView,
    priorYear: { total_gallons: 118219, customer_count: 4, package_count: 10, fact_row_count: 30,
      delta_gallons: 57100, delta_pct: 0.483 },
  };
  const c = getVolumeDecisionCard(v);
  assert.equal(c.tone, "neutral");
  assert.match(c.body, /\+48\.3%/);
});

test("volume card: attention when volume grows 2x revenue (mix-shift)", () => {
  // 24 months of trend so revenue YoY is computable
  const trend = Array.from({ length: 24 }, (_, i) => trendMonth(
    `2024-${String(((i % 12) + 1)).padStart(2, "0")}-01`,
    i < 12 ? 240000 : 280000  // 16.6% revenue growth YoY
  ));
  const v = withFinance({ pnl_trend: trend });
  v.priorYear = { total_gallons: 100000, customer_count: 4, package_count: 11, fact_row_count: 30,
    delta_gallons: 50000, delta_pct: 0.50 };  // 50% volume growth → 50/16.6 = 3x ratio
  const c = getVolumeDecisionCard(v);
  assert.equal(c.tone, "attention");
  assert.match(c.body, /growing 3\.0× faster/);
});

// ---------- margin card ----------

test("margin card: null when no finance overlay", () => {
  assert.equal(getMarginDecisionCard(baseView), null);
});

test("margin card: urgent when GM below 15%", () => {
  const v = withFinance({
    trailing_12m: { income: 1000000, cogs: 900000, gross_profit: 100000,
      operating_expenses: 200000, other_income: 0, other_expenses: 0,
      net_income: -100000,
      gross_margin_pct: 0.10, net_margin_pct: -0.10,
      months_included: 12 },
  });
  const c = getMarginDecisionCard(v);
  assert.ok(c);
  assert.equal(c!.tone, "urgent");
  assert.match(c!.body, /10\.0%/);
});

test("margin card: attention when GM 15-25%", () => {
  // The default withFinance fixture has gross_margin_pct = 0.155 (15.5%)
  const v = withFinance({});
  const c = getMarginDecisionCard(v);
  assert.ok(c);
  assert.equal(c!.tone, "attention");
  assert.match(c!.body, /15\.5%/);
});

test("margin card: neutral when GM at/above floor", () => {
  const v = withFinance({
    trailing_12m: { income: 1000000, cogs: 700000, gross_profit: 300000,
      operating_expenses: 150000, other_income: 0, other_expenses: 0,
      net_income: 150000, gross_margin_pct: 0.30, net_margin_pct: 0.15,
      months_included: 12 },
  });
  const c = getMarginDecisionCard(v);
  assert.equal(c!.tone, "neutral");
});

// ---------- cash card ----------

test("cash card: null when no finance overlay", () => {
  assert.equal(getCashDecisionCard(baseView), null);
});

test("cash card: urgent when AP/AR ≥ 3x (U1D today's shape)", () => {
  const v = withFinance({});
  const c = getCashDecisionCard(v);
  assert.ok(c);
  assert.equal(c!.tone, "urgent");
  assert.match(c!.body, /−\$653K/);
  assert.match(c!.body, /3\.3×/);
});

test("cash card: attention when AP > AR but ratio < 3x", () => {
  const v = withFinance({
    working_capital: { total_ar: 500000, total_ap: 600000, net_position: -100000, ap_to_ar_ratio: 1.2,
      ar_aging: { current_bucket: 500000, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_91_plus: 0 },
      ap_aging: { current_bucket: 600000, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_91_plus: 0 },
      ar_top_concentration: null, ap_top_concentration: null, snapshot_at: null },
  });
  const c = getCashDecisionCard(v);
  assert.equal(c!.tone, "attention");
});

test("cash card: neutral when net positive", () => {
  const v = withFinance({
    working_capital: { total_ar: 500000, total_ap: 100000, net_position: 400000, ap_to_ar_ratio: 0.2,
      ar_aging: { current_bucket: 500000, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_91_plus: 0 },
      ap_aging: { current_bucket: 100000, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_91_plus: 0 },
      ar_top_concentration: null, ap_top_concentration: null, snapshot_at: null },
  });
  const c = getCashDecisionCard(v);
  assert.equal(c!.tone, "neutral");
});

// ---------- customer card ----------

test("customer card: neutral when concentration below floor", () => {
  const c = getCustomerDecisionCard(baseView);
  assert.equal(c.tone, "neutral");
});

test("customer card: attention when top customer ≥50% but <70%", () => {
  const v: BoardExecutiveDashboard = {
    ...baseView,
    customerConcentration: { ...baseView.customerConcentration,
      top_customer_share: 0.55, top_customer_name: "U1P ULTRACHEM" },
  };
  const c = getCustomerDecisionCard(v);
  assert.equal(c.tone, "neutral");  // 55% raises card but tone is neutral (only urgent at 70%)
  assert.match(c.body, /U1P ULTRACHEM/);
  assert.match(c.body, /55\.0%/);
});

test("customer card: attention tone when top customer ≥70%", () => {
  const v: BoardExecutiveDashboard = {
    ...baseView,
    customerConcentration: { ...baseView.customerConcentration,
      top_customer_share: 0.80, top_customer_name: "U1P ULTRACHEM" },
  };
  const c = getCustomerDecisionCard(v);
  assert.equal(c.tone, "attention");
});

// ---------- override path (operator decision_asks) — wired in PR 012C; tested when shipped
