/**
 * src/lib/upload/process-upload.ts
 *
 * PR 003B — End-to-end upload pipeline.
 *
 * Pure business logic with dependency injection so unit tests can run
 * against a stub pg.Pool and a tmpdir storage root. The HTTP route handler
 * (src/app/api/admin/upload/route.ts) is a thin shell that:
 *   - resolves the admin session (requireAdminSession)
 *   - extracts the multipart file
 *   - calls processUpload() with default deps
 *   - maps thrown errors to HTTP status codes
 *
 * Transaction ordering follows PR 001 Correction 3 exactly. The supersede
 * dance (insert new with is_active=FALSE first, then update prior, then
 * activate new) is what keeps the partial unique index on (period_year,
 * period_month) WHERE is_active=TRUE happy throughout the transaction.
 */
import { createHash } from "crypto";
import type { Pool, PoolClient } from "pg";
import {
  parseVolumeFile,
  type ParsedVolumeFile,
  type ParseOptions,
} from "../parser/volume-parser";
import { persistOriginal } from "../storage/write-file";
import { resolveNextVersion, type ResolvedVersion } from "../storage/version";
import {
  DuplicateHashError,
  InvalidUploadError,
  ParseUploadError,
} from "./errors";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type UploadDeps = {
  /** pg.Pool instance. Tests inject a stub. */
  pool: Pool;
  /** Override the parser for tests. Defaults to parseVolumeFile. */
  parse?: (buffer: Buffer, options?: ParseOptions) => Promise<ParsedVolumeFile>;
  /** Override the storage persist call for tests. Defaults to persistOriginal. */
  persist?: typeof persistOriginal;
  /** Override version resolution for tests. */
  resolveVersion?: typeof resolveNextVersion;
};

export type UploadInput = {
  /** Raw bytes from the multipart upload. */
  buffer: Buffer;
  /** Original filename from the multipart form (for audit). */
  filename: string;
  /** Email of the admin uploading (from session.user.email). */
  uploadedBy: string;
};

export type UploadResult = {
  file_id: number;
  period: { year: number; month: number };
  version_no: number;
  file_hash: string;
  filename: string;
  total_gallons: number;
  source_total_gallons: number | null;
  reconstructed_total_gallons: number;
  has_total_discrepancy: boolean;
  package_alert_count: number;
  customer_alert_count: number;
  data_quality_alert_count: number;
  status: "in_review";
  reused_existing_file: boolean;
};

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function processUpload(
  input: UploadInput,
  deps: UploadDeps
): Promise<UploadResult> {
  if (!input.buffer || input.buffer.byteLength === 0) {
    throw new InvalidUploadError("empty_buffer", "Uploaded file is empty");
  }
  if (!input.uploadedBy) {
    throw new InvalidUploadError(
      "no_uploader",
      "uploadedBy is required (session.user.email)"
    );
  }

  const parse = deps.parse ?? parseVolumeFile;
  const persist = deps.persist ?? persistOriginal;
  const resolveVersion = deps.resolveVersion ?? resolveNextVersion;

  // ---------------------------------------------------------------------
  // Step 1-3: hash, reject duplicate, parse.
  // ---------------------------------------------------------------------

  const fileHash = createHash("sha256").update(input.buffer).digest("hex");

  // Cheap check before doing the expensive parse: did we already ingest
  // this exact bytes? Storage rule 3. The DB partial unique index on
  // file_hash will also catch this at commit time but failing fast saves
  // an Excel parse and an IO round-trip.
  const dup = await queryOneSimple<{ file_id: number; period_year: number; period_month: number }>(
    deps.pool,
    `SELECT file_id, period_year, period_month
       FROM u1d_ops.volume_files
      WHERE file_hash = $1
      LIMIT 1`,
    [fileHash]
  );
  if (dup) {
    throw new DuplicateHashError({
      fileHash,
      existingFileId: dup.file_id,
      period: { year: dup.period_year, month: dup.period_month },
    });
  }

  // ---------------------------------------------------------------------
  // Step 4-6: load DB catalogs (packages + aliases) and parse the file.
  // ---------------------------------------------------------------------

  const [knownPackages, customerAliases] = await Promise.all([
    loadKnownPackages(deps.pool),
    loadCustomerAliases(deps.pool),
  ]);

  let parsed: ParsedVolumeFile;
  try {
    parsed = await parse(input.buffer, { knownPackages, customerAliases });
  } catch (err) {
    throw new ParseUploadError(
      err instanceof Error ? err.message : "Parse failed",
      err
    );
  }

  // Defense in depth: parser is supposed to compute the same hash; if it
  // disagrees, something is very wrong (different buffer, encoding bug).
  if (parsed.file_hash !== fileHash) {
    throw new ParseUploadError(
      `Hash mismatch: route computed ${fileHash} but parser computed ${parsed.file_hash}`
    );
  }

  // ---------------------------------------------------------------------
  // Step 7-9: resolve next version (DB + FS + orphan), persist file.
  // ---------------------------------------------------------------------

  const versionPlan: ResolvedVersion = await resolveVersion({
    year: parsed.period.year,
    month: parsed.period.month,
    sha256: fileHash,
    queryOne: makeQueryOne(deps.pool),
  });

  if (!versionPlan.reuseExistingFile) {
    await persist(
      input.buffer,
      parsed.period.year,
      parsed.period.month,
      versionPlan.versionNo,
      fileHash
    );
  }

  // ---------------------------------------------------------------------
  // Step 10-19: transaction (PR 001 Correction 3 ordering).
  // ---------------------------------------------------------------------

  const client = await deps.pool.connect();
  let newFileId: number;
  let priorActiveFileId: number | null = null;
  let packageAlertCount = 0;
  let customerAlertCount = 0;
  let dataQualityAlertCount = 0;

  try {
    await client.query("BEGIN");

    // (1) SELECT current active FOR UPDATE — serializes concurrent uploads
    // for the same period; whichever request locks the row first wins
    // and the loser sees the updated state when it retries.
    const activeRow = await client.query<{ file_id: number }>(
      `SELECT file_id
         FROM u1d_ops.volume_files
        WHERE period_year = $1 AND period_month = $2 AND is_active = TRUE
        FOR UPDATE`,
      [parsed.period.year, parsed.period.month]
    );
    if (activeRow.rows.length > 0) {
      priorActiveFileId = activeRow.rows[0].file_id;
    }

    // (3) INSERT the new file row in inactive state. Activation happens
    // in step (8) after the prior file (if any) is deactivated, so the
    // partial unique index on (year, month) WHERE is_active=TRUE never
    // sees two active rows.
    const insertedFile = await client.query<{ file_id: number }>(
      `INSERT INTO u1d_ops.volume_files
         (filename, file_hash, period_year, period_month,
          source_total_row, computed_customer_sum,
          has_total_discrepancy, discrepancy_amount,
          version_no, is_active, is_superseded,
          original_file_path, original_blob_url, storage_provider,
          uploaded_by, uploaded_at, ingested_by, ingested_at, notes)
       VALUES ($1, $2, $3, $4,
               $5, $6,
               $7, $8,
               $9, FALSE, FALSE,
               $10, $11, $12,
               $13, NOW(), $13, NOW(), $14)
       RETURNING file_id`,
      [
        input.filename,
        fileHash,
        parsed.period.year,
        parsed.period.month,
        parsed.source_total_row,
        parsed.computed_customer_sum,
        parsed.has_total_discrepancy,
        parsed.discrepancy_amount,
        versionPlan.versionNo,
        versionPlan.filePath,
        versionPlan.blobUrl,
        "railway-volume",
        input.uploadedBy,
        `PR-1.7 upload via /api/admin/upload (period source: ${parsed.period.source}${versionPlan.reuseExistingFile ? "; reused orphan v" + versionPlan.versionNo : ""})`,
      ]
    );
    newFileId = insertedFile.rows[0].file_id;

    // (5) INSERT volume_fact rows. Each fact row carries file_id (new
    // authority per PR 001 Correction 1) so prior versions remain
    // queryable without conflict.
    for (const r of parsed.rows) {
      await client.query(
        `INSERT INTO u1d_ops.volume_fact
           (file_id, period_year, period_month, customer_key, package_key, gallons)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          newFileId,
          parsed.period.year,
          parsed.period.month,
          r.customer_key,
          r.package_key,
          r.gallons,
        ]
      );
    }

    // (6) INSERT alerts. Deduplicate by raw_label (a label that appears in
    // both SUMMARY and CUSTOMER_DETAIL becomes one row whose `notes` lists
    // both sources). Gallons are summed across sources for visibility.
    packageAlertCount = await insertPackageAlerts(client, newFileId, parsed.warnings.unknownPackages);
    customerAlertCount = await insertCustomerAlerts(client, newFileId, parsed.warnings.unknownCustomers);
    if (parsed.has_total_discrepancy) {
      dataQualityAlertCount = 1;
      await client.query(
        `INSERT INTO u1d_ops.data_quality_alerts
           (file_id, alert_kind, severity, message, payload)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          newFileId,
          "total_row_discrepancy",
          "warn",
          `Source TOTAL row (${parsed.source_total_row ?? "null"}) differs from reconstructed customer sum (${parsed.computed_customer_sum}) by ${parsed.discrepancy_amount ?? "?"} gal`,
          JSON.stringify({
            source_total_row: parsed.source_total_row,
            computed_customer_sum: parsed.computed_customer_sum,
            discrepancy_amount: parsed.discrepancy_amount,
          }),
        ]
      );
    }

    // (7) Mark the prior active row as superseded — IF one existed.
    if (priorActiveFileId !== null) {
      await client.query(
        `UPDATE u1d_ops.volume_files
            SET is_active = FALSE,
                is_superseded = TRUE,
                superseded_by_file_id = $1
          WHERE file_id = $2`,
        [newFileId, priorActiveFileId]
      );
    }

    // (8) Activate the new row + record staging timestamp.
    await client.query(
      `UPDATE u1d_ops.volume_files
          SET is_active = TRUE,
              staged_at = NOW()
        WHERE file_id = $1`,
      [newFileId]
    );

    // (9) UPSERT board_periods: move status to 'in_review' and point
    // active_file_id at the new file.
    await client.query(
      `INSERT INTO u1d_ops.board_periods
         (period_year, period_month, status, active_file_id)
       VALUES ($1, $2, 'in_review', $3)
       ON CONFLICT (period_year, period_month) DO UPDATE
         SET status = 'in_review',
             active_file_id = EXCLUDED.active_file_id,
             updated_at = NOW()`,
      [parsed.period.year, parsed.period.month, newFileId]
    );

    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore — original error is the meaningful one
    }
    throw err;
  } finally {
    client.release();
  }

  // ---------------------------------------------------------------------
  // Step 20: refresh MVs AFTER commit. A failure here is logged but does
  // not undo the upload — the materialized views can be refreshed manually
  // and the data is already correct in the base tables.
  // ---------------------------------------------------------------------

  try {
    await deps.pool.query(`SELECT u1d_ops.refresh_views()`);
  } catch (err) {
    console.error("[upload] refresh_views failed after commit:", err);
  }

  return {
    file_id: newFileId,
    period: { year: parsed.period.year, month: parsed.period.month },
    version_no: versionPlan.versionNo,
    file_hash: fileHash,
    filename: input.filename,
    total_gallons: parsed.computed_customer_sum,
    source_total_gallons: parsed.source_total_row,
    reconstructed_total_gallons: parsed.computed_customer_sum,
    has_total_discrepancy: parsed.has_total_discrepancy,
    package_alert_count: packageAlertCount,
    customer_alert_count: customerAlertCount,
    data_quality_alert_count: dataQualityAlertCount,
    status: "in_review",
    reused_existing_file: versionPlan.reuseExistingFile,
  };
}

// ---------------------------------------------------------------------------
// Helpers — small enough to live inline; tests reach them via processUpload.
// ---------------------------------------------------------------------------

async function loadKnownPackages(pool: Pool): Promise<Set<string>> {
  const r = await pool.query<{ package_key: string }>(
    `SELECT package_key FROM u1d_ops.packages`
  );
  return new Set(r.rows.map((row) => row.package_key.toUpperCase()));
}

async function loadCustomerAliases(pool: Pool): Promise<Map<string, string>> {
  const r = await pool.query<{ raw_label: string; customer_key: string }>(
    `SELECT raw_label, customer_key FROM u1d_ops.customer_aliases`
  );
  // raw_label is UPPER by CHECK constraint, but normalize defensively.
  const m = new Map<string, string>();
  for (const row of r.rows) {
    m.set(row.raw_label.toUpperCase(), row.customer_key);
  }
  return m;
}

async function insertPackageAlerts(
  client: PoolClient,
  fileId: number,
  unknowns: ParsedVolumeFile["warnings"]["unknownPackages"]
): Promise<number> {
  if (unknowns.length === 0) return 0;
  type Dedup = { gallons: number; sources: Set<string> };
  const dedup = new Map<string, Dedup>();
  for (const u of unknowns) {
    const cur = dedup.get(u.raw_label) ?? { gallons: 0, sources: new Set() };
    cur.gallons += u.gallons_observed;
    cur.sources.add(u.source);
    dedup.set(u.raw_label, cur);
  }
  for (const [raw_label, agg] of dedup) {
    await client.query(
      `INSERT INTO u1d_ops.package_alerts
         (file_id, raw_label, gallons_observed, status, notes)
       VALUES ($1, $2, $3, 'pending', $4)`,
      [
        fileId,
        raw_label,
        agg.gallons,
        `detected_in=${[...agg.sources].join(",")}`,
      ]
    );
  }
  return dedup.size;
}

async function insertCustomerAlerts(
  client: PoolClient,
  fileId: number,
  unknowns: ParsedVolumeFile["warnings"]["unknownCustomers"]
): Promise<number> {
  if (unknowns.length === 0) return 0;
  const dedup = new Map<string, number>();
  for (const u of unknowns) {
    dedup.set(u.raw_label, (dedup.get(u.raw_label) ?? 0) + u.gallons_observed);
  }
  for (const [raw_label, gallons] of dedup) {
    await client.query(
      `INSERT INTO u1d_ops.customer_alerts
         (file_id, raw_label, gallons_observed, status, notes)
       VALUES ($1, $2, $3, 'pending', $4)`,
      [fileId, raw_label, gallons, "detected_in=SUMMARY"]
    );
  }
  return dedup.size;
}

function makeQueryOne(pool: Pool) {
  return async function queryOne<T>(text: string, params?: unknown[]): Promise<T | null> {
    const r = await pool.query<T extends Record<string, unknown> ? T : never>(text, params as unknown[]);
    return (r.rows[0] as T | undefined) ?? null;
  };
}

async function queryOneSimple<T>(pool: Pool, text: string, params: unknown[]): Promise<T | null> {
  const r = await pool.query(text, params);
  return (r.rows[0] as T | undefined) ?? null;
}
