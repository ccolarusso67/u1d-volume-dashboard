/**
 * tests/finance-sync-health.test.ts — PR 012A
 *
 * Tests the read helper + the pure assessSyncHealth helper.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TestPool } from "./test-pool";
import { getSyncHealth, assessSyncHealth } from "../src/lib/finance/get-sync-health";
import type { SyncHealthRow } from "../src/lib/finance/types";

test("getSyncHealth: filters company_id, reads from sync_status", async () => {
  const pool = new TestPool({
    responders: [
      (t, params) => {
        if (!t.includes("FROM sync_status")) return null;
        assert.equal((params as unknown[])[0], "u1dynamics");
        return {
          rows: [
            { job_name: "pnl_sync", status: "success",
              last_run_at: "2026-06-01T08:00:00Z",
              last_success_at: "2026-06-01T08:00:00Z",
              records_synced: 36, error_message: null },
          ],
        };
      },
    ],
  });
  const rows = await getSyncHealth(pool as unknown as import("pg").Pool);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].job_name, "pnl_sync");
});

const ok = (job: string, when: string): SyncHealthRow => ({
  job_name: job, status: "success", last_run_at: when,
  last_success_at: when, records_synced: 1, error_message: null,
});
const err = (job: string): SyncHealthRow => ({
  job_name: job, status: "error", last_run_at: "2026-06-01T08:00:00Z",
  last_success_at: null, records_synced: 0, error_message: "QB session lost",
});

test("assessSyncHealth: all fresh → ok", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const a = assessSyncHealth(
    [ok("a", "2026-06-01T08:00:00Z"), ok("b", "2026-06-01T09:00:00Z")],
    { now }
  );
  assert.equal(a.total_jobs, 2);
  assert.equal(a.jobs_success, 2);
  assert.equal(a.jobs_error, 0);
  assert.equal(a.jobs_stale, 0);
  assert.equal(a.worst_status, "ok");
  assert.equal(a.newest_success_at, "2026-06-01T09:00:00.000Z");
  assert.equal(a.oldest_success_at, "2026-06-01T08:00:00.000Z");
});

test("assessSyncHealth: one stale (>24h old success) → stale", () => {
  const now = new Date("2026-06-02T12:00:00Z");
  const a = assessSyncHealth(
    [ok("a", "2026-06-02T08:00:00Z"), ok("b", "2026-05-30T09:00:00Z")],
    { now, stale_threshold_hours: 24 }
  );
  assert.equal(a.jobs_stale, 1);
  assert.equal(a.worst_status, "stale");
});

test("assessSyncHealth: any error → error (overrides stale)", () => {
  const now = new Date("2026-06-02T12:00:00Z");
  const a = assessSyncHealth(
    [ok("a", "2026-06-02T08:00:00Z"), err("b")],
    { now }
  );
  assert.equal(a.jobs_error, 1);
  assert.equal(a.worst_status, "error");
});

test("assessSyncHealth: empty array → ok with zero counts", () => {
  const a = assessSyncHealth([], { now: new Date("2026-06-01T00:00:00Z") });
  assert.equal(a.total_jobs, 0);
  assert.equal(a.worst_status, "ok");
  assert.equal(a.newest_success_at, null);
});
