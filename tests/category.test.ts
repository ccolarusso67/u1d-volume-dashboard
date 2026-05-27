/**
 * tests/category.test.ts
 *
 * PR 002 — Board Accuracy Hotfix
 *
 * Verifies the canonical family -> category mapping that drives the 6-month
 * stacked-bar chart on /. The bug fixed in this PR silently bucketed
 * coolant / washer_fluid / def into "Other" because the SQL CASE compared
 * against uppercase 'COOL' / 'WW' / 'DEF' while the catalog enum is
 * lowercase 'coolant' / 'washer_fluid' / 'def'.
 *
 * categorizeFamily() is now the single source of truth and the SQL CASE
 * in getMonthlyCategoryTrend() mirrors it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { categorizeFamily, CATEGORY_DISPLAY_ORDER } from "../src/lib/queries/category";

test("oil family maps to Oil", () => {
  assert.equal(categorizeFamily("oil"), "Oil");
});

test("coolant family is not classified as Other", () => {
  assert.equal(categorizeFamily("coolant"), "Coolant");
  assert.notEqual(categorizeFamily("coolant"), "Other");
});

test("washer_fluid family is not classified as Other", () => {
  assert.equal(categorizeFamily("washer_fluid"), "WW");
  assert.notEqual(categorizeFamily("washer_fluid"), "Other");
});

test("def family is not classified as Other", () => {
  assert.equal(categorizeFamily("def"), "DEF");
  assert.notEqual(categorizeFamily("def"), "Other");
});

test("unknown family falls back to Other", () => {
  assert.equal(categorizeFamily("foo"), "Other");
  assert.equal(categorizeFamily(""), "Other");
  assert.equal(categorizeFamily(null), "Other");
  assert.equal(categorizeFamily(undefined), "Other");
});

test("upper-case input is normalized", () => {
  // Defensive: even if SQL passed an upper-case value, the JS map should cope.
  assert.equal(categorizeFamily("OIL"), "Oil");
  assert.equal(categorizeFamily("COOLANT"), "Coolant");
});

test("display order is the expected ordered tuple", () => {
  assert.deepEqual(
    [...CATEGORY_DISPLAY_ORDER],
    ["Oil", "Coolant", "WW", "DEF", "Other"]
  );
});
