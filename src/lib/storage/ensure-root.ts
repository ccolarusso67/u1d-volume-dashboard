/**
 * src/lib/storage/ensure-root.ts
 *
 * Phase 1.7 storage rule 10: at first runtime use, confirm the storage root
 * exists and is writable. If missing, create it at runtime.
 *
 * This MUST NOT be called from migrations, seeds, or build scripts. Only
 * runtime admin routes that are about to write a file should call it.
 */
import { promises as fs } from "fs";
import path from "path";
import { getStorageRoot } from "./paths";

const FILE_TREE_ROOT = "u1d-volume-files";

/**
 * In-process memo: once we've successfully verified write access for the
 * lifetime of this Node process, subsequent admin requests skip the syscall.
 *
 * Note: a redeploy or container restart resets this — which is intentional,
 * so a freshly-mounted volume gets re-verified.
 */
let ensured = false;

/**
 * Idempotent runtime check that the storage root exists and is writable.
 *
 * Steps:
 *   1. mkdir -p {STORAGE_ROOT}/u1d-volume-files  — creates the tree if missing
 *   2. Write-probe a zero-byte file under STORAGE_ROOT, then unlink it.
 *      Surfaces EACCES / EROFS at the start of the request rather than
 *      partway through an upload.
 *
 * Throws on failure; the admin upload route should return 503 with a
 * meaningful operator-facing message.
 */
export async function ensureStorageRoot(): Promise<void> {
  if (ensured) return;

  const root = getStorageRoot();
  const schemaRoot = path.join(root, FILE_TREE_ROOT);

  await fs.mkdir(schemaRoot, { recursive: true });

  const probePath = path.join(root, ".u1d-write-probe");
  await fs.writeFile(probePath, "", { flag: "w" });
  await fs.unlink(probePath);

  ensured = true;
}

/**
 * Test-only escape hatch: reset the in-process memo so a different
 * STORAGE_ROOT can be re-verified inside a test run.
 */
export function __resetEnsuredForTests(): void {
  ensured = false;
}
