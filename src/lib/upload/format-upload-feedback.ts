/**
 * src/lib/upload/format-upload-feedback.ts
 *
 * PR 003C — Pure mapper from the /api/admin/upload response to a UI-ready
 * feedback object.
 *
 * Why a separate module: the UI's success/error rendering logic is the
 * most-touched part of the upload page. Keeping it pure (no React, no DOM)
 * means we can unit-test every code path with node:test instead of stretching
 * the project's test rig to cover a client component.
 *
 * The `kind` field is what the UI switches on (icon, color). The other
 * fields are pre-formatted strings the UI just renders.
 */
import type { UploadResult } from "./process-upload";

export type Feedback = {
  kind: "success" | "error";
  severity: "success" | "warn" | "error";
  title: string;
  body: string;          // single-paragraph plain text
  details?: string[];    // optional bulleted facts
};

/**
 * Shape of an error JSON body. The route returns { error, message } plus
 * optional fields per error (e.g. duplicate_hash carries existing_file_id).
 * We accept `unknown` and narrow defensively because the fetch response
 * might be anything if the server crashed or returned HTML.
 */
type ErrorBody = {
  error?: unknown;
  message?: unknown;
  existing_file_id?: unknown;
  period?: unknown;
};

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function periodLabel(year: number, month: number): string {
  const m = MONTHS_EN[month - 1] ?? `Month ${month}`;
  return `${m} ${year}`;
}

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function asInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/**
 * Build feedback for a 200 success response.
 */
export function formatSuccess(result: UploadResult): Feedback {
  const label = periodLabel(result.period.year, result.period.month);
  const details: string[] = [];

  if (result.reused_existing_file) {
    details.push(
      `Reused an existing stored file with matching SHA-256 — no duplicate written to disk.`
    );
  }
  details.push(`File hash prefix: ${result.file_hash.slice(0, 8)}`);
  details.push(`Total volume parsed: ${result.total_gallons.toLocaleString("en-US")} gallons.`);
  if (result.has_total_discrepancy) {
    const src = result.source_total_gallons;
    const rec = result.reconstructed_total_gallons;
    details.push(
      `Source TOTAL row (${src?.toLocaleString("en-US") ?? "—"}) differs from the reconstructed customer sum (${rec.toLocaleString("en-US")}). A data-quality alert has been opened.`
    );
  }
  const alerts =
    result.package_alert_count +
    result.customer_alert_count +
    result.data_quality_alert_count;
  if (alerts > 0) {
    const parts: string[] = [];
    if (result.package_alert_count > 0) parts.push(`${result.package_alert_count} package`);
    if (result.customer_alert_count > 0) parts.push(`${result.customer_alert_count} customer`);
    if (result.data_quality_alert_count > 0) parts.push(`${result.data_quality_alert_count} data quality`);
    details.push(
      `${parts.join(", ")} alert${alerts === 1 ? "" : "s"} created — review pending before this period can be locked.`
    );
  }

  return {
    kind: "success",
    severity: alerts > 0 || result.has_total_discrepancy ? "warn" : "success",
    title: "Upload completed successfully",
    body: `The ${label} report was saved as version ${result.version_no}.`,
    details,
  };
}

/**
 * Build feedback for any non-2xx response.
 *
 * Strategy:
 *   - Status code drives the headline (`title`).
 *   - Known `error` codes from the route get specific guidance.
 *   - Unknown shape falls back to the server-provided `message`, or
 *     a generic message if even that is missing.
 */
export function formatError(status: number, body: ErrorBody | null): Feedback {
  const code = typeof body?.error === "string" ? body.error : "";
  const serverMessage = asString(body?.message, "");

  switch (status) {
    case 401:
      return {
        kind: "error",
        severity: "error",
        title: "Sign-in required",
        body: "Your session has expired. Please sign in again and retry the upload.",
      };
    case 403:
      return {
        kind: "error",
        severity: "error",
        title: "Not authorized",
        body: "Your account does not have admin permissions for the upload tool. Contact a workspace administrator if you believe this is a mistake.",
      };
    case 409: {
      // Duplicate hash — the body includes existing_file_id + period.
      const existingId = asInt(body?.existing_file_id);
      const period =
        typeof body?.period === "object" && body?.period !== null
          ? body.period as { year?: unknown; month?: unknown }
          : null;
      const year = asInt(period?.year);
      const month = asInt(period?.month);
      const details: string[] = [];
      if (year !== null && month !== null) {
        details.push(`Existing upload covers ${periodLabel(year, month)}.`);
      }
      if (existingId !== null) {
        details.push(`Original file_id: ${existingId}.`);
      }
      return {
        kind: "error",
        severity: "warn",
        title: "This file has already been uploaded",
        body: "No duplicate records were created. If you intended to re-upload a corrected version, please re-export the file from your workbook first so it has a new hash.",
        details: details.length ? details : undefined,
      };
    }
    case 413:
      return {
        kind: "error",
        severity: "error",
        title: "File too large",
        body: serverMessage || "The selected file exceeds the maximum upload size. Please contact engineering to raise the cap if this is expected.",
      };
    case 415:
      return {
        kind: "error",
        severity: "error",
        title: "Unsupported file type",
        body: serverMessage || "Only .xlsx workbooks are accepted. Please save your spreadsheet as Excel Workbook (.xlsx) and try again.",
      };
    case 422:
      return {
        kind: "error",
        severity: "error",
        title: "We received the file but could not parse it",
        body: "The system could not find the expected monthly volume structure. Please confirm the workbook contains a SUMMARY sheet with the standard customer/package layout, and try again.",
        details: serverMessage ? [`Parser detail: ${serverMessage}`] : undefined,
      };
    case 400:
      switch (code) {
        case "empty_file":
        case "empty_buffer":
          return {
            kind: "error",
            severity: "error",
            title: "The selected file is empty",
            body: "Please choose a non-empty .xlsx file and try again.",
          };
        case "missing_file":
        case "invalid_form":
          return {
            kind: "error",
            severity: "error",
            title: "No file selected",
            body: "Please choose a file before submitting.",
          };
        case "no_email":
          return {
            kind: "error",
            severity: "error",
            title: "Session is missing your email",
            body: "Please sign out and sign in again, then retry.",
          };
        default:
          return {
            kind: "error",
            severity: "error",
            title: "Upload rejected",
            body: serverMessage || "The request was rejected as invalid. Please review the file and try again.",
          };
      }
    case 500:
    default:
      return {
        kind: "error",
        severity: "error",
        title: "Unexpected server error",
        body: serverMessage || "Something went wrong on the server. Please retry in a moment — if the problem persists, contact engineering with a screenshot.",
      };
  }
}

/**
 * Convenience for the client component:
 *   - 2xx + UploadResult shape → formatSuccess()
 *   - everything else → formatError()
 */
export function formatUploadResponse(
  status: number,
  body: unknown
): Feedback {
  if (status >= 200 && status < 300 && body && typeof body === "object" && "file_id" in body) {
    return formatSuccess(body as UploadResult);
  }
  return formatError(status, (body ?? null) as ErrorBody | null);
}
