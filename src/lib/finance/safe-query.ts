/**
 * src/lib/finance/safe-query.ts
 *
 * PR 012A — finance-read safety wrapper.
 *
 * Mirrors the convention in ultra1plus-finance-mcp's dashboard
 * (`safeQuery` / `safeQueryOne`): never throw on missing-table errors,
 * never crash the page. Return empty arrays / null and log the error so
 * the U1D board can render a degraded view ("Finance data not available")
 * instead of a 500 when the upstream warehouse has a problem.
 *
 * This is a non-negotiable rule in the finance-mcp repo's CLAUDE.md
 * ("All API queries go through safeQuery / safeQueryOne — never raw
 * client.query"). U1D-app adopts it for the same reason.
 */
import type { Pool } from "pg";

/** Returns empty array on missing-table / SQL errors. Never throws. */
export async function safeQuery<T = Record<string, unknown>>(
  pool: Pool,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  try {
    const r = await pool.query(sql, params);
    return r.rows as T[];
  } catch (err) {
    console.error("[finance.safeQuery] error", {
      sql: sql.slice(0, 200),
      params,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Returns null on missing-table / SQL errors. Never throws. */
export async function safeQueryOne<T = Record<string, unknown>>(
  pool: Pool,
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await safeQuery<T>(pool, sql, params);
  return rows[0] ?? null;
}
