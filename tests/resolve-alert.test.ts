/**
 * tests/resolve-alert.test.ts
 *
 * PR 003D — alert-resolution helper.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TestPool } from "./test-pool";
import { resolveAlert } from "../src/lib/review/resolve-alert";

test("package_alert ignored: UPDATE with status='ignored', mapped key null", async () => {
  const pool = new TestPool({
    responders: [
      (t) =>
        t.includes("UPDATE u1d_ops.package_alerts")
          ? { rows: [{ alert_id: 11 }], rowCount: 1 }
          : null,
    ],
  });
  const r = await resolveAlert(
    pool as unknown as import("pg").Pool,
    { kind: "package_alert", alertId: 11, action: "ignored", note: "not relevant" },
    "admin@x"
  );
  assert.deepEqual(r, { ok: true, alertId: 11, newStatus: "ignored" });
  const q = pool.findQuery("UPDATE u1d_ops.package_alerts");
  assert.equal(q?.params?.[1], "ignored");
  assert.equal(q?.params?.[2], null, "mapped_to_package_key=null on ignore");
  assert.equal(q?.params?.[3], "admin@x", "resolved_by recorded");
  assert.equal(q?.params?.[4], "not relevant");
});

test("package_alert mapped without mappingTarget → error", async () => {
  const pool = new TestPool({ responders: [() => ({ rows: [], rowCount: 0 })] });
  const r = await resolveAlert(
    pool as unknown as import("pg").Pool,
    { kind: "package_alert", alertId: 11, action: "mapped" },
    "admin@x"
  );
  assert.deepEqual(r, { ok: false, reason: "mapping_target_required" });
  assert.equal(pool.queries.length, 0, "no DB call when validation fails");
});

test("package_alert mapped with mappingTarget: status='mapped', key set", async () => {
  const pool = new TestPool({
    responders: [
      (t) =>
        t.includes("UPDATE u1d_ops.package_alerts")
          ? { rows: [{ alert_id: 11 }], rowCount: 1 }
          : null,
    ],
  });
  const r = await resolveAlert(
    pool as unknown as import("pg").Pool,
    { kind: "package_alert", alertId: 11, action: "mapped", mappingTarget: "FLEXIBAG" },
    "admin@x"
  );
  assert.equal(r.ok, true);
  const q = pool.findQuery("UPDATE u1d_ops.package_alerts");
  assert.equal(q?.params?.[1], "mapped");
  assert.equal(q?.params?.[2], "FLEXIBAG");
});

test("package_alert: row missing or already resolved → error", async () => {
  const pool = new TestPool({
    responders: [
      (t) =>
        t.includes("UPDATE u1d_ops.package_alerts")
          ? { rows: [], rowCount: 0 }
          : null,
    ],
  });
  const r = await resolveAlert(
    pool as unknown as import("pg").Pool,
    { kind: "package_alert", alertId: 999, action: "ignored" },
    "admin@x"
  );
  assert.deepEqual(r, { ok: false, reason: "alert_not_pending_or_not_found" });
});

test("customer_alert mapped: UPDATE only (no alias insert)", async () => {
  const pool = new TestPool({
    responders: [
      (t) =>
        t.includes("UPDATE u1d_ops.customer_alerts")
          ? { rows: [{ alert_id: 22 }], rowCount: 1 }
          : null,
    ],
  });
  const r = await resolveAlert(
    pool as unknown as import("pg").Pool,
    {
      kind: "customer_alert",
      alertId: 22,
      action: "mapped",
      mappingTarget: "SUN COAST RESOURCES",
    },
    "admin@x"
  );
  assert.equal(r.ok, true);
  // No INSERT INTO customer_aliases on plain mapped action.
  assert.equal(pool.findQuery("INSERT INTO u1d_ops.customer_aliases"), undefined);
});

test("customer_alert create_alias: TX with SELECT FOR UPDATE + INSERT alias + UPDATE alert", async () => {
  const pool = new TestPool({
    responders: [
      (t) => (/^BEGIN/.test(t.trim()) ? { rows: [] } : null),
      (t) =>
        t.includes("SELECT raw_label FROM u1d_ops.customer_alerts")
          ? { rows: [{ raw_label: "SUNCOAST" }], rowCount: 1 }
          : null,
      (t) =>
        t.includes("INSERT INTO u1d_ops.customer_aliases")
          ? { rows: [] }
          : null,
      (t) =>
        t.includes("UPDATE u1d_ops.customer_alerts\n          SET status = 'mapped'")
          ? { rows: [], rowCount: 1 }
          : null,
      (t) => (/^COMMIT/.test(t.trim()) ? { rows: [] } : null),
    ],
  });
  const r = await resolveAlert(
    pool as unknown as import("pg").Pool,
    {
      kind: "customer_alert",
      alertId: 22,
      action: "create_alias",
      mappingTarget: "SUN COAST RESOURCES",
    },
    "admin@x"
  );
  assert.equal(r.ok, true);
  const insert = pool.findQuery("INSERT INTO u1d_ops.customer_aliases");
  assert.ok(insert, "alias INSERT must run");
  assert.equal(insert?.params?.[0], "SUNCOAST", "raw_label uppercased");
  assert.equal(insert?.params?.[1], "SUN COAST RESOURCES");
});

test("data_quality_alert acknowledged: UPDATE with status='acknowledged'", async () => {
  const pool = new TestPool({
    responders: [
      (t) =>
        t.includes("UPDATE u1d_ops.data_quality_alerts")
          ? { rows: [{ alert_id: 33 }], rowCount: 1 }
          : null,
    ],
  });
  const r = await resolveAlert(
    pool as unknown as import("pg").Pool,
    { kind: "data_quality_alert", alertId: 33, action: "acknowledged" },
    "admin@x"
  );
  assert.deepEqual(r, { ok: true, alertId: 33, newStatus: "acknowledged" });
});

test("data_quality_alert ignored: UPDATE with status='ignored'", async () => {
  const pool = new TestPool({
    responders: [
      (t) =>
        t.includes("UPDATE u1d_ops.data_quality_alerts")
          ? { rows: [{ alert_id: 33 }], rowCount: 1 }
          : null,
    ],
  });
  const r = await resolveAlert(
    pool as unknown as import("pg").Pool,
    { kind: "data_quality_alert", alertId: 33, action: "ignored" },
    "admin@x"
  );
  assert.equal(r.ok, true);
  const q = pool.findQuery("UPDATE u1d_ops.data_quality_alerts");
  assert.equal(q?.params?.[1], "ignored");
});

test("resolveAlert: empty resolvedBy is rejected", async () => {
  const pool = new TestPool({ responders: [() => ({ rows: [] })] });
  const r = await resolveAlert(
    pool as unknown as import("pg").Pool,
    { kind: "package_alert", alertId: 1, action: "ignored" },
    ""
  );
  assert.deepEqual(r, { ok: false, reason: "resolved_by_required" });
  assert.equal(pool.queries.length, 0);
});

test("resolveAlert: invalid alertId rejected", async () => {
  const pool = new TestPool({ responders: [() => ({ rows: [] })] });
  const r = await resolveAlert(
    pool as unknown as import("pg").Pool,
    { kind: "package_alert", alertId: 0, action: "ignored" },
    "admin@x"
  );
  assert.equal(r.ok, false);
});
