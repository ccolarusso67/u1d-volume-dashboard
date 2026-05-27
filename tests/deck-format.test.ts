/**
 * tests/deck-format.test.ts
 *
 * PR 004B — pure deck formatting helpers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatGallons, formatPct, formatDelta,
  truncateText, formatDate, formatDateTime,
} from "../src/lib/deck/format";

// ---- formatGallons ----

test("formatGallons: typical values + commas", () => {
  assert.equal(formatGallons(0), "0 gal");
  assert.equal(formatGallons(1234), "1,234 gal");
  assert.equal(formatGallons(1234567), "1,234,567 gal");
});

test("formatGallons: null / undefined / NaN → '—'", () => {
  assert.equal(formatGallons(null), "—");
  assert.equal(formatGallons(undefined), "—");
  assert.equal(formatGallons(Number.NaN), "—");
  assert.equal(formatGallons(Number.POSITIVE_INFINITY), "—");
});

test("formatGallons: rounds to whole gallons", () => {
  assert.equal(formatGallons(1234.7), "1,235 gal");
  assert.equal(formatGallons(1234.4), "1,234 gal");
});

// ---- formatPct ----

test("formatPct: positive + negative + zero", () => {
  assert.equal(formatPct(0.124), "+12.4%");
  assert.equal(formatPct(-0.124), "-12.4%");
  assert.equal(formatPct(0), "0.0%");
});

test("formatPct: null / undefined / non-finite", () => {
  assert.equal(formatPct(null), "—");
  assert.equal(formatPct(undefined), "—");
  assert.equal(formatPct(Number.NaN), "—");
});

test("formatPct: one decimal precision", () => {
  assert.equal(formatPct(0.4836), "+48.4%");
  assert.equal(formatPct(0.001), "+0.1%");
});

// ---- formatDelta ----

test("formatDelta: signed gallons", () => {
  assert.equal(formatDelta(1234), "+1,234 gal");
  assert.equal(formatDelta(-1234), "-1,234 gal");
  assert.equal(formatDelta(0), "0 gal");
});

test("formatDelta: null / undefined / non-finite", () => {
  assert.equal(formatDelta(null), "—");
  assert.equal(formatDelta(undefined), "—");
  assert.equal(formatDelta(Number.NaN), "—");
});

// ---- truncateText ----

test("truncateText: passthrough when within budget", () => {
  assert.equal(truncateText("hello", 10), "hello");
  assert.equal(truncateText("exactly10!", 10), "exactly10!");
});

test("truncateText: truncates with ellipsis and respects max length", () => {
  const out = truncateText("a".repeat(20), 10);
  assert.equal(out.length, 10);
  assert.equal(out.endsWith("…"), true);
  assert.equal(out, "aaaaaaaaa…");
});

test("truncateText: trims input + strips trailing whitespace before ellipsis", () => {
  const out = truncateText("hello world this is long", 12);
  assert.equal(out.length, 12);
  assert.ok(out.endsWith("…"));
  // Should not contain trailing space immediately before the ellipsis.
  assert.notEqual(out[out.length - 2], " ");
});

test("truncateText: invalid input → empty string", () => {
  assert.equal(truncateText(null, 10), "");
  assert.equal(truncateText(undefined, 10), "");
  assert.equal(truncateText("hello", 0), "");
  assert.equal(truncateText("hello", -5), "");
});

// ---- formatDate + formatDateTime ----

test("formatDate: ISO string → 'May 30, 2026'", () => {
  assert.equal(formatDate("2026-05-30T00:00:00Z"), "May 30, 2026");
});

test("formatDate: null / invalid → '—'", () => {
  assert.equal(formatDate(null), "—");
  assert.equal(formatDate(""), "—");
  assert.equal(formatDate("garbage"), "—");
});

test("formatDateTime: ISO string → locale-stable en-US UTC string", () => {
  const out = formatDateTime("2026-05-30T14:22:00Z");
  // Day + time + 'UTC' marker.
  assert.ok(out.includes("May 30, 2026"));
  assert.ok(out.includes("14:22"));
  assert.ok(out.includes("UTC"));
});

test("formatDateTime: null → '—'", () => {
  assert.equal(formatDateTime(null), "—");
});
