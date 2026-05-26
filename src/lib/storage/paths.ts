/**
 * src/lib/storage/paths.ts
 *
 * Phase 1.7 storage layout helpers for original Excel files.
 *
 * Backend: Railway Volume only. No S3, R2, or SharePoint at this phase.
 *
 * All file I/O must resolve the storage root through getStorageRoot() — never
 * hardcode "/app/storage". The internal blob URL scheme (`railway-volume://`)
 * is storage-provider-agnostic, so a future move to object storage swaps only
 * the resolver and a small number of helpers.
 */
import path from "path";

/** Internal URL scheme persisted in u1d_ops.volume_files.original_blob_url. */
const BLOB_URL_SCHEME = "railway-volume://";

/** Top-level subdirectory under the storage root that holds volume uploads. */
const FILE_TREE_ROOT = "u1d-volume-files";

/**
 * Resolve the on-disk storage root for original Excel files.
 *
 * Precedence (Phase 1.7 contract):
 *   1. U1D_FILE_STORAGE_ROOT     — explicit override (local dev, tests)
 *   2. RAILWAY_VOLUME_MOUNT_PATH — set by Railway when a volume is attached
 *   3. "/tmp/u1d-storage"        — dev fallback. Never used in production.
 */
export function getStorageRoot(): string {
  return (
    process.env.U1D_FILE_STORAGE_ROOT ||
    process.env.RAILWAY_VOLUME_MOUNT_PATH ||
    "/tmp/u1d-storage"
  );
}

/**
 * Filename convention:
 *   U1DYNAMICS_VOLUME_{YYYY}_{MM}__{sha256_prefix}.xlsx
 *
 * The 8-hex-char SHA-256 prefix makes the file self-describing for forensic
 * audit (it tells you which DB row it belongs to without opening it).
 */
export function buildFileName(year: number, month: number, sha256: string): string {
  if (!/^[0-9a-f]{64}$/i.test(sha256)) {
    throw new Error(
      `buildFileName: sha256 must be 64 hex chars, got ${sha256.length}`
    );
  }
  const yyyy = String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const prefix = sha256.slice(0, 8).toLowerCase();
  return `U1DYNAMICS_VOLUME_${yyyy}_${mm}__${prefix}.xlsx`;
}

/**
 * Absolute filesystem path for a versioned file under the storage root:
 *   {STORAGE_ROOT}/u1d-volume-files/{year}/{month}/v{version_no}/{file_name}
 */
export function buildFilePath(
  year: number,
  month: number,
  versionNo: number,
  fileName: string
): string {
  return path.join(
    getStorageRoot(),
    FILE_TREE_ROOT,
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    `v${versionNo}`,
    fileName
  );
}

/**
 * Directory that contains a single version's file(s).
 *   {STORAGE_ROOT}/u1d-volume-files/{year}/{month}/v{version_no}
 */
export function buildVersionDir(year: number, month: number, versionNo: number): string {
  return path.join(
    getStorageRoot(),
    FILE_TREE_ROOT,
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    `v${versionNo}`
  );
}

/**
 * Internal storage URL persisted in u1d_ops.volume_files.original_blob_url:
 *   railway-volume://u1d-volume-files/{year}/{month}/v{version_no}/{file_name}
 *
 * This is the canonical, storage-provider-agnostic reference. Callers that
 * need the absolute path go through resolveBlobUrl(). Storage-provider
 * migrations rewrite the scheme prefix and the resolver implementation only.
 */
export function buildBlobUrl(
  year: number,
  month: number,
  versionNo: number,
  fileName: string
): string {
  const yyyy = String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  return `${BLOB_URL_SCHEME}${FILE_TREE_ROOT}/${yyyy}/${mm}/v${versionNo}/${fileName}`;
}

/**
 * Reverse buildBlobUrl(): take a stored `railway-volume://...` URL and
 * return the absolute filesystem path under the current STORAGE_ROOT.
 * Throws if the scheme is not the expected one.
 */
export function resolveBlobUrl(blobUrl: string): string {
  if (!blobUrl.startsWith(BLOB_URL_SCHEME)) {
    throw new Error(
      `resolveBlobUrl: unsupported scheme in "${blobUrl}" (expected "${BLOB_URL_SCHEME}")`
    );
  }
  const rel = blobUrl.slice(BLOB_URL_SCHEME.length);
  // Guard against path-traversal in the relative segment.
  if (rel.includes("..")) {
    throw new Error(`resolveBlobUrl: refusing to resolve URL containing "..": ${blobUrl}`);
  }
  return path.join(getStorageRoot(), rel);
}

/** Exposed for tests / debugging. Not normally needed by callers. */
export const __INTERNALS__ = {
  BLOB_URL_SCHEME,
  FILE_TREE_ROOT,
};
