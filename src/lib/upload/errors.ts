/**
 * src/lib/upload/errors.ts
 *
 * Typed errors that processUpload() may throw. The route handler maps
 * each to a stable HTTP status. Unknown errors become 500.
 */

export class InvalidUploadError extends Error {
  readonly status = 400;
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "InvalidUploadError";
    this.code = code;
  }
}

export class DuplicateHashError extends Error {
  readonly status = 409;
  readonly fileHash: string;
  readonly existingFileId: number;
  readonly period: { year: number; month: number };
  constructor(opts: {
    fileHash: string;
    existingFileId: number;
    period: { year: number; month: number };
  }) {
    super(
      `Duplicate upload: SHA-256 ${opts.fileHash} already ingested as file_id=${opts.existingFileId} (period ${opts.period.year}-${String(opts.period.month).padStart(2, "0")})`
    );
    this.name = "DuplicateHashError";
    this.fileHash = opts.fileHash;
    this.existingFileId = opts.existingFileId;
    this.period = opts.period;
  }
}

export class ParseUploadError extends Error {
  readonly status = 422;
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "ParseUploadError";
  }
}
