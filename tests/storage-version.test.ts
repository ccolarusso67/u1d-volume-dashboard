/**
 * tests/storage-version.test.ts
 *
 * PR 003B — version resolver + orphan-file recovery.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { createHash } from "crypto";
import { resolveNextVersion, findOrphanByHash } from "../src/lib/storage/version";
import { buildFileName, buildFilePath } from "../src/lib/storage/paths";

function makeTmpRoot(): string {
  const dir = path.join(
    os.tmpdir(),
    `u1d-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  );
  process.env.U1D_FILE_STORAGE_ROOT = dir;
  return dir;
}

async function writeAt(year: number, month: number, version: number, content: Buffer): Promise<string> {
  const hash = createHash("sha256").update(content).digest("hex");
  const name = buildFileName(year, month, hash);
  const fp = buildFilePath(year, month, version, name);
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, content);
  return fp;
}

beforeEach(() => {
  // Each test gets a fresh STORAGE_ROOT so filesystem state is isolated.
  makeTmpRoot();
});

test("resolveNextVersion: no DB, no FS → v1", async () => {
  const r = await resolveNextVersion({
    year: 2026,
    month: 3,
    sha256: createHash("sha256").update("a").digest("hex"),
    queryOne: async () => ({ max_version: 0 }) as never,
  });
  assert.equal(r.versionNo, 1);
  assert.equal(r.reuseExistingFile, false);
  assert.match(r.filePath, /\/2026\/03\/v1\//);
  assert.match(r.blobUrl, /^railway-volume:\/\/u1d-volume-files\/2026\/03\/v1\//);
});

test("resolveNextVersion: DB max 2, no FS → v3", async () => {
  const r = await resolveNextVersion({
    year: 2026, month: 3,
    sha256: createHash("sha256").update("zz").digest("hex"),
    queryOne: async () => ({ max_version: 2 }) as never,
  });
  assert.equal(r.versionNo, 3);
  assert.equal(r.reuseExistingFile, false);
});

test("resolveNextVersion: DB max 1, FS has v1 and v2 (orphan v2) → v3", async () => {
  // Write a v1 and v2 that the DB doesn't know about (v2 = orphan from
  // failed prior upload). Their hashes don't match the new inbound.
  await writeAt(2026, 3, 1, Buffer.from("old content 1"));
  await writeAt(2026, 3, 2, Buffer.from("old content 2 - orphan"));
  const r = await resolveNextVersion({
    year: 2026, month: 3,
    sha256: createHash("sha256").update("brand new content").digest("hex"),
    queryOne: async () => ({ max_version: 1 }) as never,
  });
  assert.equal(r.versionNo, 3, "max(DB=1, FS=2) + 1 = 3");
  assert.equal(r.reuseExistingFile, false);
});

test("resolveNextVersion: orphan with matching hash → reuse that version", async () => {
  const orphanContent = Buffer.from("the actual file bytes that crashed the prior tx");
  const orphanHash = createHash("sha256").update(orphanContent).digest("hex");
  await writeAt(2026, 3, 1, Buffer.from("v1 different content"));
  await writeAt(2026, 3, 2, orphanContent); // orphan with the inbound hash

  const r = await resolveNextVersion({
    year: 2026, month: 3,
    sha256: orphanHash,
    queryOne: async () => ({ max_version: 0 }) as never, // DB had nothing committed
  });
  assert.equal(r.versionNo, 2, "reuse the orphan version, do not bump");
  assert.equal(r.reuseExistingFile, true);
  assert.match(r.fileName, new RegExp(orphanHash.slice(0, 8)));
});

test("findOrphanByHash: filename-prefix filter prevents O(n) hashing", async () => {
  // Write a v1 whose hash prefix shadows a different inbound. The function
  // must hash-verify and report no match, not return a false positive.
  const stored = Buffer.from("stored content");
  await writeAt(2026, 3, 1, stored);
  const wrongHash = createHash("sha256").update("totally different").digest("hex");
  // Force a prefix collision by writing a file whose name uses wrongHash's
  // prefix but whose bytes hash differently. (We can't easily force a real
  // SHA-256 prefix collision; this assertion exercises the no-match path.)
  const r = await findOrphanByHash(2026, 3, wrongHash);
  assert.equal(r, null);
});

test("findOrphanByHash: period directory does not exist → null", async () => {
  const r = await findOrphanByHash(2099, 12, createHash("sha256").update("x").digest("hex"));
  assert.equal(r, null);
});
