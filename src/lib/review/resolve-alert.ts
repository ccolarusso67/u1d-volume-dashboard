/**
 * src/lib/review/resolve-alert.ts
 *
 * PR 003D — Apply a resolution to one alert row.
 *
 * The discriminated union covers all three alert types and every action
 * the schema supports today:
 *
 *   package_alert:
 *     - ignored  → status='ignored',  no mapping target
 *     - mapped   → status='mapped',   mapped_to_package_key=<existing key>
 *
 *   customer_alert:
 *     - ignored      → status='ignored'
 *     - mapped       → status='mapped', mapped_to_customer_key=<existing key>
 *     - create_alias → INSERT INTO customer_aliases (raw_label, customer_key)
 *                      then status='mapped', mapped_to_customer_key=<key>
 *
 *   data_quality_alert:
 *     - acknowledged → status='acknowledged'
 *     - ignored      → status='ignored'
 *
 * Resolver fields written on every action: resolved_by, resolved_at = NOW().
 * `note` (when provided) is appended to the existing notes column for
 * package/customer alerts. For data_quality_alerts the schema has no notes
 * column today; the note is silently dropped — documented as a limitation.
 *
 * create_alias is the only multi-statement action and runs in a transaction
 * so the alias insert + alert update commit atomically.
 */
import type { Pool } from "pg";

export type AlertResolution =
  | {
      kind: "package_alert";
      alertId: number;
      action: "ignored" | "mapped";
      mappingTarget?: string; // required iff action === 'mapped'
      note?: string;
    }
  | {
      kind: "customer_alert";
      alertId: number;
      action: "ignored" | "mapped" | "create_alias";
      mappingTarget?: string;
      note?: string;
    }
  | {
      kind: "data_quality_alert";
      alertId: number;
      action: "acknowledged" | "ignored";
      note?: string;
    };

export type ResolveResult =
  | { ok: true; alertId: number; newStatus: string }
  | { ok: false; reason: string };

export async function resolveAlert(
  pool: Pool,
  resolution: AlertResolution,
  resolvedBy: string
): Promise<ResolveResult> {
  if (!resolvedBy) {
    return { ok: false, reason: "resolved_by_required" };
  }
  if (!Number.isInteger(resolution.alertId) || resolution.alertId <= 0) {
    return { ok: false, reason: "invalid_alert_id" };
  }

  switch (resolution.kind) {
    case "package_alert":
      return resolvePackageAlert(pool, resolution, resolvedBy);
    case "customer_alert":
      return resolveCustomerAlert(pool, resolution, resolvedBy);
    case "data_quality_alert":
      return resolveDataQualityAlert(pool, resolution, resolvedBy);
  }
}

// ---------------------------------------------------------------------------
// Package alerts
// ---------------------------------------------------------------------------

async function resolvePackageAlert(
  pool: Pool,
  r: Extract<AlertResolution, { kind: "package_alert" }>,
  resolvedBy: string
): Promise<ResolveResult> {
  if (r.action === "mapped" && !r.mappingTarget) {
    return { ok: false, reason: "mapping_target_required" };
  }
  const newStatus = r.action === "mapped" ? "mapped" : "ignored";
  const mappedTo = r.action === "mapped" ? r.mappingTarget! : null;

  const res = await pool.query<{ alert_id: number }>(
    `UPDATE u1d_ops.package_alerts
        SET status = $2,
            mapped_to_package_key = $3,
            resolved_by = $4,
            resolved_at = NOW(),
            notes = CASE
                      WHEN $5::text IS NULL OR length($5::text) = 0
                        THEN notes
                      WHEN notes IS NULL OR length(notes) = 0
                        THEN $5::text
                      ELSE notes || E'\\n' || $5::text
                    END
      WHERE alert_id = $1 AND status = 'pending'
      RETURNING alert_id`,
    [r.alertId, newStatus, mappedTo, resolvedBy, r.note ?? null]
  );
  if (res.rowCount === 0) {
    return { ok: false, reason: "alert_not_pending_or_not_found" };
  }
  return { ok: true, alertId: r.alertId, newStatus };
}

// ---------------------------------------------------------------------------
// Customer alerts
// ---------------------------------------------------------------------------

async function resolveCustomerAlert(
  pool: Pool,
  r: Extract<AlertResolution, { kind: "customer_alert" }>,
  resolvedBy: string
): Promise<ResolveResult> {
  if ((r.action === "mapped" || r.action === "create_alias") && !r.mappingTarget) {
    return { ok: false, reason: "mapping_target_required" };
  }

  // Simple paths: ignored / mapped (no alias insert).
  if (r.action !== "create_alias") {
    const newStatus = r.action === "mapped" ? "mapped" : "ignored";
    const mappedTo = r.action === "mapped" ? r.mappingTarget! : null;
    const res = await pool.query<{ alert_id: number }>(
      `UPDATE u1d_ops.customer_alerts
          SET status = $2,
              mapped_to_customer_key = $3,
              resolved_by = $4,
              resolved_at = NOW(),
              notes = CASE
                        WHEN $5::text IS NULL OR length($5::text) = 0
                          THEN notes
                        WHEN notes IS NULL OR length(notes) = 0
                          THEN $5::text
                        ELSE notes || E'\\n' || $5::text
                      END
        WHERE alert_id = $1 AND status = 'pending'
        RETURNING alert_id`,
      [r.alertId, newStatus, mappedTo, resolvedBy, r.note ?? null]
    );
    if (res.rowCount === 0) {
      return { ok: false, reason: "alert_not_pending_or_not_found" };
    }
    return { ok: true, alertId: r.alertId, newStatus };
  }

  // create_alias: 1) fetch raw_label, 2) INSERT alias, 3) UPDATE alert.
  // All three inside a transaction so a duplicate-alias error rolls back
  // the alert update too.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const alert = await client.query<{ raw_label: string }>(
      `SELECT raw_label FROM u1d_ops.customer_alerts
        WHERE alert_id = $1 AND status = 'pending'
        FOR UPDATE`,
      [r.alertId]
    );
    if (alert.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "alert_not_pending_or_not_found" };
    }
    const rawLabelUpper = alert.rows[0].raw_label.toUpperCase();

    // raw_label is constrained UPPER + UNIQUE. ON CONFLICT for idempotency
    // (in case an admin already added this alias manually).
    await client.query(
      `INSERT INTO u1d_ops.customer_aliases (raw_label, customer_key, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (raw_label) DO NOTHING`,
      [rawLabelUpper, r.mappingTarget!, resolvedBy]
    );

    const upd = await client.query(
      `UPDATE u1d_ops.customer_alerts
          SET status = 'mapped',
              mapped_to_customer_key = $2,
              resolved_by = $3,
              resolved_at = NOW(),
              notes = CASE
                        WHEN $4::text IS NULL OR length($4::text) = 0
                          THEN COALESCE(notes, '') || E'\\nalias_created'
                        WHEN notes IS NULL OR length(notes) = 0
                          THEN 'alias_created: ' || $4::text
                        ELSE notes || E'\\nalias_created: ' || $4::text
                      END
        WHERE alert_id = $1`,
      [r.alertId, r.mappingTarget!, resolvedBy, r.note ?? null]
    );
    if (upd.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "alert_update_failed" };
    }
    await client.query("COMMIT");
    return { ok: true, alertId: r.alertId, newStatus: "mapped" };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    if (err instanceof Error && /foreign key/i.test(err.message)) {
      return { ok: false, reason: "mapping_target_not_in_customers" };
    }
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Data quality alerts
// ---------------------------------------------------------------------------

async function resolveDataQualityAlert(
  pool: Pool,
  r: Extract<AlertResolution, { kind: "data_quality_alert" }>,
  resolvedBy: string
): Promise<ResolveResult> {
  const newStatus = r.action === "acknowledged" ? "acknowledged" : "ignored";

  // The data_quality_alerts table has no notes column today. If a note is
  // supplied we silently drop it; documented as a known limitation.
  const res = await pool.query<{ alert_id: number }>(
    `UPDATE u1d_ops.data_quality_alerts
        SET status = $2,
            resolved_by = $3,
            resolved_at = NOW()
      WHERE alert_id = $1 AND status = 'pending'
      RETURNING alert_id`,
    [r.alertId, newStatus, resolvedBy]
  );
  if (res.rowCount === 0) {
    return { ok: false, reason: "alert_not_pending_or_not_found" };
  }
  return { ok: true, alertId: r.alertId, newStatus };
}
