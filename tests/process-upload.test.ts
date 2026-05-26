/**
 * tests/process-upload.test.ts
 *
 * PR 003B — end-to-end upload pipeline tests.
 *
 * Strategy:
 *   - Synthetic .xlsx fixtures via tests/fixtures.ts (no real client data).
 *   - TestPool (tests/test-pool.ts) stubs pg.Pool + PoolClient with a
 *     pattern-matching responder list.
 *   - STORAGE_ROOT is set to a fresh tmpdir per test so disk state is
 *     isolated.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { createHash } from "crypto";

import { buildSyntheticVolumeXlsx } from "./fixtures";
import { TestPool, makeHappyPoolDefaults } from "./test-pool";
import { processUpload } from "../src/lib/upload/process-upload";
import { DuplicateHashError } from "../src/lib/upload/errors";

function tmpStorageRoot(): string {
  const dir = path.join(
    os.tmpdir(),
    `u1d-proc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  );
  process.env.U1D_FILE_STORAGE_ROOT = dir;
  return dir;
}

beforeEach(() => {
  tmpStorageRoot();
});

test("admin upload happy path → returns UploadResult with status 'in_review'", async () => {
  const buf = await buildSyntheticVolumeXlsx({
    customers: [
      { label: "ULTRACHEM", values: { "DRUM OIL": 1000, "BOX OIL": 500 } },
      { label: "SUN COAST RESOURCES", values: { "DRUM OIL": 4752 } },
    ],
  });
  const pool = new TestPool({ responders: makeHappyPoolDefaults({ newFileId: 7777 }) });

  const result = await processUpload(
    { buffer: buf, filename: "U1DYNAMICS_VOLUME_2026_03.xlsx", uploadedBy: "admin@ultra1plus.com" },
    { pool: pool as unknown as import("pg").Pool }
  );

  assert.equal(result.status, "in_review");
  assert.equal(result.file_id, 7777);
  assert.equal(result.period.year, 2026);
  assert.equal(result.period.month, 3);
  assert.equal(result.version_no, 1);
  assert.equal(result.total_gallons, 1000 + 500 + 4752);
  assert.equal(result.package_alert_count, 0);
  assert.equal(result.customer_alert_count, 0);
  assert.equal(result.data_quality_alert_count, 0);
  assert.equal(result.reused_existing_file, false);
  assert.match(result.file_hash, /^[0-9a-f]{64}$/);

  // Verify the transaction order was honoured.
  const begin = pool.queries.findIndex((q) => /^BEGIN/.test(q.text.trim()));
  const commit = pool.queries.findIndex((q) => /^COMMIT/.test(q.text.trim()));
  const insertFile = pool.queries.findIndex((q) =>
    q.text.includes("INSERT INTO u1d_ops.volume_files") && q.text.includes("RETURNING file_id")
  );
  const upsertBoard = pool.queries.findIndex((q) =>
    q.text.includes("INSERT INTO u1d_ops.board_periods")
  );
  const refresh = pool.queries.findIndex((q) =>
    q.text.includes("SELECT u1d_ops.refresh_views()")
  );
  assert.ok(begin < insertFile, "INSERT volume_files inside transaction");
  assert.ok(insertFile < upsertBoard, "board_periods upsert after INSERT volume_files");
  assert.ok(upsertBoard < commit, "board_periods upsert before COMMIT");
  assert.ok(commit < refresh, "refresh_views AFTER commit (spec step 20)");

  // INSERT was made with is_active=FALSE first (correction 3 / partial unique safety).
  const fileInsert = pool.queries.find((q) =>
    q.text.includes("INSERT INTO u1d_ops.volume_files") && q.text.includes("RETURNING file_id")
  );
  assert.ok(fileInsert?.text.includes("FALSE, FALSE"), "INSERT new row with is_active=FALSE, is_superseded=FALSE");
  const updateActivate = pool.queries.find((q) =>
    q.text.includes("UPDATE u1d_ops.volume_files\n          SET is_active = TRUE,")
  );
  assert.ok(updateActivate, "UPDATE step toggles is_active=TRUE after INSERT");
});

test("duplicate hash → DuplicateHashError thrown (409)", async () => {
  const buf = await buildSyntheticVolumeXlsx({
    customers: [{ label: "ULTRACHEM", values: { "DRUM OIL": 1000 } }],
  });
  const dupRow = { file_id: 42, period_year: 2026, period_month: 3 };
  const pool = new TestPool({ responders: makeHappyPoolDefaults({ duplicateRow: dupRow }) });

  await assert.rejects(
    () => processUpload(
      { buffer: buf, filename: "x.xlsx", uploadedBy: "admin@x" },
      { pool: pool as unknown as import("pg").Pool }
    ),
    (err: unknown) => {
      assert.ok(err instanceof DuplicateHashError, "must throw DuplicateHashError");
      assert.equal((err as DuplicateHashError).status, 409);
      assert.equal((err as DuplicateHashError).existingFileId, 42);
      return true;
    }
  );

  // No transaction should have started.
  assert.equal(pool.findQuery("BEGIN"), undefined, "no BEGIN on duplicate");
  assert.equal(pool.findQuery("INSERT INTO u1d_ops.volume_files"), undefined);
});

test("unknown package surfaces a package_alerts row", async () => {
  // Restrict known packages so BOX OIL is unknown for this test.
  const restrictedPackages = [
    "LITER OIL","LITER COOL","GAL OIL","GAL COOL","GAL WW","JUG OIL","JUG COOL",
    "PAIL OIL","PAIL COOL","JERRYCAN OIL","JERRYCAN COOL","DRUM OIL","DRUM COOL",
    "TOTE OIL","TOTE COOL","TOTE WW",/*"BOX OIL" omitted,*/
    "BOX COOL","BOX WW","BULK OIL","BULK COOL","DEF",
  ];
  const buf = await buildSyntheticVolumeXlsx({
    customers: [{ label: "ULTRACHEM", values: { "BOX OIL": 2500, "DRUM OIL": 1000 } }],
  });
  const pool = new TestPool({
    responders: makeHappyPoolDefaults({ knownPackages: restrictedPackages, newFileId: 8001 }),
  });

  const result = await processUpload(
    { buffer: buf, filename: "x.xlsx", uploadedBy: "admin@x" },
    { pool: pool as unknown as import("pg").Pool }
  );
  assert.equal(result.package_alert_count, 1);

  const inserts = pool.findQueries("INSERT INTO u1d_ops.package_alerts");
  assert.equal(inserts.length, 1);
  // params: [fileId, raw_label, gallons, notes]
  assert.equal(inserts[0].params?.[1], "BOX OIL");
  assert.equal(inserts[0].params?.[2], 2500);
});

test("unknown customer surfaces a customer_alerts row", async () => {
  const buf = await buildSyntheticVolumeXlsx({
    customers: [
      { label: "ULTRACHEM", values: { "DRUM OIL": 1000 } },
      { label: "NEW DISTRIBUTOR XYZ", values: { "DRUM OIL": 500 } },
    ],
  });
  const pool = new TestPool({ responders: makeHappyPoolDefaults({ newFileId: 8002 }) });

  const result = await processUpload(
    { buffer: buf, filename: "x.xlsx", uploadedBy: "admin@x" },
    { pool: pool as unknown as import("pg").Pool }
  );
  assert.equal(result.customer_alert_count, 1);

  const inserts = pool.findQueries("INSERT INTO u1d_ops.customer_alerts");
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].params?.[1], "NEW DISTRIBUTOR XYZ");
});

test("total discrepancy surfaces a data_quality_alerts row", async () => {
  // Force a discrepancy by adding an unknown customer (excluded from sum
  // but counted in the synthetic TOTAL row).
  const buf = await buildSyntheticVolumeXlsx({
    customers: [
      { label: "ULTRACHEM", values: { "DRUM OIL": 1000 } },
      { label: "MYSTERY", values: { "DRUM OIL": 450 } },
    ],
  });
  const pool = new TestPool({ responders: makeHappyPoolDefaults({ newFileId: 8003 }) });

  const result = await processUpload(
    { buffer: buf, filename: "x.xlsx", uploadedBy: "admin@x" },
    { pool: pool as unknown as import("pg").Pool }
  );
  assert.equal(result.has_total_discrepancy, true);
  assert.equal(result.data_quality_alert_count, 1);

  const inserts = pool.findQueries("INSERT INTO u1d_ops.data_quality_alerts");
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].params?.[1], "total_row_discrepancy");
});

test("prior active version is superseded by new upload", async () => {
  const buf = await buildSyntheticVolumeXlsx({
    customers: [{ label: "ULTRACHEM", values: { "DRUM OIL": 2000 } }],
  });
  const pool = new TestPool({
    responders: makeHappyPoolDefaults({
      priorActive: { file_id: 999 },
      newFileId: 1000,
      dbMaxVersion: 1,
    }),
  });

  const result = await processUpload(
    { buffer: buf, filename: "U1DYNAMICS_VOLUME_2026_03_v2.xlsx", uploadedBy: "admin@x" },
    { pool: pool as unknown as import("pg").Pool }
  );

  assert.equal(result.version_no, 2, "version bumped past prior (dbMax=1)");
  assert.equal(result.file_id, 1000);

  // Verify the UPDATE-prior step ran with the right params: superseded_by = new_file_id, target = prior id.
  const supersede = pool.queries.find((q) =>
    q.text.includes("UPDATE u1d_ops.volume_files\n            SET is_active = FALSE,")
  );
  assert.ok(supersede, "supersede UPDATE must have run");
  assert.equal(supersede!.params?.[0], 1000, "superseded_by_file_id = new_file_id");
  assert.equal(supersede!.params?.[1], 999, "target = prior active file_id");
});

test("orphan file recovery: same hash on disk with no DB row → reuse version, do not re-persist", async () => {
  const buf = await buildSyntheticVolumeXlsx({
    customers: [{ label: "ULTRACHEM", values: { "DRUM OIL": 7777 } }],
  });
  const sha = createHash("sha256").update(buf).digest("hex");

  // Pre-write an orphan at v3 with the exact bytes the upload will send.
  const { buildFileName, buildFilePath } = await import("../src/lib/storage/paths");
  const orphanName = buildFileName(2026, 3, sha);
  const orphanPath = buildFilePath(2026, 3, 3, orphanName);
  await fs.mkdir(path.dirname(orphanPath), { recursive: true });
  await fs.writeFile(orphanPath, buf);
  const sizeBefore = (await fs.stat(orphanPath)).size;

  // Track persist calls — they must NOT happen on orphan reuse.
  let persistCalls = 0;

  const pool = new TestPool({
    responders: makeHappyPoolDefaults({
      newFileId: 5050,
      dbMaxVersion: 2, // DB has v1 and v2; v3 is orphan
    }),
  });

  const result = await processUpload(
    { buffer: buf, filename: "x.xlsx", uploadedBy: "admin@x" },
    {
      pool: pool as unknown as import("pg").Pool,
      persist: async () => {
        persistCalls++;
        throw new Error("persist must not run on orphan reuse");
      },
    }
  );

  assert.equal(result.version_no, 3, "reuse the orphan v3, not v4");
  assert.equal(result.reused_existing_file, true);
  assert.equal(persistCalls, 0, "persist was correctly skipped");
  const sizeAfter = (await fs.stat(orphanPath)).size;
  assert.equal(sizeAfter, sizeBefore, "orphan file content unchanged");
});

test("empty buffer → InvalidUploadError (rejected before DB)", async () => {
  const pool = new TestPool({ responders: makeHappyPoolDefaults({}) });
  await assert.rejects(
    () => processUpload(
      { buffer: Buffer.alloc(0), filename: "x.xlsx", uploadedBy: "admin@x" },
      { pool: pool as unknown as import("pg").Pool }
    ),
    /Uploaded file is empty/
  );
  assert.equal(pool.queries.length, 0, "no DB queries on bad input");
});

test("missing uploadedBy → InvalidUploadError", async () => {
  const pool = new TestPool({ responders: makeHappyPoolDefaults({}) });
  const buf = await buildSyntheticVolumeXlsx({
    customers: [{ label: "ULTRACHEM", values: { "DRUM OIL": 1000 } }],
  });
  await assert.rejects(
    () => processUpload(
      { buffer: buf, filename: "x.xlsx", uploadedBy: "" },
      { pool: pool as unknown as import("pg").Pool }
    ),
    /uploadedBy is required/
  );
});
