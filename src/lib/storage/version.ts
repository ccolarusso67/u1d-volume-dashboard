/**
 * src/lib/storage/version.ts
 *
 * PR 003B — Version resolver + orphan-file recovery.
 *
 * Two responsibilities:
 *   1. resolveNextVersion(): given a (year, month, sha256), figure out
 *      whether the same content already lives on disk from a prior
 *      failed upload (orphan reuse) — and if not, compute the next
 *      filesystem-safe version number that is strictly greater than
 *      both the DB and the on-disk maximum.
 *   2. findOrphanByHash(): standalone helper used by the resolver and
 *      surfaceable for direct admin/QA queries.
 *
 * Why DB AND filesystem? Because a previous upload may have written the
 * Excel to disk and then failed before committing the volume_files row.
 * The DB max would not reflect that ghost, but we still must not
 * overwrite or silently reuse it without a hash check (PR 003A storage
 * rule 7 / 11 — Orphan-file recovery in CLAUDE.md).
 */
import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import type { QueryResultRow } from "pg";
import { getStorageRoot, buildFileName, buildFilePath, buildBlobUrl } from "./paths";

type QueryOneFn = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
) => Promise<T | null>;

export type OrphanMatch = {
  versionNo: number;
  fileName: string;
  filePath: string;
};

export type ResolvedVersion = {
  versionNo: number;
  reuseExistingFile: boolean; // true → skip persistOriginal()
  fileName: string;
  filePath: string;
  blobUrl: string;
};

const VERSION_DIR_RE = /^v(\d+)$/;

/**
 * Scan the on-disk period directory for a file whose SHA-256 matches the
 * inbound hash. Returns the first match found (lowest version number).
 *
 * Fast path: the filename embeds the first 8 hex chars of the hash, so
 * we only re-hash files whose name prefix matches. False-positive risk
 * is negligible (~1 in 4 billion) and the hash verification removes it.
 */
export async function findOrphanByHash(
  year: number,
  month: number,
  inboundHash: string
): Promise<OrphanMatch | null> {
  const periodDir = path.join(
    getStorageRoot(),
    "u1d-volume-files",
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0")
  );

  let dirs: string[];
  try {
    dirs = await fs.readdir(periodDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  const prefix = inboundHash.slice(0, 8).toLowerCase();
  const sortedVersions = dirs
    .map((d) => {
      const m = d.match(VERSION_DIR_RE);
      return m ? { dir: d, n: parseInt(m[1], 10) } : null;
    })
    .filter((x): x is { dir: string; n: number } => x !== null)
    .sort((a, b) => a.n - b.n);

  for (const v of sortedVersions) {
    const vdir = path.join(periodDir, v.dir);
    let files: string[];
    try {
      files = await fs.readdir(vdir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    for (const f of files) {
      if (!f.includes(`__${prefix}.xlsx`)) continue;
      const fp = path.join(vdir, f);
      const buf = await fs.readFile(fp);
      const h = createHash("sha256").update(buf).digest("hex");
      if (h === inboundHash) {
        return { versionNo: v.n, fileName: f, filePath: fp };
      }
    }
  }
  return null;
}

/**
 * List the v{N} subdirectories under a period dir and return the highest
 * N observed (or 0 if none exist).
 */
async function highestFilesystemVersion(year: number, month: number): Promise<number> {
  const periodDir = path.join(
    getStorageRoot(),
    "u1d-volume-files",
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0")
  );
  let dirs: string[];
  try {
    dirs = await fs.readdir(periodDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
  let max = 0;
  for (const d of dirs) {
    const m = d.match(VERSION_DIR_RE);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

/**
 * Resolve the canonical next version for an inbound upload.
 *
 * Steps:
 *   1. Look for an orphan file (no DB row, but the exact hash exists on
 *      disk under some v{N}). If found, return that version with
 *      reuseExistingFile = true. The caller skips persistOriginal().
 *   2. Otherwise, take max(DB version, FS version) + 1.
 *
 * Note: the inbound hash duplicate-rejection check (DB hash uniqueness
 * → 409) happens BEFORE this function is called. So we are guaranteed
 * that no committed volume_files row exists with this hash.
 */
export async function resolveNextVersion(opts: {
  year: number;
  month: number;
  sha256: string;
  queryOne: QueryOneFn;
}): Promise<ResolvedVersion> {
  const { year, month, sha256, queryOne } = opts;

  // (1) Orphan reuse — short-circuits version allocation.
  const orphan = await findOrphanByHash(year, month, sha256);
  if (orphan) {
    return {
      versionNo: orphan.versionNo,
      reuseExistingFile: true,
      fileName: orphan.fileName,
      filePath: orphan.filePath,
      blobUrl: buildBlobUrl(year, month, orphan.versionNo, orphan.fileName),
    };
  }

  // (2) Compute next > max(DB, FS).
  const dbRow = await queryOne<{ max_version: number | null }>(
    `SELECT COALESCE(MAX(version_no), 0)::int AS max_version
       FROM u1d_ops.volume_files
      WHERE period_year = $1 AND period_month = $2`,
    [year, month]
  );
  const dbMax = dbRow?.max_version ?? 0;
  const fsMax = await highestFilesystemVersion(year, month);
  const versionNo = Math.max(dbMax, fsMax) + 1;

  const fileName = buildFileName(year, month, sha256);
  const filePath = buildFilePath(year, month, versionNo, fileName);
  const blobUrl = buildBlobUrl(year, month, versionNo, fileName);

  return {
    versionNo,
    reuseExistingFile: false,
    fileName,
    filePath,
    blobUrl,
  };
}
