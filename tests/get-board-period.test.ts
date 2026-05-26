/**
 * tests/get-board-period.test.ts
 *
 * PR 004A — board period aggregator.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TestPool } from "./test-pool";
import { getBoardPeriod } from "../src/lib/board/get-board-period";

type AnyRow = Record<string, unknown>;

type Opts = {
  // current month
  boardPeriod?: { status: string; locked_at?: Date | string | null; locked_by?: string | null } | null;
  activeFile?: AnyRow | null;
  agg?: { total_gallons: number; customer_count: number; package_count: number; fact_row_count: number };
  topCustomers?: AnyRow[];
  topPackages?: AnyRow[];
  alertCounts?: {
    package_total: number; customer_total: number; dq_total: number;
    pending_total: number; resolved_total: number;
  };
  notes?: AnyRow[];
  events?: AnyRow[];
  // prior month
  priorAgg?: { total_gallons: number; customer_count: number; package_count: number; fact_row_count: number };
  priorByCustomer?: AnyRow[];
  priorByPackage?: AnyRow[];
};

const COMPLETE_NOTES_ROW = {
  capacity_md: "Capacity ok",
  supply_chain_md: "Supply ok",
  quality_md: "Quality ok",
  initiatives_md: "Initiatives ok",
  risks_md: "Risks ok",
  completed_at: new Date("2026-05-30T00:00:00Z"),
  completed_by: "admin@x",
  updated_at: new Date(),
  updated_by: "admin@x",
};

function makePool(o: Opts = {}): TestPool {
  // The ACTIVE_FILE_SQL and BOARD_PERIOD_SQL queries both reference
  // u1d_ops.volume_files / board_periods without further filters that
  // collide with other helpers, so we match by SQL substring.
  return new TestPool({
    responders: [
      // BOARD_PERIOD_SQL — has "FROM u1d_ops.board_periods" + WHERE period_year
      (t) =>
        t.includes("FROM u1d_ops.board_periods\n   WHERE period_year")
          ? { rows: o.boardPeriod === null ? [] : [o.boardPeriod ?? { status: "locked", locked_at: new Date("2026-05-30T00:00:00Z"), locked_by: "admin@x" }] }
          : null,
      // ACTIVE_FILE_SQL — "FROM u1d_ops.volume_files" + "AND is_active = TRUE\n   LIMIT 1"
      (t) =>
        t.includes("AND is_active = TRUE\n   LIMIT 1")
          ? {
              rows:
                o.activeFile === null
                  ? []
                  : [o.activeFile ?? {
                      file_id: 1001,
                      filename: "U1DYNAMICS_VOLUME_2026_05.xlsx",
                      file_hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
                      version_no: 3,
                      uploaded_at: new Date("2026-05-26T15:30:00Z"),
                      uploaded_by: "carmine@x",
                      source_total_row: 175319,
                      computed_customer_sum: 175319,
                      has_total_discrepancy: false,
                      discrepancy_amount: null,
                    }],
            }
          : null,
      // operator notes (called via getOperatorNotes — same SQL signature as PR 003E)
      (t) =>
        t.includes("FROM u1d_ops.monthly_operator_notes")
          ? { rows: o.notes ?? [COMPLETE_NOTES_ROW] }
          : null,
      // lock events
      (t) =>
        t.includes("FROM u1d_ops.period_lock_events")
          ? { rows: o.events ?? [] }
          : null,
      // alert counts
      (t) =>
        t.includes("AS package_total")
          ? {
              rows: [
                o.alertCounts ?? {
                  package_total: 0,
                  customer_total: 0,
                  dq_total: 0,
                  pending_total: 0,
                  resolved_total: 0,
                },
              ],
            }
          : null,
      // TOP_CUSTOMERS_SQL — has "GROUP BY vf.customer_key, c.display_name"
      (t) =>
        t.includes("GROUP BY vf.customer_key, c.display_name")
          ? { rows: o.topCustomers ?? [] }
          : null,
      // TOP_PACKAGES_SQL — "GROUP BY vf.package_key, p.display_name"
      (t) =>
        t.includes("GROUP BY vf.package_key, p.display_name")
          ? { rows: o.topPackages ?? [] }
          : null,
      // PRIOR_BY_CUSTOMER_SQL — single-column GROUP BY vf.customer_key
      (t) =>
        t.includes("GROUP BY vf.customer_key") && !t.includes("c.display_name")
          ? { rows: o.priorByCustomer ?? [] }
          : null,
      // PRIOR_BY_PACKAGE_SQL
      (t) =>
        t.includes("GROUP BY vf.package_key") && !t.includes("p.display_name")
          ? { rows: o.priorByPackage ?? [] }
          : null,
      // AGGREGATE_SQL — has total_gallons + customer_count + package_count.
      // Both current AND prior month use this SQL with different params.
      // The current/prior shape is identical, so we route on the params[0].
      (t, p) => {
        if (!t.includes("COUNT(DISTINCT vf.customer_key)")) return null;
        const year = (p ?? [])[0];
        // current = year 2026 (or whatever the test passes); prior = year - 1 or month-1 same year.
        // The test passes 2026/5; prior is 2026/4. Distinguish by param[1] (month).
        const month = (p ?? [])[1];
        if (year === 2026 && month === 5) {
          return { rows: [o.agg ?? { total_gallons: 175319, customer_count: 5, package_count: 12, fact_row_count: 50 }] };
        }
        // prior
        return { rows: [o.priorAgg ?? { total_gallons: 0, customer_count: 0, package_count: 0, fact_row_count: 0 }] };
      },
    ],
  });
}

// ---------------------------------------------------------------------------

test("getBoardPeriod: invalid year/month rejected", async () => {
  const pool = makePool();
  await assert.rejects(() => getBoardPeriod(pool as unknown as import("pg").Pool, 1999, 5), /invalid year/);
  await assert.rejects(() => getBoardPeriod(pool as unknown as import("pg").Pool, 2026, 13), /invalid month/);
});

test("getBoardPeriod: missing board_period → blocked, ready=false, blockers include no_board_period_row + period_not_locked", async () => {
  const pool = makePool({ boardPeriod: null });
  const v = await getBoardPeriod(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(v.readiness.ready, false);
  assert.ok(v.readiness.blockers.includes("no_board_period_row"));
  assert.ok(v.readiness.blockers.includes("period_not_locked"));
  assert.equal(v.period.status, null);
});

test("getBoardPeriod: status='in_review' → blocked with period_not_locked", async () => {
  const pool = makePool({
    boardPeriod: { status: "in_review", locked_at: null, locked_by: null },
  });
  const v = await getBoardPeriod(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(v.readiness.ready, false);
  assert.ok(v.readiness.blockers.includes("period_not_locked"));
});

test("getBoardPeriod: no active file → blocked with no_active_file", async () => {
  const pool = makePool({ activeFile: null });
  const v = await getBoardPeriod(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(v.activeFile, null);
  assert.equal(v.readiness.ready, false);
  assert.ok(v.readiness.blockers.includes("no_active_file"));
});

test("getBoardPeriod: operator notes incomplete → blocked", async () => {
  const incomplete = { ...COMPLETE_NOTES_ROW, risks_md: null, completed_at: null, completed_by: null };
  const pool = makePool({ notes: [incomplete] });
  const v = await getBoardPeriod(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(v.readiness.ready, false);
  assert.ok(v.readiness.blockers.includes("operator_notes_incomplete"));
});

test("getBoardPeriod: pending alerts → blocked with pending_alerts_total", async () => {
  const pool = makePool({
    alertCounts: { package_total: 2, customer_total: 0, dq_total: 0, pending_total: 1, resolved_total: 1 },
  });
  const v = await getBoardPeriod(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(v.readiness.ready, false);
  assert.ok(v.readiness.blockers.some((b) => b.startsWith("pending_alerts_total:")));
});

test("getBoardPeriod: fully ready period → ready=true, blockers empty", async () => {
  const pool = makePool({
    topCustomers: [
      { customer_key: "ULTRACHEM", customer_name: "ULTRACHEM", gallons: 100000 },
      { customer_key: "KEY PERFORMANCE", customer_name: "Key Performance", gallons: 50000 },
    ],
    topPackages: [
      { package_key: "DRUM OIL", package_label: "Drum Oil", gallons: 80000 },
      { package_key: "BOX OIL", package_label: "Box Oil", gallons: 70000 },
    ],
    agg: { total_gallons: 175319, customer_count: 5, package_count: 12, fact_row_count: 50 },
  });
  const v = await getBoardPeriod(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(v.readiness.ready, true);
  assert.deepEqual(v.readiness.blockers, []);
});

test("getBoardPeriod: headline metrics + customer/package counts", async () => {
  const pool = makePool();
  const v = await getBoardPeriod(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(v.headlineMetrics.total_gallons, 175319);
  assert.equal(v.headlineMetrics.customer_count, 5);
  assert.equal(v.headlineMetrics.package_count, 12);
  assert.equal(v.headlineMetrics.fact_row_count, 50);
});

test("getBoardPeriod: prior month present → MoM gallons + pct", async () => {
  const pool = makePool({
    priorAgg: { total_gallons: 150000, customer_count: 5, package_count: 12, fact_row_count: 50 },
    priorByCustomer: [{ customer_key: "ULTRACHEM", gallons: 150000 }], // non-empty → has locked prior
  });
  const v = await getBoardPeriod(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(v.headlineMetrics.prior_month_total_gallons, 150000);
  assert.equal(v.headlineMetrics.month_over_month_delta_gallons, 175319 - 150000);
  assert.equal(
    v.headlineMetrics.month_over_month_delta_pct,
    (175319 - 150000) / 150000
  );
});

test("getBoardPeriod: prior month absent (no locked file) → all prior_* null", async () => {
  const pool = makePool({
    priorByCustomer: [], // empty → no prior locked file
  });
  const v = await getBoardPeriod(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(v.headlineMetrics.prior_month_total_gallons, null);
  assert.equal(v.headlineMetrics.month_over_month_delta_gallons, null);
  assert.equal(v.headlineMetrics.month_over_month_delta_pct, null);
});

test("getBoardPeriod: January falls back to prior December (year-1)", async () => {
  // Build a custom pool that recognizes month=12, year=2025 as the prior.
  const pool = new TestPool({
    responders: [
      (t) =>
        t.includes("FROM u1d_ops.board_periods\n   WHERE period_year")
          ? { rows: [{ status: "locked", locked_at: new Date(), locked_by: "x" }] }
          : null,
      (t) =>
        t.includes("AND is_active = TRUE\n   LIMIT 1")
          ? { rows: [{
              file_id: 1, filename: "f.xlsx", file_hash: "0".repeat(64),
              version_no: 1, uploaded_at: new Date(), uploaded_by: "x",
              source_total_row: 100, computed_customer_sum: 100,
              has_total_discrepancy: false, discrepancy_amount: null,
            }] }
          : null,
      (t) =>
        t.includes("FROM u1d_ops.monthly_operator_notes")
          ? { rows: [COMPLETE_NOTES_ROW] }
          : null,
      (t) =>
        t.includes("FROM u1d_ops.period_lock_events")
          ? { rows: [] }
          : null,
      (t) =>
        t.includes("AS package_total")
          ? { rows: [{ package_total: 0, customer_total: 0, dq_total: 0, pending_total: 0, resolved_total: 0 }] }
          : null,
      // top customers + packages (irrelevant for this test)
      (t) =>
        t.includes("GROUP BY vf.customer_key, c.display_name") ? { rows: [] } : null,
      (t) =>
        t.includes("GROUP BY vf.package_key, p.display_name") ? { rows: [] } : null,
      // PRIOR_BY_CUSTOMER — only return non-empty for prior month (2025/12)
      (t, p) => {
        if (!t.includes("GROUP BY vf.customer_key") || t.includes("c.display_name")) return null;
        const [year, month] = (p ?? []) as number[];
        if (year === 2025 && month === 12) {
          return { rows: [{ customer_key: "ULTRACHEM", gallons: 90 }] };
        }
        return { rows: [] };
      },
      (t) =>
        t.includes("GROUP BY vf.package_key") && !t.includes("p.display_name")
          ? { rows: [] }
          : null,
      // AGGREGATE — current = 100, prior = 90 (when params match 2025/12)
      (t, p) => {
        if (!t.includes("COUNT(DISTINCT vf.customer_key)")) return null;
        const [year, month] = (p ?? []) as number[];
        if (year === 2026 && month === 1) return { rows: [{ total_gallons: 100, customer_count: 1, package_count: 1, fact_row_count: 1 }] };
        if (year === 2025 && month === 12) return { rows: [{ total_gallons: 90, customer_count: 1, package_count: 1, fact_row_count: 1 }] };
        return { rows: [{ total_gallons: 0, customer_count: 0, package_count: 0, fact_row_count: 0 }] };
      },
    ],
  });
  const v = await getBoardPeriod(pool as unknown as import("pg").Pool, 2026, 1);
  assert.equal(v.headlineMetrics.total_gallons, 100);
  assert.equal(v.headlineMetrics.prior_month_total_gallons, 90);
  assert.equal(v.headlineMetrics.month_over_month_delta_gallons, 10);
});

test("getBoardPeriod: top customers sorted desc, share + delta computed", async () => {
  const pool = makePool({
    agg: { total_gallons: 1000, customer_count: 2, package_count: 0, fact_row_count: 0 },
    topCustomers: [
      { customer_key: "ULTRACHEM", customer_name: "ULTRACHEM", gallons: 700 },
      { customer_key: "OTHER", customer_name: "Other", gallons: 300 },
    ],
    priorByCustomer: [
      { customer_key: "ULTRACHEM", gallons: 600 },
      { customer_key: "OTHER", gallons: 400 },
    ],
    priorAgg: { total_gallons: 1000, customer_count: 2, package_count: 0, fact_row_count: 0 },
  });
  const v = await getBoardPeriod(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(v.topCustomers.length, 2);
  assert.equal(v.topCustomers[0].customer_name, "ULTRACHEM");
  assert.equal(v.topCustomers[0].gallons, 700);
  assert.equal(v.topCustomers[0].share_pct, 0.7);
  assert.equal(v.topCustomers[0].prior_month_gallons, 600);
  assert.equal(v.topCustomers[0].delta_gallons, 100);
  assert.equal(v.topCustomers[1].delta_gallons, -100);
});

test("getBoardPeriod: top packages sorted desc", async () => {
  const pool = makePool({
    topPackages: [
      { package_key: "DRUM OIL", package_label: "Drum Oil", gallons: 1000 },
      { package_key: "BOX OIL", package_label: "Box Oil", gallons: 500 },
    ],
  });
  const v = await getBoardPeriod(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(v.topPackages.length, 2);
  assert.equal(v.topPackages[0].package_label, "Drum Oil");
  assert.equal(v.topPackages[1].package_label, "Box Oil");
});

test("getBoardPeriod: operator notes exposed under UI section keys", async () => {
  const pool = makePool();
  const v = await getBoardPeriod(pool as unknown as import("pg").Pool, 2026, 5);
  assert.ok(v.operatorNotes);
  assert.equal(v.operatorNotes!.capacity_production, "Capacity ok");
  assert.equal(v.operatorNotes!.supply_chain, "Supply ok");
  assert.equal(v.operatorNotes!.quality_incidents, "Quality ok");
  assert.equal(v.operatorNotes!.initiatives, "Initiatives ok");
  assert.equal(v.operatorNotes!.risks, "Risks ok");
});

test("getBoardPeriod: alert summary exposed", async () => {
  const pool = makePool({
    alertCounts: { package_total: 3, customer_total: 1, dq_total: 0, pending_total: 0, resolved_total: 4 },
  });
  const v = await getBoardPeriod(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(v.alertSummary.package_alerts_total, 3);
  assert.equal(v.alertSummary.customer_alerts_total, 1);
  assert.equal(v.alertSummary.data_quality_alerts_total, 0);
  assert.equal(v.alertSummary.resolved_alerts_total, 4);
  assert.equal(v.alertSummary.pending_alerts_total, 0);
});

test("getBoardPeriod: lock history exposed newest first via listPeriodEvents", async () => {
  const pool = makePool({
    events: [
      {
        event_id: 2, period_year: 2026, period_month: 5, file_id: 1001,
        event_type: "locked", event_at: new Date("2026-05-30T00:00:00Z"),
        event_by: "admin@x", prior_status: "reopened", new_status: "locked",
        reason: null, metadata: {}, filename: "f.xlsx", version_no: 3,
      },
      {
        event_id: 1, period_year: 2026, period_month: 5, file_id: 1001,
        event_type: "reopened", event_at: new Date("2026-05-28T00:00:00Z"),
        event_by: "admin@y", prior_status: "locked", new_status: "reopened",
        reason: null, metadata: {}, filename: "f.xlsx", version_no: 3,
      },
    ],
  });
  const v = await getBoardPeriod(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(v.lockHistory.length, 2);
  assert.equal(v.lockHistory[0].event_type, "locked");
  assert.equal(v.lockHistory[1].event_type, "reopened");
});

test("getBoardPeriod: blocks already_locked is treated as the GOOD state (not a blocker)", async () => {
  const pool = makePool();
  const v = await getBoardPeriod(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(v.readiness.ready, true);
  assert.ok(!v.readiness.blockers.includes("already_locked"));
});
