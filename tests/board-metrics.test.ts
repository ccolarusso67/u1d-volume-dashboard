/**
 * tests/board-metrics.test.ts
 *
 * PR 004A — pure board metric utilities.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monthLabel,
  priorMonth,
  safePct,
  calculateShare,
  monthOverMonth,
} from "../src/lib/board/metrics";

test("monthLabel: standard months", () => {
  assert.equal(monthLabel(2026, 5), "May 2026");
  assert.equal(monthLabel(2025, 12), "December 2025");
  assert.equal(monthLabel(2024, 1), "January 2024");
});

test("priorMonth: simple decrement", () => {
  assert.deepEqual(priorMonth(2026, 5), { year: 2026, month: 4 });
  assert.deepEqual(priorMonth(2026, 12), { year: 2026, month: 11 });
});

test("priorMonth: January rolls to previous December", () => {
  assert.deepEqual(priorMonth(2026, 1), { year: 2025, month: 12 });
  assert.deepEqual(priorMonth(2024, 1), { year: 2023, month: 12 });
});

test("priorMonth: invalid inputs throw", () => {
  assert.throws(() => priorMonth(2026, 13), /invalid month/);
  assert.throws(() => priorMonth(2026, 0), /invalid month/);
  assert.throws(() => priorMonth(1900, 5), /invalid year/);
  // @ts-expect-error — deliberate type abuse
  assert.throws(() => priorMonth("2026", 5));
});

test("safePct: basic ratios", () => {
  assert.equal(safePct(50, 200), 0.25);
  assert.equal(safePct(-50, 200), -0.25);
  assert.equal(safePct(0, 200), 0);
});

test("safePct: nulls + zero denominator → null", () => {
  assert.equal(safePct(null, 200), null);
  assert.equal(safePct(50, null), null);
  assert.equal(safePct(50, 0), null);
  assert.equal(safePct(undefined, undefined), null);
});

test("safePct: non-finite inputs → null", () => {
  assert.equal(safePct(Number.POSITIVE_INFINITY, 100), null);
  assert.equal(safePct(50, Number.NaN), null);
});

test("calculateShare: clamps to [0,1]", () => {
  assert.equal(calculateShare(50, 200), 0.25);
  assert.equal(calculateShare(-10, 200), 0, "negative numerator clamps to 0");
  assert.equal(calculateShare(300, 200), 1, "above 1 clamps to 1");
});

test("calculateShare: zero or null whole → null", () => {
  assert.equal(calculateShare(50, 0), null);
  assert.equal(calculateShare(50, null), null);
});

test("monthOverMonth: typical positive delta", () => {
  const r = monthOverMonth(120, 100);
  assert.equal(r.delta_gallons, 20);
  assert.equal(r.delta_pct, 0.2);
});

test("monthOverMonth: typical negative delta", () => {
  const r = monthOverMonth(80, 100);
  assert.equal(r.delta_gallons, -20);
  assert.equal(r.delta_pct, -0.2);
});

test("monthOverMonth: prior null → delta_pct null, delta_gallons = current", () => {
  const r = monthOverMonth(120, null);
  assert.equal(r.delta_gallons, 120);
  assert.equal(r.delta_pct, null);
});

test("monthOverMonth: both null → both null", () => {
  const r = monthOverMonth(null, null);
  assert.equal(r.delta_gallons, null);
  assert.equal(r.delta_pct, null);
});

test("monthOverMonth: prior zero → delta_pct null", () => {
  const r = monthOverMonth(100, 0);
  assert.equal(r.delta_gallons, 100);
  assert.equal(r.delta_pct, null);
});

test("monthOverMonth: current null, prior non-null → delta = -prior", () => {
  const r = monthOverMonth(null, 100);
  assert.equal(r.delta_gallons, -100);
  assert.equal(r.delta_pct, -1);
});
