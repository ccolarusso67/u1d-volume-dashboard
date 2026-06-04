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
import { getDict } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locale";

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

type UploadDict = ReturnType<typeof getDict>["upload"];

function lc(locale: Locale): "en-US" | "es-ES" {
  return locale === "es" ? "es-ES" : "en-US";
}

function periodLabel(year: number, month: number, u: UploadDict): string {
  const m = u.fbMonthsFull[month - 1] ?? `Month ${month}`;
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
export function formatSuccess(result: UploadResult, locale: Locale = "en"): Feedback {
  const u = getDict(locale).upload;
  const code = lc(locale);
  const label = periodLabel(result.period.year, result.period.month, u);
  const details: string[] = [];

  if (result.reused_existing_file) {
    details.push(u.fbReusedExisting);
  }
  details.push(u.fbFileHashPrefix(result.file_hash.slice(0, 8)));
  details.push(u.fbTotalParsed(result.total_gallons.toLocaleString(code)));
  if (result.has_total_discrepancy) {
    const src = result.source_total_gallons;
    const rec = result.reconstructed_total_gallons;
    details.push(u.fbDiscrepancy(src?.toLocaleString(code) ?? "—", rec.toLocaleString(code)));
  }
  const alerts =
    result.package_alert_count +
    result.customer_alert_count +
    result.data_quality_alert_count;
  if (alerts > 0) {
    const parts: string[] = [];
    if (result.package_alert_count > 0) parts.push(`${result.package_alert_count} ${u.fbAlertPackage}`);
    if (result.customer_alert_count > 0) parts.push(`${result.customer_alert_count} ${u.fbAlertCustomer}`);
    if (result.data_quality_alert_count > 0) parts.push(`${result.data_quality_alert_count} ${u.fbAlertDataQuality}`);
    details.push(u.fbAlertsCreated(parts.join(", "), alerts));
  }

  return {
    kind: "success",
    severity: alerts > 0 || result.has_total_discrepancy ? "warn" : "success",
    title: u.fbSuccessTitle,
    body: u.fbSuccessBody(label, result.version_no),
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
export function formatError(status: number, body: ErrorBody | null, locale: Locale = "en"): Feedback {
  const u = getDict(locale).upload;
  const code = typeof body?.error === "string" ? body.error : "";
  const serverMessage = asString(body?.message, "");

  switch (status) {
    case 401:
      return { kind: "error", severity: "error", title: u.fb401Title, body: u.fb401Body };
    case 403:
      return { kind: "error", severity: "error", title: u.fb403Title, body: u.fb403Body };
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
        details.push(u.fb409ExistingCovers(periodLabel(year, month, u)));
      }
      if (existingId !== null) {
        details.push(u.fb409OriginalId(existingId));
      }
      return {
        kind: "error",
        severity: "warn",
        title: u.fb409Title,
        body: u.fb409Body,
        details: details.length ? details : undefined,
      };
    }
    case 413:
      return { kind: "error", severity: "error", title: u.fb413Title, body: serverMessage || u.fb413Body };
    case 415:
      return { kind: "error", severity: "error", title: u.fb415Title, body: serverMessage || u.fb415Body };
    case 422:
      return {
        kind: "error",
        severity: "error",
        title: u.fb422Title,
        body: u.fb422Body,
        details: serverMessage ? [u.fb422Detail(serverMessage)] : undefined,
      };
    case 400:
      switch (code) {
        case "empty_file":
        case "empty_buffer":
          return { kind: "error", severity: "error", title: u.fbEmptyTitle, body: u.fbEmptyBody };
        case "missing_file":
        case "invalid_form":
          return { kind: "error", severity: "error", title: u.fbNoFileTitle, body: u.fbNoFileBody };
        case "no_email":
          return { kind: "error", severity: "error", title: u.fbNoEmailTitle, body: u.fbNoEmailBody };
        default:
          return { kind: "error", severity: "error", title: u.fbRejectedTitle, body: serverMessage || u.fbRejectedBody };
      }
    case 500:
    default:
      return { kind: "error", severity: "error", title: u.fb500Title, body: serverMessage || u.fb500Body };
  }
}

/**
 * Convenience for the client component:
 *   - 2xx + UploadResult shape → formatSuccess()
 *   - everything else → formatError()
 */
export function formatUploadResponse(
  status: number,
  body: unknown,
  locale: Locale = "en"
): Feedback {
  if (status >= 200 && status < 300 && body && typeof body === "object" && "file_id" in body) {
    return formatSuccess(body as UploadResult, locale);
  }
  return formatError(status, (body ?? null) as ErrorBody | null, locale);
}
