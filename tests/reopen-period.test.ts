/**
 * tests/reopen-period.test.ts
 *
 * PR 003F — reopenPeriod helper.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TestPool } from "./test-pool";
import { reopenPeriod } from "../src/lib/review/reopen-period";

function happyResponders(opts: {
  hasBoardPeriod?: boolean;
  status?: string;
  reopenedAtIso?: string;
  hasActiveFile?: boolean;
  activeFileId?: number;
  previousLockedAtIso?: string;
  previousLockedBy?: string;
  auditEventId?: number;
} = {}) {
  const hasRow = opts.hasBoardPeriod ?? true;
  return [
    (t: string) => (/^BEGIN/.test(t.trim()) ? { rows: [] } : null),
    (t: string) =>
      t.includes("FROM u1d_ops.board_periods\n        WHERE period_year")
        ? {
            rows: hasRow
              ? [{
                  status: opts.status ?? "locked",
                  locked_at: opts.previousLockedAtIso ?? new Date("2026-05-30T00:00:00Z"),
                  locked_by: opts.previousLockedBy ?? "admin@previous",
                }]
              : [],
            rowCount: hasRow ? 1 : 0,
          }
        : null,
    // New active-file SELECT added in PR 003G to capture file_id for audit metadata.
    (t: string) =>
      t.includes("FROM u1d_ops.volume_files\n        WHERE period_year")
        ? {
            rows: opts.hasActiveFile === false ? [] : [{ file_id: opts.activeFileId ?? 7777 }],
            rowCount: opts.hasActiveFile === false ? 0 : 1,
          }
        : null,
    (t: string) =>
      t.includes("UPDATE u1d_ops.board_periods")
        ? {
            rows: [{ reopened_at: opts.reopenedAtIso ?? "2026-06-01T00:00:00.000Z" }],
            rowCount: 1,
          }
        : null,
    // PR 003G — audit insert. Default: succeeds.
    (t: string) =>
      t.includes("INSERT INTO u1d_ops.period_lock_events")
        ? {
            rows: [{
              event_id: opts.auditEventId ?? 9002,
              period_year: 2026,
              period_month: 5,
              file_id: opts.activeFileId ?? 7777,
              event_type: "reopened",
              event_at: new Date("2026-06-01T00:00:00Z"),
              event_by: "admin@x",
              prior_status: "locked",
              new_status: "reopened",
              reason: null,
              metadata: {},
            }],
          }
        : null,
    (t: string) => (/^COMMIT/.test(t.trim()) ? { rows: [] } : null),
    (t: string) => (/^ROLLBACK/.test(t.trim()) ? { rows: [] } : null),
  ];
}

test("reopenPeriod: locked → reopened, returns reopenedAt", async () => {
  const pool = new TestPool({ responders: happyResponders() });
  const r = await reopenPeriod(pool as unknown as import("pg").Pool, 2026, 5, "admin@x");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.reopenedAt, "2026-06-01T00:00:00.000Z");
  assert.ok(pool.findQuery("UPDATE u1d_ops.board_periods"));
  assert.ok(pool.findQuery("COMMIT"));
});

test("reopenPeriod: status='in_review' → not_locked, no UPDATE", async () => {
  const pool = new TestPool({ responders: happyResponders({ status: "in_review" }) });
  const r = await reopenPeriod(pool as unknown as import("pg").Pool, 2026, 5, "admin@x");
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.reasons, ["not_locked"]);
  assert.equal(pool.findQuery("UPDATE u1d_ops.board_periods"), undefined);
  assert.ok(pool.findQuery("ROLLBACK"));
});

test("reopenPeriod: status='reopened' → not_locked (idempotent rejection)", async () => {
  const pool = new TestPool({ responders: happyResponders({ status: "reopened" }) });
  const r = await reopenPeriod(pool as unknown as import("pg").Pool, 2026, 5, "admin@x");
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.reasons, ["not_locked"]);
});

test("reopenPeriod: no board_periods row → no_board_period_row", async () => {
  const pool = new TestPool({ responders: happyResponders({ hasBoardPeriod: false }) });
  const r = await reopenPeriod(pool as unknown as import("pg").Pool, 2026, 5, "admin@x");
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.reasons, ["no_board_period_row"]);
});

test("reopenPeriod: invalid args fail fast (no DB call)", async () => {
  const pool = new TestPool({ responders: happyResponders() });
  for (const args of [
    [1999, 5, "x", "invalid_year"],
    [2026, 13, "x", "invalid_month"],
    [2026, 5, "", "reopened_by_required"],
  ] as const) {
    const r = await reopenPeriod(
      pool as unknown as import("pg").Pool,
      args[0] as number, args[1] as number, args[2] as string
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reasons[0], args[3]);
  }
  // No queries should have run for any of these.
  assert.equal(pool.queries.length, 0);
});


test("reopenPeriod: writes a 'reopened' audit event in same TX, BEFORE commit", async () => {
  const pool = new TestPool({
    responders: happyResponders({ activeFileId: 7777, previousLockedBy: "admin@first" }),
  });
  const r = await reopenPeriod(pool as unknown as import("pg").Pool, 2026, 5, "admin@second");
  assert.equal(r.ok, true);
  const ins = pool.findQuery("INSERT INTO u1d_ops.period_lock_events");
  assert.ok(ins, "audit insert must run on successful reopen");
  // params: [year, month, fileId, eventType, eventBy, prior, new, reason, metaJson]
  assert.equal(ins?.params?.[2], 7777, "fileId captured from active volume_files");
  assert.equal(ins?.params?.[3], "reopened");
  assert.equal(ins?.params?.[4], "admin@second");
  assert.equal(ins?.params?.[5], "locked");
  assert.equal(ins?.params?.[6], "reopened");
  const meta = JSON.parse((ins!.params![8]) as string);
  assert.equal(meta.previous_locked_by, "admin@first");

  const begin = pool.queries.findIndex((q) => /^BEGIN/.test(q.text.trim()));
  const audit = pool.queries.findIndex((q) => q.text.includes("INSERT INTO u1d_ops.period_lock_events"));
  const commit = pool.queries.findIndex((q) => /^COMMIT/.test(q.text.trim()));
  assert.ok(begin >= 0 && audit > begin && commit > audit, "audit sits between BEGIN and COMMIT");
});

test("reopenPeriod: audit insert failure → ROLLBACK, no COMMIT", async () => {
  const r = happyResponders();
  const auditIdx = r.findIndex((fn) => (fn as Function)("INSERT INTO u1d_ops.period_lock_events"));
  const failing = r.slice();
  failing[auditIdx] = (t: string) => {
    if (t.includes("INSERT INTO u1d_ops.period_lock_events")) {
      throw new Error("audit insert blew up");
    }
    return null;
  };
  const pool = new TestPool({ responders: failing });
  await assert.rejects(
    () => reopenPeriod(pool as unknown as import("pg").Pool, 2026, 5, "admin@x"),
    /audit insert blew up/
  );
  assert.ok(pool.findQuery("ROLLBACK"));
  assert.equal(pool.findQuery("COMMIT"), undefined);
});

test("reopenPeriod: non-locked status does NOT write audit event", async () => {
  const pool = new TestPool({ responders: happyResponders({ status: "in_review" }) });
  const r = await reopenPeriod(pool as unknown as import("pg").Pool, 2026, 5, "admin@x");
  assert.equal(r.ok, false);
  assert.equal(pool.findQuery("INSERT INTO u1d_ops.period_lock_events"), undefined);
});

test("reopenPeriod: missing board_period row does NOT write audit event", async () => {
  const pool = new TestPool({ responders: happyResponders({ hasBoardPeriod: false }) });
  const r = await reopenPeriod(pool as unknown as import("pg").Pool, 2026, 5, "admin@x");
  assert.equal(r.ok, false);
  assert.equal(pool.findQuery("INSERT INTO u1d_ops.period_lock_events"), undefined);
});
