/**
 * src/lib/review/reopen-period.ts
 *
 * PR 003F — Controlled reopen action for a locked period.
 *
 * Contract:
 *   - The period must currently be 'locked'. Reopening any other status
 *     is rejected (returns reason 'not_locked').
 *   - On success, board_periods.status flips to 'reopened', and the
 *     reopened_at / reopened_by audit columns are written.
 *   - The active volume_files row's locked_at is INTENTIONALLY NOT
 *     cleared. It is preserved as the audit timestamp of the prior
 *     lock; re-locking will overwrite it (a known limitation tracked
 *     in CLAUDE.md / the report).
 *   - No alerts are reopened. No operator notes are reopened. The admin
 *     reopens those separately via the existing UIs if needed.
 *
 * Transactional via SELECT FOR UPDATE so concurrent reopen attempts
 * serialize cleanly; whichever wins flips the row, the loser sees
 * status='reopened' and gets the 'not_locked' rejection.
 */
import type { Pool } from "pg";
import { recordPeriodEvent } from "./record-period-event";

export type ReopenResult =
  | { ok: true; reopenedAt: string }
  | { ok: false; reasons: string[] };

export async function reopenPeriod(
  pool: Pool,
  year: number,
  month: number,
  reopenedBy: string
): Promise<ReopenResult> {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return { ok: false, reasons: ["invalid_year"] };
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { ok: false, reasons: ["invalid_month"] };
  }
  if (!reopenedBy) {
    return { ok: false, reasons: ["reopened_by_required"] };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const row = await client.query<{
      status: string;
      locked_at: Date | string | null;
      locked_by: string | null;
    }>(
      `SELECT status, locked_at, locked_by
         FROM u1d_ops.board_periods
        WHERE period_year = $1 AND period_month = $2
        FOR UPDATE`,
      [year, month]
    );
    if (row.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reasons: ["no_board_period_row"] };
    }
    if (row.rows[0].status !== "locked") {
      await client.query("ROLLBACK");
      return { ok: false, reasons: ["not_locked"] };
    }
    const previousLockedAt = row.rows[0].locked_at;
    const previousLockedBy = row.rows[0].locked_by;

    // Look up the active file_id so the audit event carries it. The active
    // file is not modified here (its locked_at stays as the historical
    // record); we only need its id for the event row.
    const activeRow = await client.query<{ file_id: number }>(
      `SELECT file_id
         FROM u1d_ops.volume_files
        WHERE period_year = $1 AND period_month = $2 AND is_active = TRUE
        FOR UPDATE`,
      [year, month]
    );
    const activeFileId =
      activeRow.rowCount && activeRow.rowCount > 0
        ? activeRow.rows[0].file_id
        : null;

    const upd = await client.query<{ reopened_at: Date | string }>(
      `UPDATE u1d_ops.board_periods
          SET status = 'reopened',
              reopened_at = NOW(),
              reopened_by = $3,
              updated_at = NOW()
        WHERE period_year = $1 AND period_month = $2
        RETURNING reopened_at`,
      [year, month, reopenedBy]
    );

    // PR 003G — audit insert inside the same TX. A throw here triggers the
    // outer catch handler's ROLLBACK so the reopen is not committed.
    await recordPeriodEvent(client, {
      periodYear: year,
      periodMonth: month,
      fileId: activeFileId,
      eventType: "reopened",
      eventBy: reopenedBy,
      priorStatus: "locked",
      newStatus: "reopened",
      metadata: {
        source: "reopenPeriod",
        previous_locked_at:
          previousLockedAt instanceof Date
            ? previousLockedAt.toISOString()
            : previousLockedAt,
        previous_locked_by: previousLockedBy,
        reopened_from_status: "locked",
      },
    });

    await client.query("COMMIT");

    const ts = upd.rows[0].reopened_at;
    return {
      ok: true,
      reopenedAt: ts instanceof Date ? ts.toISOString() : ts,
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}
