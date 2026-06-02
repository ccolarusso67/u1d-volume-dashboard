/**
 * src/lib/finance/get-ap-aging.ts
 *
 * PR 012A — latest AP aging snapshot for U1Dynamics.
 *
 * Uses v_latest_ap_aging (most recent snapshot per vendor).
 * Populated by ApAgingSyncJob.
 */
import type { Pool } from "pg";
import { U1D_COMPANY_ID } from "./db-pool";
import { safeQuery } from "./safe-query";
import type { ApAgingRow } from "./types";

export async function getLatestApAging(pool: Pool): Promise<ApAgingRow[]> {
  return safeQuery<ApAgingRow>(
    pool,
    `SELECT
       vendor_name,
       current_bucket,
       days_1_30, days_31_60, days_61_90, days_91_plus,
       total_open_balance,
       TO_CHAR(snapshot_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS snapshot_at
     FROM v_latest_ap_aging
     WHERE company_id = $1
     ORDER BY total_open_balance DESC`,
    [U1D_COMPANY_ID]
  );
}
