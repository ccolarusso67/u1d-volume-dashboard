/**
 * tests/list-period-events.test.ts
 *
 * PR 003G — listPeriodEvents helper.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TestPool } from "./test-pool";
import { listPeriodEvents } from "../src/lib/review/list-period-events";

const ROW = (overrides: Record<string, unknown> = {}) => ({
  event_id: 1,
  period_year: 2026,
  period_month: 5,
  file_id: 5050,
  event_type: "locked",
  event_at: new Date("2026-05-30T00:00:00Z"),
  event_by: "admin@x",
  prior_status: "in_review",
  new_status: "locked",
  reason: null,
  metadata: { source: "lockPeriod" },
  filename: "U1DYNAMICS_VOLUME_2026_05.xlsx",
  version_no: 3,
  ...overrides,
});

test("listPeriodEvents: returns events with ISO + LEFT JOIN columns", async () => {
  const pool = new TestPool({
    responders: [
      (t) =>
        t.includes("FROM u1d_ops.period_lock_events e")
          ? {
              rows: [
                ROW({ event_id: 2, event_at: new Date("2026-06-01T00:00:00Z"), event_type: "reopened", prior_status: "locked", new_status: "reopened" }),
                ROW({ event_id: 1, event_at: new Date("2026-05-30T00:00:00Z") }),
              ],
            }
          : null,
    ],
  });
  const out = await listPeriodEvents(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(out.length, 2);
  // The query orders newest-first; the responder already returned them in
  // newest-first order so we assert their identities + ISO conversion.
  assert.equal(out[0].event_id, 2);
  assert.equal(out[0].event_type, "reopened");
  assert.equal(out[0].event_at, "2026-06-01T00:00:00.000Z");
  assert.equal(out[0].filename, "U1DYNAMICS_VOLUME_2026_05.xlsx");
  assert.equal(out[0].version_no, 3);
  assert.equal(out[1].event_type, "locked");
});

test("listPeriodEvents: tolerates file_id null (no LEFT JOIN match)", async () => {
  const pool = new TestPool({
    responders: [
      (t) =>
        t.includes("FROM u1d_ops.period_lock_events e")
          ? { rows: [ROW({ file_id: null, filename: null, version_no: null })] }
          : null,
    ],
  });
  const [ev] = await listPeriodEvents(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(ev.file_id, null);
  assert.equal(ev.filename, null);
  assert.equal(ev.version_no, null);
});

test("listPeriodEvents: no rows → empty array", async () => {
  const pool = new TestPool({
    responders: [(t) => (t.includes("FROM u1d_ops.period_lock_events e") ? { rows: [] } : null)],
  });
  const out = await listPeriodEvents(pool as unknown as import("pg").Pool, 2026, 5);
  assert.deepEqual(out, []);
});

test("listPeriodEvents: clamps limit at 100", async () => {
  const pool = new TestPool({
    responders: [(t) => (t.includes("FROM u1d_ops.period_lock_events e") ? { rows: [] } : null)],
  });
  await listPeriodEvents(pool as unknown as import("pg").Pool, 2026, 5, 9999);
  assert.equal(pool.queries[0].params?.[2], 100);
});

test("listPeriodEvents: rejects invalid year / month / limit", async () => {
  const pool = new TestPool({ responders: [() => ({ rows: [] })] });
  await assert.rejects(
    () => listPeriodEvents(pool as unknown as import("pg").Pool, 1999, 5),
    /invalid year/
  );
  await assert.rejects(
    () => listPeriodEvents(pool as unknown as import("pg").Pool, 2026, 13),
    /invalid month/
  );
  await assert.rejects(
    () => listPeriodEvents(pool as unknown as import("pg").Pool, 2026, 5, 0),
    /positive integer/
  );
  await assert.rejects(
    () => listPeriodEvents(pool as unknown as import("pg").Pool, 2026, 5, -1),
    /positive integer/
  );
});
