/**
 * tests/finance-working-capital.test.ts — PR 012A
 *
 * Pure helper, no DB. Four scenarios:
 *   1. Healthy (AR > AP, net positive)
 *   2. Tight (AR ~ AP)
 *   3. Underwater (AP >> AR, like U1D today)
 *   4. Empty (no rows at all → zeros, null concentrations, null snapshot)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeWorkingCapital } from "../src/lib/finance/working-capital";
import type { ArAgingRow, ApAgingRow } from "../src/lib/finance/types";

const ar = (i: number, name: string, bal: number, snap = "2026-05-30T00:00:00Z"): ArAgingRow => ({
  customer_id: `C${i}`, customer_name: name,
  current_bucket: bal * 0.6, days_1_30: bal * 0.25,
  days_31_60: bal * 0.1, days_61_90: bal * 0.04, days_91_plus: bal * 0.01,
  total_open_balance: bal, snapshot_at: snap,
});
const ap = (name: string, bal: number, snap = "2026-05-30T00:00:00Z"): ApAgingRow => ({
  vendor_name: name,
  current_bucket: bal * 0.3, days_1_30: bal * 0.3,
  days_31_60: bal * 0.2, days_61_90: bal * 0.15, days_91_plus: bal * 0.05,
  total_open_balance: bal, snapshot_at: snap,
});

test("computeWorkingCapital: healthy — AR > AP, positive net", () => {
  const wc = computeWorkingCapital(
    [ar(1, "BIG CUSTOMER", 500000), ar(2, "SMALL CUSTOMER", 100000)],
    [ap("VENDOR A", 200000), ap("VENDOR B", 150000)]
  );
  assert.equal(wc.total_ar, 600000);
  assert.equal(wc.total_ap, 350000);
  assert.equal(wc.net_position, 250000);
  assert.ok(wc.ap_to_ar_ratio);
  assert.ok(Math.abs(wc.ap_to_ar_ratio! - 350000 / 600000) < 1e-9);
  assert.equal(wc.ar_top_concentration?.name, "BIG CUSTOMER");
  assert.ok(Math.abs((wc.ar_top_concentration?.share_pct ?? 0) - 500000 / 600000) < 1e-9);
});

test("computeWorkingCapital: tight — AR ~ AP, net near zero", () => {
  const wc = computeWorkingCapital([ar(1, "X", 100000)], [ap("Y", 99000)]);
  assert.equal(wc.net_position, 1000);
  assert.ok(wc.ap_to_ar_ratio && wc.ap_to_ar_ratio < 1);
});

test("computeWorkingCapital: underwater — like U1D today (AP 3.3x AR)", () => {
  const wc = computeWorkingCapital(
    [ar(1, "TOP", 200000), ar(2, "OTHER", 80000)],
    [ap("BIG VENDOR", 600000), ap("OTHER", 333000)]
  );
  assert.equal(wc.total_ar, 280000);
  assert.equal(wc.total_ap, 933000);
  assert.equal(wc.net_position, -653000);
  assert.ok(wc.ap_to_ar_ratio && wc.ap_to_ar_ratio > 3);
  assert.equal(wc.ap_top_concentration?.name, "BIG VENDOR");
});

test("computeWorkingCapital: empty arrays return zeros + null concentrations + null snapshot", () => {
  const wc = computeWorkingCapital([], []);
  assert.equal(wc.total_ar, 0);
  assert.equal(wc.total_ap, 0);
  assert.equal(wc.net_position, 0);
  assert.equal(wc.ap_to_ar_ratio, null);
  assert.equal(wc.ar_top_concentration, null);
  assert.equal(wc.ap_top_concentration, null);
  assert.equal(wc.snapshot_at, null);
  assert.equal(wc.ar_aging.days_1_30, 0);
});

test("computeWorkingCapital: snapshot_at is the max across AR + AP rows", () => {
  const wc = computeWorkingCapital(
    [ar(1, "X", 100, "2026-05-30T08:00:00Z")],
    [ap("Y", 50, "2026-05-30T12:30:00Z")]
  );
  assert.equal(wc.snapshot_at, "2026-05-30T12:30:00Z");
});
