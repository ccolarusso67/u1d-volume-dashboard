/**
 * tests/format-upload-feedback.test.ts
 *
 * PR 003C — feedback mapper coverage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatSuccess,
  formatError,
  formatUploadResponse,
} from "../src/lib/upload/format-upload-feedback";
import type { UploadResult } from "../src/lib/upload/process-upload";

const HAPPY_RESULT: UploadResult = {
  file_id: 42,
  period: { year: 2026, month: 5 },
  version_no: 3,
  file_hash: "deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678",
  filename: "U1DYNAMICS_VOLUME_2026_05.xlsx",
  total_gallons: 175319,
  source_total_gallons: 175319,
  reconstructed_total_gallons: 175319,
  has_total_discrepancy: false,
  package_alert_count: 0,
  customer_alert_count: 0,
  data_quality_alert_count: 0,
  status: "in_review",
  reused_existing_file: false,
};

test("success: clean upload → severity 'success' + version-aware headline", () => {
  const fb = formatSuccess(HAPPY_RESULT);
  assert.equal(fb.kind, "success");
  assert.equal(fb.severity, "success");
  assert.equal(fb.title, "Upload completed successfully");
  assert.equal(fb.body, "The May 2026 report was saved as version 3.");
  assert.ok(fb.details?.some((d) => d.includes("deadbeef")));
  assert.ok(fb.details?.some((d) => d.includes("175,319")));
});

test("success: alerts bump severity to 'warn' and list them", () => {
  const fb = formatSuccess({
    ...HAPPY_RESULT,
    package_alert_count: 2,
    customer_alert_count: 1,
    data_quality_alert_count: 0,
  });
  assert.equal(fb.severity, "warn");
  const alertLine = fb.details?.find((d) => d.includes("alerts"));
  assert.ok(alertLine, "alerts line present");
  assert.ok(alertLine!.includes("2 package"));
  assert.ok(alertLine!.includes("1 customer"));
  assert.ok(!alertLine!.includes("data quality"), "no data-quality fragment when count is 0");
});

test("success: discrepancy → mentions both sums and warn severity", () => {
  const fb = formatSuccess({
    ...HAPPY_RESULT,
    has_total_discrepancy: true,
    source_total_gallons: 175800,
    reconstructed_total_gallons: 175319,
    data_quality_alert_count: 1,
  });
  assert.equal(fb.severity, "warn");
  const discLine = fb.details?.find((d) => d.includes("Source TOTAL"));
  assert.ok(discLine);
  assert.ok(discLine!.includes("175,800"));
  assert.ok(discLine!.includes("175,319"));
});

test("success: orphan reuse → explicit note in details", () => {
  const fb = formatSuccess({ ...HAPPY_RESULT, reused_existing_file: true });
  assert.ok(fb.details?.some((d) => d.includes("Reused an existing stored file")));
});

test("error 401: clear sign-in-required message", () => {
  const fb = formatError(401, { error: "unauthenticated", message: "x" });
  assert.equal(fb.kind, "error");
  assert.equal(fb.title, "Sign-in required");
  assert.equal(fb.severity, "error");
});

test("error 403: not authorized message", () => {
  const fb = formatError(403, { error: "forbidden", message: "x" });
  assert.equal(fb.title, "Not authorized");
});

test("error 409 duplicate: 'already uploaded' + warn severity + period detail", () => {
  const fb = formatError(409, {
    error: "duplicate_hash",
    message: "duplicate",
    existing_file_id: 12,
    period: { year: 2026, month: 3 },
  });
  assert.equal(fb.title, "This file has already been uploaded");
  assert.equal(fb.severity, "warn");
  assert.ok(fb.details?.some((d) => d.includes("March 2026")));
  assert.ok(fb.details?.some((d) => d.includes("file_id: 12")));
});

test("error 409 duplicate without details: still gives the headline", () => {
  const fb = formatError(409, { error: "duplicate_hash", message: "dup" });
  assert.equal(fb.title, "This file has already been uploaded");
  assert.equal(fb.details, undefined);
});

test("error 413: file too large", () => {
  const fb = formatError(413, { error: "file_too_large", message: "exceeds 25MB" });
  assert.equal(fb.title, "File too large");
});

test("error 415: unsupported file type", () => {
  const fb = formatError(415, { error: "unsupported_extension", message: "not xlsx" });
  assert.equal(fb.title, "Unsupported file type");
});

test("error 422 parse: friendly headline + parser detail in body", () => {
  const fb = formatError(422, {
    error: "parse_failed",
    message: "No SUMMARY sheet found",
  });
  assert.equal(fb.title, "We received the file but could not parse it");
  assert.ok(fb.details?.[0].includes("No SUMMARY sheet found"));
});

test("error 400 empty_file: targeted message", () => {
  const fb = formatError(400, { error: "empty_file", message: "x" });
  assert.equal(fb.title, "The selected file is empty");
});

test("error 400 missing_file: targeted message", () => {
  const fb = formatError(400, { error: "missing_file", message: "x" });
  assert.equal(fb.title, "No file selected");
});

test("error 400 unknown code: falls back to server message", () => {
  const fb = formatError(400, { error: "weird_code", message: "Server said no" });
  assert.equal(fb.title, "Upload rejected");
  assert.equal(fb.body, "Server said no");
});

test("error 500: server-error message preserved when provided", () => {
  const fb = formatError(500, { error: "internal_error", message: "broken" });
  assert.equal(fb.title, "Unexpected server error");
  assert.equal(fb.body, "broken");
});

test("error 500 with null body: still gives a sensible message", () => {
  const fb = formatError(500, null);
  assert.equal(fb.title, "Unexpected server error");
  assert.ok(fb.body.length > 0);
});

test("formatUploadResponse: 200 + UploadResult → formatSuccess", () => {
  const fb = formatUploadResponse(200, HAPPY_RESULT);
  assert.equal(fb.kind, "success");
});

test("formatUploadResponse: 200 with junk body → treated as error", () => {
  // Body lacks `file_id` — we cannot trust it as a success response.
  const fb = formatUploadResponse(200, { something: "else" });
  assert.equal(fb.kind, "error");
});

test("formatUploadResponse: 409 routed through formatError", () => {
  const fb = formatUploadResponse(409, { error: "duplicate_hash", message: "dup" });
  assert.equal(fb.kind, "error");
  assert.equal(fb.title, "This file has already been uploaded");
});
