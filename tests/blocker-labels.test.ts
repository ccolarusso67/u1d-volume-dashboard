/**
 * tests/blocker-labels.test.ts
 *
 * PR 003G — friendly blocker label formatter.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatBlockerLabel,
  formatBlockerLabels,
} from "../src/lib/review/blocker-labels";

const CASES: Array<[string, string]> = [
  ["no_active_file", "No active upload exists for this period."],
  ["no_board_period_row", "The board period row is missing."],
  ["already_locked", "This period is already locked."],
  ["operator_notes_missing", "Operator notes have not been created."],
  ["operator_notes_incomplete", "Operator notes are still incomplete."],
  ["pending_package_alerts:1", "1 package alert is still pending."],
  ["pending_package_alerts:2", "2 package alerts are still pending."],
  ["pending_customer_alerts:1", "1 customer alert is still pending."],
  ["pending_customer_alerts:3", "3 customer alerts are still pending."],
  ["pending_data_quality_alerts:1", "1 data-quality alert is still pending."],
  ["pending_data_quality_alerts:4", "4 data-quality alerts are still pending."],
];

for (const [code, expected] of CASES) {
  test(`formatBlockerLabel: ${code}`, () => {
    assert.equal(formatBlockerLabel(code), expected);
  });
}

test("formatBlockerLabel: unknown code surfaces fallback (not silently dropped)", () => {
  const out = formatBlockerLabel("brand_new_blocker_code");
  assert.ok(out.includes("brand_new_blocker_code"));
  assert.ok(/^Additional blocker:/.test(out));
});

test("formatBlockerLabel: malformed count (non-numeric) → fallback", () => {
  const out = formatBlockerLabel("pending_package_alerts:abc");
  assert.ok(out.includes("pending_package_alerts:abc"));
});

test("formatBlockerLabel: zero count → fallback (zero alerts shouldn't be a blocker)", () => {
  const out = formatBlockerLabel("pending_package_alerts:0");
  assert.ok(/^Additional blocker:/.test(out));
});

test("formatBlockerLabel: empty / non-string → readable fallback", () => {
  assert.ok(formatBlockerLabel("").includes("<empty>"));
  // @ts-expect-error — deliberate type abuse
  const fromNumber = formatBlockerLabel(42);
  assert.ok(fromNumber.includes("<empty>"));
});

test("formatBlockerLabel: singular vs plural agreement", () => {
  assert.equal(formatBlockerLabel("pending_customer_alerts:1"), "1 customer alert is still pending.");
  assert.equal(formatBlockerLabel("pending_customer_alerts:5"), "5 customer alerts are still pending.");
  // edge: 11 still plural
  assert.equal(formatBlockerLabel("pending_customer_alerts:11"), "11 customer alerts are still pending.");
});

test("formatBlockerLabels: maps an array", () => {
  const out = formatBlockerLabels([
    "pending_package_alerts:2",
    "operator_notes_incomplete",
  ]);
  assert.deepEqual(out, [
    "2 package alerts are still pending.",
    "Operator notes are still incomplete.",
  ]);
});
