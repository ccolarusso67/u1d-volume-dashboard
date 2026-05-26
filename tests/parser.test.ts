/**
 * tests/parser.test.ts
 *
 * PR 002 — Board Accuracy Hotfix
 *
 * Coverage:
 *   - TOTE WW recognised
 *   - SUNCOAST canonicalizes to SUN COAST RESOURCES via alias map
 *   - KEYPERFOR canonicalizes to KEY PERFORMANCE via alias map
 *   - Unknown packages are returned in warnings, not silently dropped
 *   - Unknown customers are returned in warnings, not silently dropped
 *   - Customer-detail tabs surface unknown packages with source CUSTOMER_DETAIL
 *
 * Tests use synthetic fixtures (see fixtures.ts) — no real client data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVolumeFile, PACKAGE_KEYS, CUSTOMER_KEYS } from "../src/lib/parser/volume-parser";
import { buildSyntheticVolumeXlsx } from "./fixtures";

// Mirrors the rows seeded by migration 005 into u1d_ops.customer_aliases.
const ALIASES = new Map<string, string>([
  ["SUNCOAST", "SUN COAST RESOURCES"],
  ["SUN COAST", "SUN COAST RESOURCES"],
  ["SUN COAST RESOURCES", "SUN COAST RESOURCES"],
  ["KEYPERFOR", "KEY PERFORMANCE"],
  ["KEY PERFORMANCE", "KEY PERFORMANCE"],
  ["TERRA", "TERRA DISTRIBUTORS"],
  ["TERRA DISTRIBUTORS", "TERRA DISTRIBUTORS"],
  ["ULTRACHEM", "ULTRACHEM"],
  ["LUBRIMAR", "LUBRIMAR"],
]);

const KNOWN_PACKAGES = new Set<string>(PACKAGE_KEYS);

test("TOTE WW is recognised as a known package and rolled into volume_fact", async () => {
  const buf = await buildSyntheticVolumeXlsx({
    customers: [
      {
        label: "ULTRACHEM",
        values: { "TOTE WW": 5300, "DRUM OIL": 1000 },
      },
    ],
  });
  const result = await parseVolumeFile(buf, {
    customerAliases: ALIASES,
    knownPackages: KNOWN_PACKAGES,
  });
  const totesWw = result.rows.filter((r) => r.package_key === "TOTE WW");
  assert.equal(totesWw.length, 1);
  assert.equal(totesWw[0].gallons, 5300);
  assert.equal(totesWw[0].customer_key, "ULTRACHEM");
  assert.equal(
    result.warnings.unknownPackages.length,
    0,
    "TOTE WW must not appear as an unknown package warning"
  );
});

test("SUNCOAST canonicalizes to SUN COAST RESOURCES", async () => {
  const buf = await buildSyntheticVolumeXlsx({
    customers: [{ label: "SUNCOAST", values: { "DRUM OIL": 4752 } }],
  });
  const result = await parseVolumeFile(buf, {
    customerAliases: ALIASES,
    knownPackages: KNOWN_PACKAGES,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].customer_key, "SUN COAST RESOURCES");
  assert.equal(result.rows[0].gallons, 4752);
  assert.equal(
    result.warnings.unknownCustomers.length,
    0,
    "SUNCOAST must not appear as an unknown customer when aliased"
  );
});

test("KEYPERFOR canonicalizes to KEY PERFORMANCE", async () => {
  const buf = await buildSyntheticVolumeXlsx({
    customers: [{ label: "KEYPERFOR", values: { "BOX OIL": 6912 } }],
  });
  const result = await parseVolumeFile(buf, {
    customerAliases: ALIASES,
    knownPackages: KNOWN_PACKAGES,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].customer_key, "KEY PERFORMANCE");
  assert.equal(result.warnings.unknownCustomers.length, 0);
});

test("unknown package in SUMMARY is reported as warning, not silently dropped", async () => {
  const buf = await buildSyntheticVolumeXlsx({
    customers: [{ label: "ULTRACHEM", values: { "DRUM OIL": 1000 } }],
    // Add a fake new package column at the end of the row
    extraHeaders: ["FLEXIBAG"],
  });
  // Override knownPackages to deliberately exclude FLEXIBAG even if it
  // is later added to PACKAGE_KEYS; this asserts the warning path.
  const restricted = new Set<string>(KNOWN_PACKAGES);
  restricted.delete("FLEXIBAG"); // no-op today; documents intent

  // Manually set a value in the extra column via a second pass — easier:
  // build a fresh fixture with a custom shape.
  // Instead, use the fixture's customers to add a value under the extra
  // header key by setting it in values; fixture's data-loop only writes
  // through FIXTURE_PACKAGE_HEADER, so the extra header column stays 0.
  // To exercise the warning path we add an unknown column via SUMMARY's
  // body: use a synthetic workbook that hand-injects the value.
  // Quickest: rebuild with a label collision — make BOX OIL unknown by
  // restricting knownPackages further.
  const stricter = new Set<string>(KNOWN_PACKAGES);
  stricter.delete("BOX OIL");
  const buf2 = await buildSyntheticVolumeXlsx({
    customers: [{ label: "ULTRACHEM", values: { "BOX OIL": 2500, "DRUM OIL": 1000 } }],
  });
  const result = await parseVolumeFile(buf2, {
    customerAliases: ALIASES,
    knownPackages: stricter,
  });
  // BOX OIL is now unknown — it should appear as a warning with the right gallons
  const warn = result.warnings.unknownPackages.find((w) => w.raw_label === "BOX OIL");
  assert.ok(warn, "BOX OIL must surface as an unknownPackages warning");
  assert.equal(warn!.source, "SUMMARY");
  assert.equal(warn!.gallons_observed, 2500);
  // And BOX OIL must not appear in rows
  assert.equal(
    result.rows.find((r) => r.package_key === "BOX OIL"),
    undefined
  );
});

test("unknown customer in SUMMARY is reported as warning, not silently dropped", async () => {
  const buf = await buildSyntheticVolumeXlsx({
    customers: [
      { label: "ULTRACHEM", values: { "DRUM OIL": 1000 } },
      { label: "NEW DISTRIBUTOR XYZ", values: { "DRUM OIL": 500, "PAIL OIL": 200 } },
    ],
  });
  const result = await parseVolumeFile(buf, {
    customerAliases: ALIASES,
    knownPackages: KNOWN_PACKAGES,
  });
  const warn = result.warnings.unknownCustomers.find(
    (w) => w.raw_label === "NEW DISTRIBUTOR XYZ"
  );
  assert.ok(warn, "Unknown customer must surface as warning");
  assert.equal(warn!.source, "SUMMARY");
  assert.equal(warn!.gallons_observed, 700);
  // And no fact rows attributed to NEW DISTRIBUTOR XYZ
  assert.equal(
    result.rows.find((r) => r.customer_key === "NEW DISTRIBUTOR XYZ"),
    undefined
  );
});

test("customer detail tab surfaces unknown packages with source CUSTOMER_DETAIL", async () => {
  const buf = await buildSyntheticVolumeXlsx({
    customers: [{ label: "ULTRACHEM", values: { "DRUM OIL": 1000 } }],
    customerDetailTabs: [
      {
        sheetName: "ULTRACHEM",
        rows: [
          { presentation_simplified: "DRUM OIL", gallons: 1000 },
          { presentation_simplified: "FLEXIBAG", gallons: 6340 },
        ],
      },
    ],
  });
  const result = await parseVolumeFile(buf, {
    customerAliases: ALIASES,
    knownPackages: KNOWN_PACKAGES,
  });
  const warn = result.warnings.unknownPackages.find(
    (w) => w.raw_label === "FLEXIBAG" && w.source === "CUSTOMER_DETAIL"
  );
  assert.ok(warn, "FLEXIBAG in customer detail tab must surface as warning");
  assert.equal(warn!.gallons_observed, 6340);
});

test("known customer with only canonical label produces facts and no warnings", async () => {
  const buf = await buildSyntheticVolumeXlsx({
    customers: [
      { label: "ULTRACHEM", values: { "DRUM OIL": 1000, "BOX OIL": 500 } },
      { label: "SUN COAST RESOURCES", values: { "DRUM OIL": 4752 } },
    ],
  });
  const result = await parseVolumeFile(buf, {
    customerAliases: ALIASES,
    knownPackages: KNOWN_PACKAGES,
  });
  assert.equal(result.rows.length, 3);
  assert.equal(result.warnings.unknownCustomers.length, 0);
  assert.equal(result.warnings.unknownPackages.length, 0);
  assert.equal(result.computed_customer_sum, 1000 + 500 + 4752);
});

test("source TOTAL row discrepancy is flagged but does not affect facts", async () => {
  // Build a fixture where the TOTAL row is artificially manipulated by
  // adding an unknown customer (whose gallons are excluded from rows but
  // are present in the TOTAL formula our synthetic builder writes).
  const buf = await buildSyntheticVolumeXlsx({
    customers: [
      { label: "ULTRACHEM", values: { "DRUM OIL": 1000 } },
      { label: "MYSTERY CUSTOMER", values: { "DRUM OIL": 450 } },
    ],
  });
  const result = await parseVolumeFile(buf, {
    customerAliases: ALIASES,
    knownPackages: KNOWN_PACKAGES,
  });
  // computed_customer_sum only counts known customers
  assert.equal(result.computed_customer_sum, 1000);
  // source_total_row counts the mystery customer too
  assert.equal(result.source_total_row, 1450);
  assert.equal(result.has_total_discrepancy, true);
  assert.equal(result.discrepancy_amount, 450);
});

test("file hash is deterministic and 64 hex chars", async () => {
  const buf = await buildSyntheticVolumeXlsx({
    customers: [{ label: "ULTRACHEM", values: { "DRUM OIL": 1000 } }],
  });
  const a = await parseVolumeFile(buf, { customerAliases: ALIASES });
  const b = await parseVolumeFile(buf, { customerAliases: ALIASES });
  assert.match(a.file_hash, /^[0-9a-f]{64}$/);
  assert.equal(a.file_hash, b.file_hash);
});
