/**
 * tests/board-financial-layer.test.ts
 *
 * PR 007 — board financial layer adapter and variance math.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateForecastVariance,
  getBoardFinancialLayer,
} from "../src/lib/board/get-board-financial-layer";

test("calculateForecastVariance: favorable when actual is below forecast", () => {
  assert.deepEqual(calculateForecastVariance(1000, 900), {
    forecastCost: 1000,
    actualCost: 900,
    varianceDollars: -100,
    variancePct: -0.1,
    flag: "favorable",
  });
});

test("calculateForecastVariance: unfavorable when actual is above forecast", () => {
  assert.deepEqual(calculateForecastVariance(1000, 1125), {
    forecastCost: 1000,
    actualCost: 1125,
    varianceDollars: 125,
    variancePct: 0.125,
    flag: "unfavorable",
  });
});

test("calculateForecastVariance: handles zero forecast safely", () => {
  assert.deepEqual(calculateForecastVariance(0, 250), {
    forecastCost: 0,
    actualCost: 250,
    varianceDollars: 250,
    variancePct: null,
    flag: "unfavorable",
  });
});

test("calculateForecastVariance: missing inputs return null", () => {
  assert.equal(calculateForecastVariance(null, 250), null);
  assert.equal(calculateForecastVariance(100, undefined), null);
  assert.equal(calculateForecastVariance(Number.NaN, 100), null);
});

test("getBoardFinancialLayer: returns professional empty contract when finance API is not configured", async () => {
  const layer = await getBoardFinancialLayer(2026, 5, { apiBaseUrl: null, companyId: "u1dynamics" });

  assert.equal(layer.companyId, "u1dynamics");
  assert.equal(layer.pnl, null);
  assert.equal(layer.forecastActual, null);
  assert.deepEqual(layer.monthlyTrend, []);
  assert.equal(layer.source.pnlStatus, "not_configured");
  assert.equal(layer.source.forecastStatus, "not_configured");
});

test("getBoardFinancialLayer: maps finance P&L rows for the requested board period", async () => {
  const fetcher = async () => new Response(JSON.stringify({
    monthly: [
      {
        label: "Apr 26",
        month: "2026-04-01",
        income: "9000",
        cogs: "4000",
        gross_profit: "5000",
        operating_expenses: "0",
        net_income: "5000",
      },
      {
        label: "May 26",
        month: "2026-05-01",
        income: "12000",
        cogs: "7000",
        gross_profit: "5000",
        operating_expenses: "2500",
        net_income: "2200",
        report_basis: "accrual",
        snapshot_at: "2026-05-31T12:00:00Z",
      },
    ],
  }), { status: 200 });

  const layer = await getBoardFinancialLayer(2026, 5, {
    apiBaseUrl: "https://finance.example.test",
    companyId: "u1dynamics",
    fetcher,
  });

  assert.equal(layer.source.pnlStatus, "available");
  assert.equal(layer.pnl?.revenue, 12000);
  assert.equal(layer.pnl?.cogs, 7000);
  assert.equal(layer.pnl?.grossProfit, 5000);
  assert.equal(layer.pnl?.grossMarginPct, 5000 / 12000);
  assert.equal(layer.pnl?.operatingExpenses, 2500);
  assert.equal(layer.pnl?.netIncome, 2200);
  assert.equal(layer.monthlyTrend.length, 2);
});

test("getBoardFinancialLayer: does not trust estimated route zeroes as full P&L opex/net income", async () => {
  const fetcher = async () => new Response(JSON.stringify({
    monthly: [
      {
        label: "May 26",
        month: "2026-05-01",
        income: 12000,
        cogs: 7000,
        gross_profit: 5000,
        operating_expenses: 0,
        net_income: 5000,
      },
    ],
  }), { status: 200 });

  const layer = await getBoardFinancialLayer(2026, 5, {
    apiBaseUrl: "https://finance.example.test",
    companyId: "u1dynamics",
    fetcher,
  });

  assert.equal(layer.pnl?.revenue, 12000);
  assert.equal(layer.pnl?.operatingExpenses, null);
  assert.equal(layer.pnl?.netIncome, null);
});
