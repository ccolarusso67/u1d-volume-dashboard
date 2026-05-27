/**
 * src/app/api/admin/upload/route.ts
 *
 * PR 003B — POST /api/admin/upload
 *
 * Accepts multipart/form-data with one .xlsx file field (`file`) and runs
 * the upload pipeline:
 *   1. requireAdminSession() — 401 if no session, 403 if not admin.
 *      Middleware already gates 401 at the network layer; this is defense
 *      in depth so a misconfigured matcher cannot bypass the check.
 *   2. Parse the multipart body; reject if file is missing/empty/wrong-type.
 *   3. processUpload() — hash, parse, version, persist, transaction.
 *   4. Map typed errors to HTTP status codes. Unknown errors → 500.
 *   5. Return the JSON summary (UploadResult).
 *
 * Runs on the Node runtime (default for App Router) because processUpload
 * touches pg, fs, and exceljs — none of which work on the Edge.
 */
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/auth";
import { requireAdminSession } from "@/lib/auth/require-admin";
import { processUpload } from "@/lib/upload/process-upload";
import {
  DuplicateHashError,
  InvalidUploadError,
  ParseUploadError,
} from "@/lib/upload/errors";

// Reuse the global pool singleton from src/lib/db.ts so the route shares
// connections with the rest of the app.
import "../../../../lib/db"; // forces global.__u1dPgPool init under SSR-only paths

const ACCEPTED_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream",
]);

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB — comfortably above any monthly file

function getPool(): Pool {
  // The global is set up in src/lib/db.ts. Reaching for it directly here
  // avoids exporting it (it should stay private) while letting the route
  // share the same pool as the rest of the app.
  const g = globalThis as unknown as { __u1dPgPool?: Pool };
  if (!g.__u1dPgPool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    g.__u1dPgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : undefined,
    });
  }
  return g.__u1dPgPool;
}

export async function POST(request: NextRequest) {
  // (1) Auth — defense in depth on top of middleware.
  const authResult = await requireAdminSession(() => auth());
  if (!authResult.ok) {
    return NextResponse.json(authResult.body, { status: authResult.status });
  }
  const session = authResult.session;
  const uploadedBy = session.user?.email;
  if (!uploadedBy) {
    return NextResponse.json(
      { error: "no_email", message: "session is missing user.email" },
      { status: 400 }
    );
  }

  // (2) Multipart parsing.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    return NextResponse.json(
      {
        error: "invalid_form",
        message: err instanceof Error ? err.message : "Failed to parse multipart body",
      },
      { status: 400 }
    );
  }

  const fileField = formData.get("file");
  if (!(fileField instanceof File)) {
    return NextResponse.json(
      { error: "missing_file", message: "form field 'file' is required" },
      { status: 400 }
    );
  }
  if (fileField.size === 0) {
    return NextResponse.json(
      { error: "empty_file", message: "uploaded file is empty" },
      { status: 400 }
    );
  }
  if (fileField.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: "file_too_large",
        message: `file exceeds the ${MAX_UPLOAD_BYTES.toLocaleString()}-byte limit`,
      },
      { status: 413 }
    );
  }
  if (fileField.type && !ACCEPTED_MIME_TYPES.has(fileField.type)) {
    return NextResponse.json(
      {
        error: "unsupported_type",
        message: `mime type ${fileField.type} is not accepted`,
      },
      { status: 415 }
    );
  }
  if (!/\.xlsx$/i.test(fileField.name)) {
    return NextResponse.json(
      { error: "unsupported_extension", message: "filename must end in .xlsx" },
      { status: 415 }
    );
  }

  const buffer = Buffer.from(await fileField.arrayBuffer());

  // (3) Process. Errors are typed; map to status codes below.
  try {
    const result = await processUpload(
      {
        buffer,
        filename: fileField.name,
        uploadedBy,
      },
      { pool: getPool() }
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof DuplicateHashError) {
      return NextResponse.json(
        {
          error: "duplicate_hash",
          message: err.message,
          existing_file_id: err.existingFileId,
          period: err.period,
        },
        { status: err.status }
      );
    }
    if (err instanceof InvalidUploadError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.status }
      );
    }
    if (err instanceof ParseUploadError) {
      return NextResponse.json(
        { error: "parse_failed", message: err.message },
        { status: err.status }
      );
    }
    console.error("[upload] unexpected error:", err);
    return NextResponse.json(
      { error: "internal_error", message: "Upload failed unexpectedly" },
      { status: 500 }
    );
  }
}
