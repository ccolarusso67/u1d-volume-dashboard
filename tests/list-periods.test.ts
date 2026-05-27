/**
 * tests/list-periods.test.ts
 *
 * PR 003F — listPeriods aggregator.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TestPool } from "./test-pool";
import { listPeriods } from "../src/lib/periods/list-periods";

function rowFixture(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    period_year: 2026,
    period_month: 5,
    status: "in_review",
    file_id: 1001,
    filename: "U1DYNAMICS_VOLUME_2026_05.xlsx",
    version_no: 3,
    uploaded_at: new Date("2026-05-26T15:30:00Z"),
    uploaded_by: "carmine@x",
    file_hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    pending_package: 0,
    pending_customer: 0,
    pending_data_quality: 0,
    notes_exists: true,
    notes_complete: true,
    notes_completed_at: new Date("2026-05-30T00:00:00Z"),
    notes_completed_by: "eugenio@x",
    ...overrides,
  };
}

function makePool(rows: ReturnType<typeof rowFixture>[]) {
  return new TestPool({
    responders: [
      (t) => (t.includes("FROM u1d_ops.board_periods bp") ? { rows } : null),
    ],
  });
}

test("listPeriods: empty result", async () => {
  const pool = makePool([]);
  const r = await listPeriods(pool as unknown as import("pg").Pool);
  assert.equal(r.length, 0);
});

test("listPeriods: ready period → nextAction 'Lock ready', tone primary", async () => {
  const pool = makePool([rowFixture()]);
  const [row] = await listPeriods(pool as unknown as import("pg").Pool);
  assert.equal(row.period.label, "May 2026");
  assert.equal(row.activeFile?.version_no, 3);
  assert.equal(row.activeFile?.file_hash_prefix, "abcdef01");
  assert.equal(row.readiness.ready, true);
  assert.deepEqual(row.readiness.blockers, []);
  assert.equal(row.nextAction.label, "Lock ready");
  assert.equal(row.nextAction.href, "/admin/review/2026/5");
  assert.equal(row.nextAction.tone, "primary");
});

test("listPeriods: locked period → 'View locked report', tone success", async () => {
  const pool = makePool([rowFixture({ status: "locked" })]);
  const [row] = await listPeriods(pool as unknown as import("pg").Pool);
  assert.equal(row.nextAction.label, "View locked report");
  assert.equal(row.nextAction.tone, "success");
  assert.equal(row.readiness.ready, false, "locked period is not 'ready' to lock again");
  assert.ok(row.readiness.blockers.includes("already_locked"));
});

test("listPeriods: no active file → 'Upload', tone primary, href /admin/upload", async () => {
  const pool = makePool([
    rowFixture({
      file_id: null, filename: null, version_no: null,
      uploaded_at: null, uploaded_by: null, file_hash: null,
      notes_exists: false, notes_complete: false,
      notes_completed_at: null, notes_completed_by: null,
    }),
  ]);
  const [row] = await listPeriods(pool as unknown as import("pg").Pool);
  assert.equal(row.activeFile, null);
  assert.equal(row.nextAction.label, "Upload");
  assert.equal(row.nextAction.href, "/admin/upload");
  assert.equal(row.nextAction.tone, "primary");
  assert.ok(row.readiness.blockers.includes("no_active_file"));
});

test("listPeriods: pending alerts → 'Resolve alerts', tone warning", async () => {
  const pool = makePool([
    rowFixture({
      pending_package: 1, pending_customer: 0, pending_data_quality: 0,
    }),
  ]);
  const [row] = await listPeriods(pool as unknown as import("pg").Pool);
  assert.equal(row.nextAction.label, "Resolve alerts");
  assert.equal(row.nextAction.tone, "warning");
  assert.ok(row.readiness.blockers.some((b) => b.startsWith("pending_package_alerts")));
});

test("listPeriods: no pending alerts but notes incomplete → 'Complete notes'", async () => {
  const pool = makePool([
    rowFixture({
      notes_exists: true, notes_complete: false,
      notes_completed_at: null, notes_completed_by: null,
    }),
  ]);
  const [row] = await listPeriods(pool as unknown as import("pg").Pool);
  assert.equal(row.nextAction.label, "Complete notes");
  assert.equal(row.nextAction.href, "/admin/operator-notes/2026/5");
  assert.equal(row.nextAction.tone, "primary");
});

test("listPeriods: reopened status with alerts cleared and notes complete → 'Lock ready'", async () => {
  const pool = makePool([rowFixture({ status: "reopened" })]);
  const [row] = await listPeriods(pool as unknown as import("pg").Pool);
  assert.equal(row.nextAction.label, "Lock ready");
  assert.equal(row.readiness.ready, true);
});

test("listPeriods: limit parameter is clamped + threaded", async () => {
  const pool = makePool([]);
  await listPeriods(pool as unknown as import("pg").Pool, { limit: 9999 });
  assert.equal(pool.queries[0].params?.[0], 240, "clamped to 240");

  const pool2 = makePool([]);
  await listPeriods(pool2 as unknown as import("pg").Pool, { limit: 24 });
  assert.equal(pool2.queries[0].params?.[0], 24);
});
