/**
 * src/lib/storage/write-file.ts
 *
 * Persist an uploaded original Excel to the Railway Volume.
 *
 * Phase 1.7 storage contract (CORRECTION 4 — exclusive write):
 *   - Rule 1: write the original BEFORE the parser finalizes and the DB
 *     transaction commits.
 *   - Rule 2: SHA-256 is computed by the caller and passed in, so the
 *     filename and the DB row reference the same hash.
 *   - Rule 7: never silently overwrite. fs.writeFile(..., { flag: "wx" })
 *     fails with EEXIST if the target path already exists.
 */
import { promises as fs } from "fs";
import path from "path";
import {
  buildFileName,
  buildFilePath,
  buildBlobUrl,
} from "./paths";
import { ensureStorageRoot } from "./ensure-root";

export type PersistedOriginal = {
  /** File name on disk (matches the DB volume_files row). */
  fileName: string;
  /** Absolute path on the storage volume. */
  filePath: string;
  /** Internal `railway-volume://...` URL persisted in volume_files.original_blob_url. */
  blobUrl: string;
  /** Bytes flushed to disk. */
  bytesWritten: number;
};

/**
 * Persist the original uploaded Excel to the Railway Volume.
 *
 * Callers must:
 *   - Pre-compute the SHA-256 of `buffer` (rule 2).
 *   - Pre-check for duplicate hashes against u1d_ops.volume_files (rule 3).
 *   - Resolve the next versionNo BEFORE calling, ideally inside the same
 *     DB transaction that will INSERT the volume_files row (rule 4).
 *
 * On success, the file is on disk and the caller proceeds with the
 * INSERT volume_files / INSERT volume_fact transaction (CORRECTION 3,
 * steps 3-10).
 *
 * On EEXIST: a file with this exact path already exists in the volume.
 * That indicates either (a) a duplicate hash that the caller failed to
 * pre-check, or (b) a stale upload from an aborted transaction. Caller
 * should abort and surface the collision rather than retry blindly —
 * rule 7 forbids silent overwrites.
 *
 * On EACCES / EROFS: storage permissions issue. The startup check in
 * ensureStorageRoot() should have caught this; if not, fix the mount.
 */
export async function persistOriginal(
  buffer: Buffer,
  year: number,
  month: number,
  versionNo: number,
  sha256: string
): Promise<PersistedOriginal> {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new Error(`persistOriginal: invalid year ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`persistOriginal: invalid month ${month}`);
  }
  if (!Number.isInteger(versionNo) || versionNo < 1) {
    throw new Error(`persistOriginal: invalid versionNo ${versionNo}`);
  }
  if (!buffer || buffer.byteLength === 0) {
    throw new Error("persistOriginal: refusing to write an empty buffer");
  }

  await ensureStorageRoot();

  const fileName = buildFileName(year, month, sha256);
  const filePath = buildFilePath(year, month, versionNo, fileName);
  const blobUrl = buildBlobUrl(year, month, versionNo, fileName);

  // Create the per-version directory. Idempotent and cheap.
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Exclusive create — fails with EEXIST if the target already exists.
  // This is the central guarantee of rule 7: prior stored originals are
  // never silently replaced by a re-upload with the same path.
  await fs.writeFile(filePath, buffer, { flag: "wx" });

  return {
    fileName,
    filePath,
    blobUrl,
    bytesWritten: buffer.byteLength,
  };
}
