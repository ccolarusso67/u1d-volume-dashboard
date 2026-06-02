/**
 * src/lib/finance/db-pool.ts
 *
 * PR 012A — Read-only consumer of the Ultra1Plus Finance Railway Postgres.
 *
 * U1D-app is the 6th read-only consumer of the shared finance warehouse
 * (see ultra1plus-finance-mcp). All queries here go through a separate
 * pg.Pool, isolated from U1D's own write-side pool (src/lib/db-pool.ts).
 *
 * Two non-negotiables enforced everywhere in this module:
 *   1. READ-ONLY. Never write to the finance Postgres. U1D writes only to
 *      its own u1d_ops schema.
 *   2. ALWAYS filter by company_id = U1D_COMPANY_ID. The finance MCP
 *      server documents a fallback to 'u1p_ultrachem' when no company is
 *      specified — that fallback returns the WRONG entity for U1D. Every
 *      query in src/lib/finance/* must include the explicit filter.
 */
import { Pool } from "pg";

/** Hardcoded — U1D-app always queries the u1dynamics entity. Never change. */
export const U1D_COMPANY_ID = "u1dynamics";

export function getFinancePool(): Pool {
  const g = globalThis as unknown as { __u1dFinancePool?: Pool };
  if (!g.__u1dFinancePool) {
    if (!process.env.U1D_FINANCE_DATABASE_URL) {
      throw new Error("U1D_FINANCE_DATABASE_URL is not set");
    }
    g.__u1dFinancePool = new Pool({
      connectionString: process.env.U1D_FINANCE_DATABASE_URL,
      max: 5,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : undefined,
    });
  }
  return g.__u1dFinancePool;
}
