/**
 * src/lib/finance/get-ar-aging.ts
 *
 * PR 012A — latest AR aging snapshot for U1Dynamics.
 *
 * Uses the v_latest_ar_aging view (most recent snapshot per customer)
 * defined in ultra1plus-finance-mcp/db/migrations/002_multi_company.sql.
 * Populated by ArAgingSyncJob which pulls QB's AR Aging Summary report.
 *
 * Returns one row per customer with open balance + 5 aging buckets.
 */
import type { Pool } from "pg";
import { U1D_COMPANY_ID } from "./db-pool";
import { safeQuery } from "./safe-query";
import type { ArAgingRow } from "./types";

export async function getLatestArAging(pool: Pool): Promise<ArAgingRow[]> {
  return safeQuery<ArAgingRow>(
    pool,
    `SELECT
       customer_id,
       customer_name,
       current_bucket,
       days_1_30, days_31_60, days_61_90, days_91_plus,
       total_open_balance,
       TO_CHAR(snapshot_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS snapshot_at
     FROM v_latest_ar_aging
     WHERE company_id = $1
     ORDER BY total_open_balance DESC`,
    [U1D_COMPANY_ID]
  );
}
