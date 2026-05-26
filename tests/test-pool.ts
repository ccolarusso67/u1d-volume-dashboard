/**
 * tests/test-pool.ts
 *
 * Minimal in-memory pg.Pool / PoolClient stub for PR 003B upload tests.
 *
 * The stub records every query (so tests can assert what the route ran)
 * and dispatches responses via a pattern-matching router. Each test
 * configures the router with the fixture data it needs.
 *
 * We deliberately do NOT use pg-mem — the SQL we exercise is shaped by
 * hand-rolled string templates in process-upload.ts, and pattern matching
 * is more transparent for test failure diagnosis than a full SQL engine.
 */
import type { QueryResultRow } from "pg";

export type QueryCall = {
  text: string;
  params: unknown[] | undefined;
};

export type Responder = (text: string, params?: unknown[]) =>
  | { rows: QueryResultRow[]; rowCount?: number }
  | null;

export type TestPoolOptions = {
  /** Ordered list of responders. First one to return non-null wins. */
  responders: Responder[];
};

export class TestPool {
  public queries: QueryCall[] = [];
  public lastClientReleased = false;
  private responders: Responder[];

  constructor(opts: TestPoolOptions) {
    this.responders = opts.responders;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number }> {
    this.queries.push({ text, params });
    for (const r of this.responders) {
      const out = r(text, params);
      if (out) return { rows: out.rows as T[], rowCount: out.rowCount ?? out.rows.length };
    }
    throw new Error(
      `TestPool: no responder matched query:\n${text.slice(0, 240)}${text.length > 240 ? "…" : ""}`
    );
  }

  async connect() {
    const self = this;
    return {
      query: self.query.bind(self),
      release: () => {
        self.lastClientReleased = true;
      },
    };
  }

  /** Look up the first recorded query whose text contains the substring. */
  findQuery(substr: string): QueryCall | undefined {
    return this.queries.find((q) => q.text.includes(substr));
  }

  /** All queries whose text contains the substring. */
  findQueries(substr: string): QueryCall[] {
    return this.queries.filter((q) => q.text.includes(substr));
  }
}

/** Build a TestPool with sensible defaults for the upload happy path. */
export function makeHappyPoolDefaults(opts: {
  knownPackages?: string[];
  customerAliases?: Array<{ raw_label: string; customer_key: string }>;
  duplicateRow?: { file_id: number; period_year: number; period_month: number } | null;
  priorActive?: { file_id: number } | null;
  newFileId?: number;
  dbMaxVersion?: number;
}): Responder[] {
  const knownPackages = opts.knownPackages ?? [
    "LITER OIL","LITER COOL","GAL OIL","GAL COOL","GAL WW","JUG OIL","JUG COOL",
    "PAIL OIL","PAIL COOL","JERRYCAN OIL","JERRYCAN COOL","DRUM OIL","DRUM COOL",
    "TOTE OIL","TOTE COOL","TOTE WW","BOX OIL","BOX COOL","BOX WW",
    "BULK OIL","BULK COOL","DEF",
  ];
  const aliases = opts.customerAliases ?? [
    { raw_label: "ULTRACHEM", customer_key: "ULTRACHEM" },
    { raw_label: "LUBRIMAR", customer_key: "LUBRIMAR" },
    { raw_label: "SUN COAST RESOURCES", customer_key: "SUN COAST RESOURCES" },
    { raw_label: "SUNCOAST", customer_key: "SUN COAST RESOURCES" },
    { raw_label: "KEY PERFORMANCE", customer_key: "KEY PERFORMANCE" },
    { raw_label: "KEYPERFOR", customer_key: "KEY PERFORMANCE" },
    { raw_label: "TERRA DISTRIBUTORS", customer_key: "TERRA DISTRIBUTORS" },
    { raw_label: "TERRA", customer_key: "TERRA DISTRIBUTORS" },
  ];
  const newFileId = opts.newFileId ?? 1001;
  const dbMaxVersion = opts.dbMaxVersion ?? 0;
  const priorActive = opts.priorActive ?? null;
  const dup = opts.duplicateRow ?? null;

  return [
    // SELECT package_key FROM u1d_ops.packages
    (t) => (t.includes("FROM u1d_ops.packages") && !t.includes("packages_") 
      ? { rows: knownPackages.map((k) => ({ package_key: k })) } : null),
    // SELECT raw_label, customer_key FROM u1d_ops.customer_aliases
    (t) => (t.includes("FROM u1d_ops.customer_aliases")
      ? { rows: aliases } : null),
    // duplicate hash check
    (t) => (t.includes("FROM u1d_ops.volume_files\n      WHERE file_hash")
      ? { rows: dup ? [dup] : [] } : null),
    // SELECT MAX(version_no) for resolveNextVersion
    (t) => (t.includes("COALESCE(MAX(version_no)")
      ? { rows: [{ max_version: dbMaxVersion }] } : null),
    // BEGIN / COMMIT / ROLLBACK
    (t) => (/^(BEGIN|COMMIT|ROLLBACK)/.test(t.trim()) ? { rows: [] } : null),
    // SELECT current active FOR UPDATE
    (t) => (t.includes("AND is_active = TRUE\n        FOR UPDATE")
      ? { rows: priorActive ? [priorActive] : [] } : null),
    // INSERT volume_files RETURNING file_id
    (t) => (t.includes("INSERT INTO u1d_ops.volume_files") && t.includes("RETURNING file_id")
      ? { rows: [{ file_id: newFileId }] } : null),
    // INSERT volume_fact
    (t) => (t.includes("INSERT INTO u1d_ops.volume_fact") ? { rows: [] } : null),
    // INSERT alerts (3 tables)
    (t) => (t.includes("INSERT INTO u1d_ops.package_alerts") ? { rows: [] } : null),
    (t) => (t.includes("INSERT INTO u1d_ops.customer_alerts") ? { rows: [] } : null),
    (t) => (t.includes("INSERT INTO u1d_ops.data_quality_alerts") ? { rows: [] } : null),
    // UPDATE prior file (supersede)
    (t) => (t.includes("UPDATE u1d_ops.volume_files\n            SET is_active = FALSE,")
      ? { rows: [] } : null),
    // UPDATE new file (activate)
    (t) => (t.includes("UPDATE u1d_ops.volume_files\n          SET is_active = TRUE,")
      ? { rows: [] } : null),
    // UPSERT board_periods
    (t) => (t.includes("INSERT INTO u1d_ops.board_periods") ? { rows: [] } : null),
    // refresh_views
    (t) => (t.includes("SELECT u1d_ops.refresh_views()") ? { rows: [] } : null),
  ];
}
