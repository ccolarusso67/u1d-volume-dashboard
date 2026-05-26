/**
 * tests/get-period-review.test.ts
 *
 * PR 003D — Period review aggregator.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TestPool } from "./test-pool";
import { getPeriodReview } from "../src/lib/review/get-period-review";

type PeriodFix = {
  status: string;
  locked_at: Date | string | null;
  locked_by: string | null;
  reviewed_at: Date | string | null;
  reviewed_by: string | null;
};
const PERIOD_ROW: PeriodFix = {
  status: "in_review",
  locked_at: null,
  locked_by: null,
  reviewed_at: null,
  reviewed_by: null,
};

const ACTIVE_FILE = {
  file_id: 1001,
  filename: "U1DYNAMICS_VOLUME_2026_05.xlsx",
  file_hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  version_no: 3,
  is_active: true,
  is_superseded: false,
  uploaded_at: new Date("2026-05-26T15:30:00Z"),
  uploaded_by: "carmine.colarusso@ultra1plus.com",
  staged_at: new Date("2026-05-26T15:30:01Z"),
  reviewed_at: null,
  locked_at: null,
  source_total_row: 175319,
  computed_customer_sum: 175319,
  has_total_discrepancy: false,
  discrepancy_amount: null,
};

const PRIOR_FILE = {
  ...ACTIVE_FILE,
  file_id: 1000,
  filename: "U1DYNAMICS_VOLUME_2026_05.xlsx",
  version_no: 2,
  is_active: false,
  is_superseded: true,
  has_total_discrepancy: true,
};

type AlertFix = Record<string, unknown>;
function makeResponders(opts: {
  period?: typeof PERIOD_ROW | null;
  active?: typeof ACTIVE_FILE | null;
  priors?: typeof PRIOR_FILE[];
  pendingPackage?: number;
  pendingCustomer?: number;
  pendingDq?: number;
  resolved?: number;
  total?: number;
  packageAlerts?: AlertFix[];
  customerAlerts?: AlertFix[];
  dqAlerts?: AlertFix[];
  facts?: AlertFix[];
  notes?: AlertFix[];
  events?: AlertFix[];
}) {
  const cnt = {
    pending_package: opts.pendingPackage ?? 0,
    pending_customer: opts.pendingCustomer ?? 0,
    pending_data_quality: opts.pendingDq ?? 0,
    resolved_total: opts.resolved ?? 0,
    total: opts.total ?? 0,
  };
  return [
    (t: string) =>
      t.includes("FROM u1d_ops.board_periods\n        WHERE period_year")
        ? { rows: opts.period === null ? [] : [opts.period ?? PERIOD_ROW] }
        : null,
    (t: string) =>
      t.includes("AND is_active = TRUE\n       LIMIT 1")
        ? { rows: opts.active === null ? [] : [opts.active ?? ACTIVE_FILE] }
        : null,
    (t: string) =>
      t.includes("AND is_active = FALSE\n       ORDER BY version_no DESC")
        ? { rows: opts.priors ?? [] }
        : null,
    (t: string) =>
      t.includes("pending_package")
        ? { rows: [cnt] }
        : null,
    (t: string) =>
      t.includes("FROM u1d_ops.package_alerts pa")
        ? { rows: opts.packageAlerts ?? [] }
        : null,
    (t: string) =>
      t.includes("FROM u1d_ops.customer_alerts ca")
        ? { rows: opts.customerAlerts ?? [] }
        : null,
    (t: string) =>
      t.includes("FROM u1d_ops.data_quality_alerts dqa")
        ? { rows: opts.dqAlerts ?? [] }
        : null,
    (t: string) =>
      t.includes("FROM u1d_ops.volume_files vf\n       JOIN u1d_ops.volume_fact")
        ? { rows: opts.facts ?? [] }
        : null,
    // Operator-notes lookup (added in PR 003E for the readiness contract).
    // Default: no row exists. Per-test override available via `notes` option.
    (t: string) =>
      t.includes("FROM u1d_ops.monthly_operator_notes")
        ? { rows: opts.notes ?? [] }
        : null,
    // Period lock events (added in PR 003G). Default: no events.
    (t: string) =>
      t.includes("FROM u1d_ops.period_lock_events")
        ? { rows: opts.events ?? [] }
        : null,
  ];
}

test("getPeriodReview: happy path with active file, no alerts → canLock = true", async () => {
  // Provide a complete operator-notes row so the new readiness gate
  // (PR 003E) does not block.
  const pool = new TestPool({
    responders: makeResponders({
      notes: [{
        capacity_md: "x",
        supply_chain_md: "x",
        quality_md: "x",
        initiatives_md: "x",
        risks_md: "x",
        completed_at: new Date("2026-05-30T00:00:00Z"),
        completed_by: "admin@x",
        updated_at: new Date(),
        updated_by: "admin@x",
      }],
    }),
  });
  const r = await getPeriodReview(pool as unknown as import("pg").Pool, 2026, 5);

  assert.equal(r.period.year, 2026);
  assert.equal(r.period.month, 5);
  assert.equal(r.period.status, "in_review");
  assert.equal(r.activeFile?.file_id, 1001);
  assert.equal(r.activeFile?.file_hash_prefix, "abcdef01");
  assert.equal(r.activeFile?.version_no, 3);
  assert.equal(r.activeFile?.total_gallons, 175319);
  assert.equal(r.canLock, true);
  assert.deepEqual(r.lockBlockedReasons, []);
});

test("getPeriodReview: pending package alert blocks lock", async () => {
  const pool = new TestPool({
    responders: makeResponders({
      pendingPackage: 2,
      packageAlerts: [
        {
          alert_id: 11, file_id: 1001, raw_label: "FLEXIBAG",
          gallons_observed: 6340, status: "pending",
          mapped_to_package_key: null, resolved_by: null, resolved_at: null,
          notes: "detected_in=SUMMARY", created_at: new Date("2026-05-26T15:30:00Z"),
        },
      ],
      total: 2,
    }),
  });
  const r = await getPeriodReview(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(r.canLock, false);
  assert.ok(r.lockBlockedReasons.some((x) => x.startsWith("pending_package_alerts:2")));
  assert.equal(r.packageAlerts.length, 1);
  assert.equal(r.packageAlerts[0].raw_label, "FLEXIBAG");
  assert.equal(r.packageAlerts[0].gallons_observed, 6340);
});

test("getPeriodReview: no active file → canLock = false + no_active_file reason", async () => {
  const pool = new TestPool({ responders: makeResponders({ active: null }) });
  const r = await getPeriodReview(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(r.activeFile, null);
  assert.equal(r.canLock, false);
  assert.ok(r.lockBlockedReasons.includes("no_active_file"));
});

test("getPeriodReview: no board_period row → canLock = false", async () => {
  const pool = new TestPool({ responders: makeResponders({ period: null }) });
  const r = await getPeriodReview(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(r.period.status, null);
  assert.equal(r.canLock, false);
  assert.ok(r.lockBlockedReasons.includes("no_board_period_row"));
});

test("getPeriodReview: already locked → canLock = false + already_locked reason", async () => {
  const pool = new TestPool({
    responders: makeResponders({
      period: { ...PERIOD_ROW, status: "locked", locked_at: new Date("2026-05-30T00:00:00Z"), locked_by: "admin@x" },
    }),
  });
  const r = await getPeriodReview(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(r.canLock, false);
  assert.ok(r.lockBlockedReasons.includes("already_locked"));
  assert.equal(r.period.locked_by, "admin@x");
});

test("getPeriodReview: prior versions surfaced in descending order", async () => {
  const pool = new TestPool({
    responders: makeResponders({
      priors: [
        { ...PRIOR_FILE, file_id: 999, version_no: 2 },
        { ...PRIOR_FILE, file_id: 998, version_no: 1, has_total_discrepancy: false },
      ],
    }),
  });
  const r = await getPeriodReview(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(r.priorVersions.length, 2);
  assert.equal(r.priorVersions[0].version_no, 2);
  assert.equal(r.priorVersions[0].is_superseded, true);
  assert.equal(r.priorVersions[1].version_no, 1);
});

test("getPeriodReview: volumeFact preview decorated with display names", async () => {
  const pool = new TestPool({
    responders: makeResponders({
      facts: [
        {
          customer_key: "ULTRACHEM", customer_display_name: "ULTRACHEM",
          is_intercompany: true,
          package_key: "DRUM OIL", package_display_name: "Drum Oil", family: "oil",
          gallons: 42460,
        },
      ],
    }),
  });
  const r = await getPeriodReview(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(r.volumeFacts.length, 1);
  assert.equal(r.volumeFacts[0].customer_display_name, "ULTRACHEM");
  assert.equal(r.volumeFacts[0].package_display_name, "Drum Oil");
  assert.equal(r.volumeFacts[0].gallons, 42460);
});

test("getPeriodReview: invalid year/month rejected", async () => {
  const pool = new TestPool({ responders: makeResponders({}) });
  await assert.rejects(
    () => getPeriodReview(pool as unknown as import("pg").Pool, 1999, 5),
    /invalid year/
  );
  await assert.rejects(
    () => getPeriodReview(pool as unknown as import("pg").Pool, 2026, 13),
    /invalid month/
  );
});


test("getPeriodReview: surfaces periodEvents (PR 003G) in newest-first order", async () => {
  const pool = new TestPool({
    responders: makeResponders({
      events: [
        {
          event_id: 2, period_year: 2026, period_month: 5, file_id: 1001,
          event_type: "reopened",
          event_at: new Date("2026-06-01T00:00:00Z"),
          event_by: "admin@second",
          prior_status: "locked", new_status: "reopened",
          reason: null, metadata: {},
          filename: "U1DYNAMICS_VOLUME_2026_05.xlsx", version_no: 3,
        },
        {
          event_id: 1, period_year: 2026, period_month: 5, file_id: 1001,
          event_type: "locked",
          event_at: new Date("2026-05-30T00:00:00Z"),
          event_by: "admin@first",
          prior_status: "in_review", new_status: "locked",
          reason: null, metadata: { source: "lockPeriod" },
          filename: "U1DYNAMICS_VOLUME_2026_05.xlsx", version_no: 3,
        },
      ],
    }),
  });
  const r = await getPeriodReview(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(r.periodEvents.length, 2);
  assert.equal(r.periodEvents[0].event_type, "reopened");
  assert.equal(r.periodEvents[0].event_at, "2026-06-01T00:00:00.000Z");
  assert.equal(r.periodEvents[1].event_type, "locked");
});
