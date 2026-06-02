/**
 * tests/finance-aging.test.ts — PR 012A
 *
 * Verifies the AR and AP aging helpers filter by company_id, order by
 * largest balance, and return well-typed rows from v_latest_ar_aging /
 * v_latest_ap_aging.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TestPool } from "./test-pool";
import { getLatestArAging } from "../src/lib/finance/get-ar-aging";
import { getLatestApAging } from "../src/lib/finance/get-ap-aging";

test("getLatestArAging: filters company_id, reads from v_latest_ar_aging", async () => {
  const pool = new TestPool({
    responders: [
      (t, params) => {
        if (!t.includes("FROM v_latest_ar_aging")) return null;
        assert.equal((params as unknown[])[0], "u1dynamics");
        assert.ok(t.includes("WHERE company_id = $1"));
        assert.ok(t.includes("ORDER BY total_open_balance DESC"));
        return {
          rows: [
            { customer_id: "C1", customer_name: "U1P ULTRACHEM",
              current_bucket: 100000, days_1_30: 50000,
              days_31_60: 25000, days_61_90: 10000, days_91_plus: 5000,
              total_open_balance: 190000,
              snapshot_at: "2026-05-30T08:00:00Z" },
            { customer_id: "C2", customer_name: "AMAZON CUSTOMER",
              current_bucket: 60000, days_1_30: 20000,
              days_31_60: 0, days_61_90: 0, days_91_plus: 0,
              total_open_balance: 80000,
              snapshot_at: "2026-05-30T08:00:00Z" },
          ],
        };
      },
    ],
  });
  const rows = await getLatestArAging(pool as unknown as import("pg").Pool);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].customer_name, "U1P ULTRACHEM");
  assert.equal(rows[0].total_open_balance, 190000);
});

test("getLatestApAging: filters company_id, reads from v_latest_ap_aging", async () => {
  const pool = new TestPool({
    responders: [
      (t, params) => {
        if (!t.includes("FROM v_latest_ap_aging")) return null;
        assert.equal((params as unknown[])[0], "u1dynamics");
        assert.ok(t.includes("WHERE company_id = $1"));
        return {
          rows: [
            { vendor_name: "BASE OIL SUPPLIER LLC",
              current_bucket: 200000, days_1_30: 300000,
              days_31_60: 250000, days_61_90: 100000, days_91_plus: 50000,
              total_open_balance: 900000,
              snapshot_at: "2026-05-30T08:00:00Z" },
          ],
        };
      },
    ],
  });
  const rows = await getLatestApAging(pool as unknown as import("pg").Pool);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].vendor_name, "BASE OIL SUPPLIER LLC");
  assert.equal(rows[0].total_open_balance, 900000);
});

test("getLatestArAging: SQL error returns empty array (safeQuery contract)", async () => {
  const pool = {
    async query() { throw new Error("permission denied for view v_latest_ar_aging"); },
  } as unknown as import("pg").Pool;
  const rows = await getLatestArAging(pool);
  assert.deepEqual(rows, []);
});
