/**
 * tests/record-period-event.test.ts
 *
 * PR 003G — recordPeriodEvent helper.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TestPool } from "./test-pool";
import { recordPeriodEvent } from "../src/lib/review/record-period-event";
import { PeriodEventValidationError } from "../src/lib/review/period-events-types";

function makeClient(
  responseRow: Record<string, unknown> = {
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
  }
) {
  return new TestPool({
    responders: [
      (t) =>
        t.includes("INSERT INTO u1d_ops.period_lock_events")
          ? { rows: [responseRow] }
          : null,
    ],
  });
}

test("recordPeriodEvent: inserts a locked event and returns it with ISO timestamp", async () => {
  const pool = makeClient();
  const ev = await recordPeriodEvent(pool as unknown as import("pg").PoolClient, {
    periodYear: 2026,
    periodMonth: 5,
    fileId: 5050,
    eventType: "locked",
    eventBy: "admin@x",
    priorStatus: "in_review",
    newStatus: "locked",
    metadata: { source: "lockPeriod", active_file_id: 5050 },
  });
  assert.equal(ev.event_id, 1);
  assert.equal(ev.event_type, "locked");
  assert.equal(ev.event_at, "2026-05-30T00:00:00.000Z");
  assert.equal(ev.metadata.source, "lockPeriod");

  const ins = pool.findQuery("INSERT INTO u1d_ops.period_lock_events");
  assert.ok(ins);
  // params order: year, month, fileId, eventType, eventBy, prior, new, reason, metadataJson
  assert.equal(ins?.params?.[0], 2026);
  assert.equal(ins?.params?.[1], 5);
  assert.equal(ins?.params?.[2], 5050);
  assert.equal(ins?.params?.[3], "locked");
  assert.equal(ins?.params?.[4], "admin@x");
  assert.equal(ins?.params?.[5], "in_review");
  assert.equal(ins?.params?.[6], "locked");
  assert.equal(ins?.params?.[7], null);
  // metadata is serialized to JSON string for the ::jsonb cast
  const m = ins?.params?.[8] as string;
  assert.equal(typeof m, "string");
  assert.deepEqual(JSON.parse(m), { source: "lockPeriod", active_file_id: 5050 });
});

test("recordPeriodEvent: inserts a reopened event", async () => {
  const pool = makeClient({
    event_id: 2,
    period_year: 2026,
    period_month: 5,
    file_id: null,
    event_type: "reopened",
    event_at: new Date("2026-06-01T00:00:00Z"),
    event_by: "admin2@x",
    prior_status: "locked",
    new_status: "reopened",
    reason: null,
    metadata: {},
  });
  const ev = await recordPeriodEvent(pool as unknown as import("pg").PoolClient, {
    periodYear: 2026,
    periodMonth: 5,
    fileId: null,
    eventType: "reopened",
    eventBy: "admin2@x",
    priorStatus: "locked",
    newStatus: "reopened",
  });
  assert.equal(ev.event_type, "reopened");
  assert.equal(ev.file_id, null);
});

test("recordPeriodEvent: missing metadata defaults to empty object", async () => {
  const pool = makeClient();
  await recordPeriodEvent(pool as unknown as import("pg").PoolClient, {
    periodYear: 2026,
    periodMonth: 5,
    fileId: 5050,
    eventType: "locked",
    eventBy: "admin@x",
    priorStatus: null,
    newStatus: "locked",
  });
  const ins = pool.findQuery("INSERT INTO u1d_ops.period_lock_events");
  assert.equal(ins?.params?.[8], "{}", "metadata defaults to JSON '{}'");
});

test("recordPeriodEvent: rejects invalid year", async () => {
  const pool = makeClient();
  await assert.rejects(
    () =>
      recordPeriodEvent(pool as unknown as import("pg").PoolClient, {
        periodYear: 1999, periodMonth: 5, fileId: 1,
        eventType: "locked", eventBy: "x",
        priorStatus: null, newStatus: "locked",
      }),
    (err: unknown) => {
      assert.ok(err instanceof PeriodEventValidationError);
      assert.ok((err as PeriodEventValidationError).reasons.includes("invalid_period_year"));
      return true;
    }
  );
  assert.equal(pool.queries.length, 0, "no DB call on validation failure");
});

test("recordPeriodEvent: rejects invalid month", async () => {
  const pool = makeClient();
  await assert.rejects(
    () =>
      recordPeriodEvent(pool as unknown as import("pg").PoolClient, {
        periodYear: 2026, periodMonth: 13, fileId: 1,
        eventType: "locked", eventBy: "x",
        priorStatus: null, newStatus: "locked",
      }),
    PeriodEventValidationError
  );
});

test("recordPeriodEvent: rejects empty event_by", async () => {
  const pool = makeClient();
  await assert.rejects(
    () =>
      recordPeriodEvent(pool as unknown as import("pg").PoolClient, {
        periodYear: 2026, periodMonth: 5, fileId: 1,
        eventType: "locked", eventBy: "  ",
        priorStatus: null, newStatus: "locked",
      }),
    (err: unknown) => {
      assert.ok(err instanceof PeriodEventValidationError);
      assert.ok((err as PeriodEventValidationError).reasons.includes("event_by_required"));
      return true;
    }
  );
});

test("recordPeriodEvent: rejects unsupported event_type", async () => {
  const pool = makeClient();
  await assert.rejects(
    () =>
      recordPeriodEvent(pool as unknown as import("pg").PoolClient, {
        periodYear: 2026, periodMonth: 5, fileId: 1,
        // @ts-expect-error — deliberately wrong literal
        eventType: "frobbed",
        eventBy: "x", priorStatus: null, newStatus: "locked",
      }),
    PeriodEventValidationError
  );
});

test("recordPeriodEvent: rejects empty new_status", async () => {
  const pool = makeClient();
  await assert.rejects(
    () =>
      recordPeriodEvent(pool as unknown as import("pg").PoolClient, {
        periodYear: 2026, periodMonth: 5, fileId: 1,
        eventType: "locked", eventBy: "x",
        priorStatus: null, newStatus: "  ",
      }),
    PeriodEventValidationError
  );
});

test("recordPeriodEvent: refuses non-serializable metadata", async () => {
  const pool = makeClient();
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  await assert.rejects(
    () =>
      recordPeriodEvent(pool as unknown as import("pg").PoolClient, {
        periodYear: 2026, periodMonth: 5, fileId: 1,
        eventType: "locked", eventBy: "x",
        priorStatus: null, newStatus: "locked",
        metadata: circular,
      }),
    (err: unknown) => {
      assert.ok(err instanceof PeriodEventValidationError);
      assert.ok(
        (err as PeriodEventValidationError).reasons.some((r) =>
          r.startsWith("metadata_not_serializable")
        )
      );
      return true;
    }
  );
});
