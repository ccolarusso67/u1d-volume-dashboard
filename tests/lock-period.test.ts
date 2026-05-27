/**
 * tests/lock-period.test.ts
 *
 * PR 003D — lockPeriod helper.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TestPool } from "./test-pool";
import { lockPeriod } from "../src/lib/review/lock-period";

function happyResponders(opts: {
  hasBoardPeriod?: boolean;
  status?: string;
  hasActiveFile?: boolean;
  activeFileId?: number;
  activeVersionNo?: number;
  pendingPackage?: number;
  pendingCustomer?: number;
  pendingDq?: number;
  lockedAtIso?: string;
  operatorNotesExists?: boolean;
  operatorNotesComplete?: boolean;
  auditEventId?: number;
} = {}) {
  const hasBoardPeriod = opts.hasBoardPeriod ?? true;
  const hasActiveFile = opts.hasActiveFile ?? true;
  return [
    (t: string) => (/^BEGIN/.test(t.trim()) ? { rows: [] } : null),
    (t: string) =>
      t.includes("FROM u1d_ops.board_periods\n        WHERE period_year")
        ? {
            rows: hasBoardPeriod ? [{ status: opts.status ?? "in_review" }] : [],
            rowCount: hasBoardPeriod ? 1 : 0,
          }
        : null,
    (t: string) =>
      t.includes("FROM u1d_ops.volume_files\n        WHERE period_year")
        ? {
            rows: hasActiveFile
              ? [{
                  file_id: opts.activeFileId ?? 5050,
                  version_no: opts.activeVersionNo ?? 1,
                }]
              : [],
            rowCount: hasActiveFile ? 1 : 0,
          }
        : null,
    (t: string) =>
      t.includes("pending_package") && t.includes("FROM u1d_ops.package_alerts")
        ? {
            rows: [{
              pending_package: opts.pendingPackage ?? 0,
              pending_customer: opts.pendingCustomer ?? 0,
              pending_data_quality: opts.pendingDq ?? 0,
              operator_notes_exists: opts.operatorNotesExists ?? true,
              operator_notes_complete: opts.operatorNotesComplete ?? true,
            }],
          }
        : null,
    (t: string) =>
      t.includes("UPDATE u1d_ops.board_periods")
        ? {
            rows: [{ locked_at: opts.lockedAtIso ?? "2026-05-30T00:00:00.000Z" }],
            rowCount: 1,
          }
        : null,
    (t: string) =>
      t.includes("UPDATE u1d_ops.volume_files")
        ? { rows: [], rowCount: 1 }
        : null,
    // PR 003G — audit insert. Default: succeeds.
    (t: string) =>
      t.includes("INSERT INTO u1d_ops.period_lock_events")
        ? {
            rows: [{
              event_id: opts.auditEventId ?? 9001,
              period_year: 2026,
              period_month: 5,
              file_id: opts.activeFileId ?? 5050,
              event_type: "locked",
              event_at: new Date("2026-05-30T00:00:00Z"),
              event_by: "admin@x",
              prior_status: null,
              new_status: "locked",
              reason: null,
              metadata: {},
            }],
          }
        : null,
    (t: string) => (/^COMMIT/.test(t.trim()) ? { rows: [] } : null),
    (t: string) => (/^ROLLBACK/.test(t.trim()) ? { rows: [] } : null),
  ];
}

test("lockPeriod happy path: COMMITs, returns lockedAt + activeFileId", async () => {
  const pool = new TestPool({ responders: happyResponders({ activeFileId: 9999 }) });
  const r = await lockPeriod(pool as unknown as import("pg").Pool, 2026, 5, "admin@x");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.activeFileId, 9999);
    assert.equal(r.lockedAt, "2026-05-30T00:00:00.000Z");
  }
  assert.ok(pool.findQuery("UPDATE u1d_ops.board_periods"));
  assert.ok(pool.findQuery("UPDATE u1d_ops.volume_files"));
  // Order check: board update before volume_files update, COMMIT last.
  const b = pool.queries.findIndex((q) => q.text.includes("UPDATE u1d_ops.board_periods"));
  const v = pool.queries.findIndex((q) => q.text.includes("UPDATE u1d_ops.volume_files"));
  const c = pool.queries.findIndex((q) => /^COMMIT/.test(q.text.trim()));
  assert.ok(b < v, "board_periods updated before volume_files");
  assert.ok(v < c, "all updates before COMMIT");
});

test("lockPeriod: no active file → ROLLBACK with reason no_active_file", async () => {
  const pool = new TestPool({ responders: happyResponders({ hasActiveFile: false }) });
  const r = await lockPeriod(pool as unknown as import("pg").Pool, 2026, 5, "admin@x");
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.reasons, ["no_active_file"]);
  assert.ok(pool.findQuery("ROLLBACK"));
  assert.equal(pool.findQuery("COMMIT"), undefined);
});

test("lockPeriod: no board_periods row → ROLLBACK with no_board_period_row", async () => {
  const pool = new TestPool({ responders: happyResponders({ hasBoardPeriod: false }) });
  const r = await lockPeriod(pool as unknown as import("pg").Pool, 2026, 5, "admin@x");
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.reasons, ["no_board_period_row"]);
});

test("lockPeriod: already locked → ROLLBACK with already_locked", async () => {
  const pool = new TestPool({ responders: happyResponders({ status: "locked" }) });
  const r = await lockPeriod(pool as unknown as import("pg").Pool, 2026, 5, "admin@x");
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.reasons, ["already_locked"]);
});

test("lockPeriod: pending package alerts → ROLLBACK with reason", async () => {
  const pool = new TestPool({ responders: happyResponders({ pendingPackage: 3 }) });
  const r = await lockPeriod(pool as unknown as import("pg").Pool, 2026, 5, "admin@x");
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.reasons.includes("pending_package_alerts:3"));
  }
});

test("lockPeriod: multiple pending alert types listed in one response", async () => {
  const pool = new TestPool({
    responders: happyResponders({ pendingPackage: 1, pendingCustomer: 2, pendingDq: 1 }),
  });
  const r = await lockPeriod(pool as unknown as import("pg").Pool, 2026, 5, "admin@x");
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.reasons.includes("pending_package_alerts:1"));
    assert.ok(r.reasons.includes("pending_customer_alerts:2"));
    assert.ok(r.reasons.includes("pending_data_quality_alerts:1"));
  }
});

test("lockPeriod: invalid year/month + empty lockedBy", async () => {
  const pool = new TestPool({ responders: happyResponders({}) });
  const a = await lockPeriod(pool as unknown as import("pg").Pool, 1999, 5, "x");
  assert.deepEqual(a, { ok: false, reasons: ["invalid_year"] });
  const b = await lockPeriod(pool as unknown as import("pg").Pool, 2026, 13, "x");
  assert.deepEqual(b, { ok: false, reasons: ["invalid_month"] });
  const c = await lockPeriod(pool as unknown as import("pg").Pool, 2026, 5, "");
  assert.deepEqual(c, { ok: false, reasons: ["locked_by_required"] });
});


test("lockPeriod: writes a 'locked' audit event in same TX, BEFORE commit", async () => {
  const pool = new TestPool({ responders: happyResponders({ activeFileId: 9999, activeVersionNo: 4 }) });
  const r = await lockPeriod(pool as unknown as import("pg").Pool, 2026, 5, "admin@x");
  assert.equal(r.ok, true);
  const ins = pool.findQuery("INSERT INTO u1d_ops.period_lock_events");
  assert.ok(ins, "audit insert must run on successful lock");
  // Audit params: [year, month, fileId, eventType, eventBy, prior, new, reason, metaJson]
  assert.equal(ins?.params?.[2], 9999);
  assert.equal(ins?.params?.[3], "locked");
  assert.equal(ins?.params?.[4], "admin@x");

  // Order: BEGIN < INSERT period_lock_events < COMMIT
  const begin = pool.queries.findIndex((q) => /^BEGIN/.test(q.text.trim()));
  const audit = pool.queries.findIndex((q) => q.text.includes("INSERT INTO u1d_ops.period_lock_events"));
  const commit = pool.queries.findIndex((q) => /^COMMIT/.test(q.text.trim()));
  assert.ok(begin >= 0 && audit > begin && commit > audit, "audit must sit between BEGIN and COMMIT");
});

test("lockPeriod: audit insert failure → ROLLBACK, no COMMIT", async () => {
  // Replace the period_lock_events responder with one that throws.
  const r = happyResponders();
  const auditIdx = r.findIndex((fn) => (fn as Function)("INSERT INTO u1d_ops.period_lock_events"));
  const failing = r.slice();
  failing[auditIdx] = (t: string) => {
    if (t.includes("INSERT INTO u1d_ops.period_lock_events")) {
      throw new Error("simulated audit insert failure");
    }
    return null;
  };
  const pool = new TestPool({ responders: failing });
  await assert.rejects(
    () => lockPeriod(pool as unknown as import("pg").Pool, 2026, 5, "admin@x"),
    /simulated audit insert failure/
  );
  assert.ok(pool.findQuery("ROLLBACK"), "must ROLLBACK when audit insert throws");
  assert.equal(pool.findQuery("COMMIT"), undefined, "must NOT commit");
});

test("lockPeriod: blocked lock does NOT write audit event", async () => {
  const pool = new TestPool({ responders: happyResponders({ pendingPackage: 2 }) });
  const r = await lockPeriod(pool as unknown as import("pg").Pool, 2026, 5, "admin@x");
  assert.equal(r.ok, false);
  assert.equal(pool.findQuery("INSERT INTO u1d_ops.period_lock_events"), undefined,
    "no audit event when lock is blocked");
});
