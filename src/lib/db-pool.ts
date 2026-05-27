/**
 * src/lib/db-pool.ts
 *
 * PR 003D — Shared accessor for the global pg.Pool singleton.
 *
 * Several admin paths (route handlers and server pages) need a Pool but
 * src/lib/db.ts currently exposes only query/queryOne helpers. Rather
 * than duplicate the singleton bootstrap in three more places, expose it
 * here. Same global key, same SSL config — so all callers share one pool.
 */
import { Pool } from "pg";

export function getPool(): Pool {
  const g = globalThis as unknown as { __u1dPgPool?: Pool };
  if (!g.__u1dPgPool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    g.__u1dPgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : undefined,
    });
  }
  return g.__u1dPgPool;
}
