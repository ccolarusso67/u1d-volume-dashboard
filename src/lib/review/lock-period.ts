/**
 * src/lib/review/lock-period.ts
 *
 * PR 003D — Transactional lock transition for a board period.
 *
 * Lock readiness contract (mirrors getPeriodReview.lockBlockedReasons):
 *   1. Active volume_files row exists for the period.
 *   2. board_periods row exists (it will, because upload UPSERTs it).
 *   3. Period is not already locked.
 *   4. Zero pending package_alerts, customer_alerts, data_quality_alerts
 *      attached to the active file.
 *
 * On success:
 *   - UPDATE board_periods SET status='locked', locked_at=NOW(), locked_by=<email>
 *   - UPDATE active volume_files SET locked_at=NOW(),
 *                                    reviewed_at = COALESCE(reviewed_at, NOW())
 *   - Returns { ok: true, lockedAt, activeFileId }
 *
 * Re-validation inside the transaction (SELECT FOR UPDATE) prevents the
 * "two admins click Lock at the same instant while alerts were just
 * resolved" race condition from corrupting state.
 */
import type { Pool, PoolClient } from "pg";
import { recordPeriodEvent } from "./record-period-event";

export type LockResult =
  | { ok: true; lockedAt: string; activeFileId: number }
  | { ok: false; reasons: string[] };

export async function lockPeriod(
  pool: Pool,
  year: number,
  month: number,
  lockedBy: string
): Promise<LockResult> {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return { ok: false, reasons: ["invalid_year"] };
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { ok: false, reasons: ["invalid_month"] };
  }
  if (!lockedBy) {
    return { ok: false, reasons: ["locked_by_required"] };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the board_periods row first so concurrent calls serialize cleanly.
    const periodRow = await client.query<{
      status: string;
    }>(
      `SELECT status
         FROM u1d_ops.board_periods
        WHERE period_year = $1 AND period_month = $2
        FOR UPDATE`,
      [year, month]
    );
    if (periodRow.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reasons: ["no_board_period_row"] };
    }
    const priorStatus = periodRow.rows[0].status;
    if (priorStatus === "locked") {
      await client.query("ROLLBACK");
      return { ok: false, reasons: ["already_locked"] };
    }

    // Lock the active volume_files row too — its locked_at is being set.
    const activeRow = await client.query<{ file_id: number; version_no: number }>(
      `SELECT file_id, version_no
         FROM u1d_ops.volume_files
        WHERE period_year = $1 AND period_month = $2 AND is_active = TRUE
        FOR UPDATE`,
      [year, month]
    );
    if (activeRow.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reasons: ["no_active_file"] };
    }
    const activeFileId = activeRow.rows[0].file_id;
    const activeVersionNo = activeRow.rows[0].version_no;

    // Re-count pending alerts under the lock. If any are still pending,
    // refuse and ROLLBACK.
    const reasons = await countPendingAlertsAndNotes(client, activeFileId, year, month);
    if (reasons.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, reasons };
    }

    // All gates passed. Update board_periods + active volume_files.
    const upd = await client.query<{ locked_at: Date | string }>(
      `UPDATE u1d_ops.board_periods
          SET status = 'locked',
              locked_at = NOW(),
              locked_by = $3,
              updated_at = NOW()
        WHERE period_year = $1 AND period_month = $2
        RETURNING locked_at`,
      [year, month, lockedBy]
    );

    await client.query(
      `UPDATE u1d_ops.volume_files
          SET locked_at = NOW(),
              reviewed_at = COALESCE(reviewed_at, NOW())
        WHERE file_id = $1`,
      [activeFileId]
    );

    // PR 003G — audit insert inside the same TX. A throw here triggers the
    // outer catch handler's ROLLBACK so the lock is not committed.
    await recordPeriodEvent(client, {
      periodYear: year,
      periodMonth: month,
      fileId: activeFileId,
      eventType: "locked",
      eventBy: lockedBy,
      priorStatus,
      newStatus: "locked",
      metadata: {
        source: "lockPeriod",
        active_file_id: activeFileId,
        version_no: activeVersionNo ?? null,
        readiness_blockers_before_lock: [],
        locked_from_status: priorStatus,
      },
    });

    await client.query("COMMIT");

    const lockedAt = upd.rows[0].locked_at;
    return {
      ok: true,
      lockedAt: lockedAt instanceof Date ? lockedAt.toISOString() : lockedAt,
      activeFileId,
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

async function countPendingAlertsAndNotes(
  client: PoolClient,
  activeFileId: number,
  year: number,
  month: number
): Promise<string[]> {
  // One query for all four signals: three alert counts + operator-notes
  // state. operator_notes_exists is TRUE iff a row exists; operator_notes_complete
  // mirrors lib/operator-notes/is-complete.ts (all sections non-blank AND
  // completed_at IS NOT NULL).
  const r = await client.query<{
    pending_package: number;
    pending_customer: number;
    pending_data_quality: number;
    operator_notes_exists: boolean;
    operator_notes_complete: boolean;
  }>(
    `WITH notes AS (
       SELECT
         capacity_md, supply_chain_md, quality_md, initiatives_md, risks_md,
         completed_at
       FROM u1d_ops.monthly_operator_notes
       WHERE period_year = $2 AND period_month = $3
     )
     SELECT
       (SELECT COUNT(*) FROM u1d_ops.package_alerts
         WHERE file_id = $1 AND status = 'pending')::int      AS pending_package,
       (SELECT COUNT(*) FROM u1d_ops.customer_alerts
         WHERE file_id = $1 AND status = 'pending')::int      AS pending_customer,
       (SELECT COUNT(*) FROM u1d_ops.data_quality_alerts
         WHERE file_id = $1 AND status = 'pending')::int      AS pending_data_quality,
       (EXISTS (SELECT 1 FROM notes))                          AS operator_notes_exists,
       COALESCE((
         SELECT
           completed_at IS NOT NULL
             AND length(coalesce(trim(capacity_md), '')) > 0
             AND length(coalesce(trim(supply_chain_md), '')) > 0
             AND length(coalesce(trim(quality_md), '')) > 0
             AND length(coalesce(trim(initiatives_md), '')) > 0
             AND length(coalesce(trim(risks_md), '')) > 0
         FROM notes
       ), FALSE)                                               AS operator_notes_complete`,
    [activeFileId, year, month]
  );
  const row = r.rows[0];
  const reasons: string[] = [];
  if (row.pending_package > 0)
    reasons.push(`pending_package_alerts:${row.pending_package}`);
  if (row.pending_customer > 0)
    reasons.push(`pending_customer_alerts:${row.pending_customer}`);
  if (row.pending_data_quality > 0)
    reasons.push(`pending_data_quality_alerts:${row.pending_data_quality}`);
  if (!row.operator_notes_exists) {
    reasons.push("operator_notes_missing");
  } else if (!row.operator_notes_complete) {
    reasons.push("operator_notes_incomplete");
  }
  return reasons;
}
