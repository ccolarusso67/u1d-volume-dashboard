/**
 * tests/list-upload-history.test.ts
 *
 * PR 003C — list-upload-history helper.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TestPool } from "./test-pool";
import { listUploadHistory, MAX_HISTORY_LIMIT } from "../src/lib/upload/list-upload-history";

const FIXTURE_ROWS = [
  {
    file_id: 7,
    filename: "U1DYNAMICS_VOLUME_2026_05.xlsx",
    file_hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    period_year: 2026, period_month: 5,
    version_no: 3, is_active: true, is_superseded: false,
    has_total_discrepancy: false,
    uploaded_at: new Date("2026-05-26T15:30:00Z"),
    uploaded_by: "carmine.colarusso@ultra1plus.com",
    staged_at: new Date("2026-05-26T15:30:01Z"),
    reviewed_at: null,
    locked_at: null,
    status: "in_review",
  },
  {
    file_id: 6,
    filename: "U1DYNAMICS_VOLUME_2026_04.xlsx",
    file_hash: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
    period_year: 2026, period_month: 4,
    version_no: 2, is_active: false, is_superseded: true,
    has_total_discrepancy: true,
    uploaded_at: new Date("2026-04-12T10:00:00Z"),
    uploaded_by: "eugenio.piratelli@ultra1plus.com",
    staged_at: new Date("2026-04-12T10:00:01Z"),
    reviewed_at: new Date("2026-04-14T09:00:00Z"),
    locked_at: new Date("2026-04-15T09:00:00Z"),
    status: "locked",
  },
];

test("listUploadHistory returns mapped rows with hash prefix + ISO dates", async () => {
  const pool = new TestPool({
    responders: [
      (t) => t.includes("FROM u1d_ops.volume_files") ? { rows: FIXTURE_ROWS } : null,
    ],
  });
  const rows = await listUploadHistory(pool as unknown as import("pg").Pool, 20);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].file_id, 7);
  assert.equal(rows[0].file_hash_prefix, "abcdef01", "first 8 hex chars exposed");
  assert.equal(rows[0].uploaded_at, "2026-05-26T15:30:00.000Z");
  assert.equal(rows[0].status, "in_review");
  assert.equal(rows[0].locked_at, null);

  assert.equal(rows[1].file_id, 6);
  assert.equal(rows[1].is_superseded, true);
  assert.equal(rows[1].has_total_discrepancy, true);
  assert.equal(rows[1].locked_at, "2026-04-15T09:00:00.000Z");
  assert.equal(rows[1].status, "locked");
});

test("listUploadHistory issues a single SELECT with the limit param", async () => {
  const pool = new TestPool({
    responders: [(t) => t.includes("FROM u1d_ops.volume_files") ? { rows: [] } : null],
  });
  await listUploadHistory(pool as unknown as import("pg").Pool, 15);
  assert.equal(pool.queries.length, 1);
  assert.equal(pool.queries[0].params?.[0], 15);
});

test("listUploadHistory clamps limit at MAX_HISTORY_LIMIT", async () => {
  const pool = new TestPool({
    responders: [(t) => t.includes("FROM u1d_ops.volume_files") ? { rows: [] } : null],
  });
  await listUploadHistory(pool as unknown as import("pg").Pool, 9999);
  assert.equal(pool.queries[0].params?.[0], MAX_HISTORY_LIMIT);
});

test("listUploadHistory rejects non-positive limit", async () => {
  const pool = new TestPool({ responders: [() => ({ rows: [] })] });
  await assert.rejects(
    () => listUploadHistory(pool as unknown as import("pg").Pool, 0),
    /positive integer/
  );
  await assert.rejects(
    () => listUploadHistory(pool as unknown as import("pg").Pool, -5),
    /positive integer/
  );
});

test("listUploadHistory tolerates string timestamps (some pg configs return strings)", async () => {
  const pool = new TestPool({
    responders: [
      (t) => t.includes("FROM u1d_ops.volume_files") ? {
        rows: [{
          ...FIXTURE_ROWS[0],
          uploaded_at: "2026-05-26T15:30:00Z",
          staged_at: "2026-05-26T15:30:01Z",
        }],
      } : null,
    ],
  });
  const rows = await listUploadHistory(pool as unknown as import("pg").Pool, 1);
  assert.equal(rows[0].uploaded_at, "2026-05-26T15:30:00Z");
  assert.equal(rows[0].staged_at, "2026-05-26T15:30:01Z");
});

test("listUploadHistory tolerates null board_periods join (period never staged)", async () => {
  const pool = new TestPool({
    responders: [
      (t) => t.includes("FROM u1d_ops.volume_files") ? {
        rows: [{
          ...FIXTURE_ROWS[0],
          status: null,
        }],
      } : null,
    ],
  });
  const rows = await listUploadHistory(pool as unknown as import("pg").Pool, 1);
  assert.equal(rows[0].status, null);
});
