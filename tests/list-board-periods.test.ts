/**
 * tests/list-board-periods.test.ts
 *
 * PR 004A — board index helper.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TestPool } from "./test-pool";
import { listBoardPeriods } from "../src/lib/board/list-board-periods";

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    period_year: 2026,
    period_month: 5,
    status: "locked",
    locked_at: new Date("2026-05-30T00:00:00Z"),
    locked_by: "admin@x",
    total_gallons: 175319,
    operator_notes_complete: true,
    ...overrides,
  };
}

function makePool(rows: ReturnType<typeof row>[]) {
  return new TestPool({
    responders: [
      (t) => (t.includes("FROM u1d_ops.board_periods bp") ? { rows } : null),
    ],
  });
}

test("listBoardPeriods: empty result", async () => {
  const out = await listBoardPeriods(makePool([]) as unknown as import("pg").Pool);
  assert.deepEqual(out, []);
});

test("listBoardPeriods: locked-only filter is in the SQL", async () => {
  const pool = makePool([]);
  await listBoardPeriods(pool as unknown as import("pg").Pool);
  const q = pool.findQuery("FROM u1d_ops.board_periods bp");
  assert.ok(q?.text.includes("WHERE bp.status = 'locked'"), "SQL must filter to locked status");
});

test("listBoardPeriods: returns rows in order received (newest-first per SQL)", async () => {
  const pool = makePool([
    row({ period_year: 2026, period_month: 5 }),
    row({ period_year: 2026, period_month: 4 }),
  ]);
  const out = await listBoardPeriods(pool as unknown as import("pg").Pool);
  assert.equal(out[0].period.label, "May 2026");
  assert.equal(out[1].period.label, "April 2026");
});

test("listBoardPeriods: includes total_gallons + locked metadata", async () => {
  const pool = makePool([row()]);
  const [r] = await listBoardPeriods(pool as unknown as import("pg").Pool);
  assert.equal(r.total_gallons, 175319);
  assert.equal(r.locked_by, "admin@x");
  assert.equal(r.locked_at, "2026-05-30T00:00:00.000Z");
  assert.equal(r.operator_notes_complete, true);
  assert.equal(r.href, "/board/2026/5");
});

test("listBoardPeriods: MoM% computed when prior locked period is in result set", async () => {
  const pool = makePool([
    row({ period_year: 2026, period_month: 5, total_gallons: 120 }),
    row({ period_year: 2026, period_month: 4, total_gallons: 100 }),
  ]);
  const [may, apr] = await listBoardPeriods(pool as unknown as import("pg").Pool);
  assert.equal(may.prior_month_total_gallons, 100);
  assert.equal(may.month_over_month_delta_pct, 0.2);
  // April has no prior in the result → null
  assert.equal(apr.prior_month_total_gallons, null);
  assert.equal(apr.month_over_month_delta_pct, null);
});

test("listBoardPeriods: prior month absent (not in result set) → MoM null", async () => {
  // Only May 2026 — no April.
  const pool = makePool([row({ period_year: 2026, period_month: 5, total_gallons: 120 })]);
  const [r] = await listBoardPeriods(pool as unknown as import("pg").Pool);
  assert.equal(r.prior_month_total_gallons, null);
  assert.equal(r.month_over_month_delta_pct, null);
});

test("listBoardPeriods: limit clamps at MAX_LIMIT (60)", async () => {
  const pool = makePool([]);
  await listBoardPeriods(pool as unknown as import("pg").Pool, { limit: 9999 });
  assert.equal(pool.queries[0].params?.[0], 60);
});

test("listBoardPeriods: default limit 24", async () => {
  const pool = makePool([]);
  await listBoardPeriods(pool as unknown as import("pg").Pool);
  assert.equal(pool.queries[0].params?.[0], 24);
});

test("listBoardPeriods: rejects non-positive limit", async () => {
  const pool = makePool([]);
  await assert.rejects(
    () => listBoardPeriods(pool as unknown as import("pg").Pool, { limit: 0 }),
    /positive integer/
  );
  await assert.rejects(
    () => listBoardPeriods(pool as unknown as import("pg").Pool, { limit: -1 }),
    /positive integer/
  );
});

test("listBoardPeriods: January period correctly looks up prior December (year-1)", async () => {
  const pool = makePool([
    row({ period_year: 2026, period_month: 1, total_gallons: 120 }),
    row({ period_year: 2025, period_month: 12, total_gallons: 100 }),
  ]);
  const [jan] = await listBoardPeriods(pool as unknown as import("pg").Pool);
  assert.equal(jan.prior_month_total_gallons, 100);
  assert.equal(jan.month_over_month_delta_pct, 0.2);
});
