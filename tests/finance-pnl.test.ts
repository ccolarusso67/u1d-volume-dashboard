/**
 * tests/finance-pnl.test.ts — PR 012A
 *
 * Verifies the monthly P&L helpers (1) filter by company_id = 'u1dynamics'
 * explicitly (no relying on the finance MCP fallback), (2) return null for
 * missing periods, (3) aggregate trailing-12 correctly, and (4) derive
 * margin percentages with zero-revenue safety.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TestPool } from "./test-pool";
import {
  getMonthlyPnl,
  getMonthlyPnlRange,
  getTrailing12MonthsPnl,
  aggregatePnl,
} from "../src/lib/finance/get-monthly-pnl";

const SAMPLE = {
  income: 290000,
  cogs: 245000,
  gross_profit: 45000,
  operating_expenses: 60000,
  other_income: 0,
  other_expenses: 0,
  net_income: -15000,
};

test("getMonthlyPnl: filters by company_id and returns row", async () => {
  const pool = new TestPool({
    responders: [
      (t, params) => {
        if (!t.includes("FROM monthly_pnl")) return null;
        // Hard requirement: company_id must be passed as the first param
        // and the SQL must reference $1 for company_id.
        assert.equal((params as unknown[])[0], "u1dynamics");
        assert.equal((params as unknown[])[1], "2026-03-01");
        assert.equal((params as unknown[])[2], "accrual");
        assert.ok(t.includes("WHERE company_id = $1"));
        return {
          rows: [{
            month: "2026-03-01", report_basis: "accrual", ...SAMPLE,
            snapshot_at: "2026-05-30T12:00:00Z",
          }],
        };
      },
    ],
  });
  const row = await getMonthlyPnl(pool as unknown as import("pg").Pool, 2026, 3);
  assert.ok(row);
  assert.equal(row!.income, 290000);
  assert.equal(row!.net_income, -15000);
});

test("getMonthlyPnl: returns null when no row", async () => {
  const pool = new TestPool({
    responders: [(t) => (t.includes("FROM monthly_pnl") ? { rows: [] } : null)],
  });
  const row = await getMonthlyPnl(pool as unknown as import("pg").Pool, 2026, 7);
  assert.equal(row, null);
});

test("getMonthlyPnl: SQL error returns null (safeQuery contract)", async () => {
  const pool = {
    async query() { throw new Error("relation monthly_pnl does not exist"); },
  } as unknown as import("pg").Pool;
  const row = await getMonthlyPnl(pool, 2026, 3);
  assert.equal(row, null);
});

test("getMonthlyPnlRange: ASC order, both bounds inclusive", async () => {
  const pool = new TestPool({
    responders: [
      (t, params) => {
        if (!t.includes("FROM monthly_pnl")) return null;
        assert.equal((params as unknown[])[0], "u1dynamics");
        assert.equal((params as unknown[])[1], "2025-04-01");
        assert.equal((params as unknown[])[2], "2026-03-01");
        assert.ok(t.includes("ORDER BY month ASC"));
        return {
          rows: [
            { month: "2025-04-01", report_basis: "accrual", ...SAMPLE, snapshot_at: "2026-05-30T00:00:00Z" },
            { month: "2025-05-01", report_basis: "accrual", ...SAMPLE, snapshot_at: "2026-05-30T00:00:00Z" },
          ],
        };
      },
    ],
  });
  const rows = await getMonthlyPnlRange(pool as unknown as import("pg").Pool, "2025-04-01", "2026-03-01");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].month, "2025-04-01");
});

test("getTrailing12MonthsPnl: queries 12-month window ending at asOf, aggregates", async () => {
  const months = [
    "2025-04-01","2025-05-01","2025-06-01","2025-07-01","2025-08-01","2025-09-01",
    "2025-10-01","2025-11-01","2025-12-01","2026-01-01","2026-02-01","2026-03-01",
  ];
  const pool = new TestPool({
    responders: [
      (t, params) => {
        if (!t.includes("FROM monthly_pnl")) return null;
        assert.equal((params as unknown[])[0], "u1dynamics");
        // Start should be 11 months before end (12 months inclusive)
        assert.equal((params as unknown[])[1], "2025-04-01");
        assert.equal((params as unknown[])[2], "2026-03-01");
        return {
          rows: months.map((m) => ({
            month: m, report_basis: "accrual", ...SAMPLE,
            snapshot_at: "2026-05-30T00:00:00Z",
          })),
        };
      },
    ],
  });
  const agg = await getTrailing12MonthsPnl(pool as unknown as import("pg").Pool, 2026, 3);
  assert.equal(agg.months_included, 12);
  assert.equal(agg.income, 290000 * 12);
  assert.equal(agg.net_income, -15000 * 12);
  // 45k / 290k ≈ 0.155
  assert.ok(Math.abs(agg.gross_margin_pct - 45000 / 290000) < 1e-9);
  assert.ok(Math.abs(agg.net_margin_pct - -15000 / 290000) < 1e-9);
});

test("aggregatePnl: empty array returns zeros, margins = 0", () => {
  const agg = aggregatePnl([]);
  assert.equal(agg.income, 0);
  assert.equal(agg.gross_margin_pct, 0);
  assert.equal(agg.net_margin_pct, 0);
  assert.equal(agg.months_included, 0);
});

test("aggregatePnl: zero revenue with non-zero expense returns 0 margins (no div-by-0)", () => {
  const agg = aggregatePnl([
    { month: "2026-03-01", report_basis: "accrual",
      income: 0, cogs: 0, gross_profit: 0,
      operating_expenses: 5000, other_income: 0, other_expenses: 0,
      net_income: -5000, snapshot_at: "" },
  ]);
  assert.equal(agg.gross_margin_pct, 0);
  assert.equal(agg.net_margin_pct, 0);
  assert.equal(agg.net_income, -5000);
});
