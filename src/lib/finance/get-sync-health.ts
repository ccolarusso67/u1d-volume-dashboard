/**
 * src/lib/finance/get-sync-health.ts
 *
 * PR 012A — sync status for the 12 U1D finance sync jobs.
 *
 * Used by the data-freshness banner on the board surface. If any job is
 * in 'error' status or hasn't succeeded in > 24h, the banner goes red so
 * the board reader knows the numbers might be stale before they read them.
 *
 * Source: u1p_finance.sync_status (one row per company_id × job_name).
 */
import type { Pool } from "pg";
import { U1D_COMPANY_ID } from "./db-pool";
import { safeQuery } from "./safe-query";
import type { SyncHealthRow } from "./types";

export async function getSyncHealth(pool: Pool): Promise<SyncHealthRow[]> {
  return safeQuery<SyncHealthRow>(
    pool,
    `SELECT
       job_name,
       status,
       TO_CHAR(last_run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_run_at,
       TO_CHAR(last_success_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_success_at,
       records_synced,
       error_message
     FROM sync_status
     WHERE company_id = $1
     ORDER BY job_name`,
    [U1D_COMPANY_ID]
  );
}

/** Pure helper — assess the rolled-up health from a list of sync rows. */
export type SyncHealthAssessment = {
  total_jobs: number;
  jobs_success: number;
  jobs_error: number;
  jobs_stale: number;     // success but last_success_at > stale_threshold_hours
  newest_success_at: string | null;
  oldest_success_at: string | null;
  worst_status: "ok" | "stale" | "error";
};

export function assessSyncHealth(
  rows: SyncHealthRow[],
  opts: { stale_threshold_hours?: number; now?: Date } = {}
): SyncHealthAssessment {
  const staleHrs = opts.stale_threshold_hours ?? 24;
  const now = opts.now ?? new Date();
  const staleCutoff = new Date(now.getTime() - staleHrs * 3600 * 1000);

  let jobsSuccess = 0;
  let jobsError = 0;
  let jobsStale = 0;
  let newest: Date | null = null;
  let oldest: Date | null = null;

  for (const r of rows) {
    if (r.status === "error") {
      jobsError++;
      continue;
    }
    if (r.status === "success") {
      jobsSuccess++;
      const t = r.last_success_at ? new Date(r.last_success_at) : null;
      if (t) {
        if (!newest || t > newest) newest = t;
        if (!oldest || t < oldest) oldest = t;
        if (t < staleCutoff) jobsStale++;
      } else {
        // success status with no timestamp — treat as stale
        jobsStale++;
      }
    }
  }

  const worst: SyncHealthAssessment["worst_status"] =
    jobsError > 0 ? "error" : jobsStale > 0 ? "stale" : "ok";

  return {
    total_jobs: rows.length,
    jobs_success: jobsSuccess,
    jobs_error: jobsError,
    jobs_stale: jobsStale,
    newest_success_at: newest ? newest.toISOString() : null,
    oldest_success_at: oldest ? oldest.toISOString() : null,
    worst_status: worst,
  };
}
