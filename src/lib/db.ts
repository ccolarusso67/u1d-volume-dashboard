import { Pool, QueryResultRow } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __u1dPgPool: Pool | undefined;
}

function getPool(): Pool {
  if (!global.__u1dPgPool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    global.__u1dPgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      // Railway requires SSL in production
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : undefined,
    });
  }
  return global.__u1dPgPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const pool = getPool();
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
