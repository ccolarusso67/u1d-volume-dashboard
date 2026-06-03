/**
 * tests/board-narrative.test.ts
 *
 * PR 006 — deterministic board narrative rules.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BoardExecutiveDashboard } from "../src/lib/board/executive-types";
import { generateBoardNarrative } from "../src/lib/board/narrative";

function makeDashboard(overrides?: Partial<BoardExecutiveDashboard>): BoardExecutiveDashboard {
  const base: BoardExecutiveDashboard = {
    period: {
      year: 2026,
      month: 5,
      label: "May 2026",
      status: "locked",
      locked_at: "2026-05-31T12:00:00Z",
      locked_by: "carmine@u1dynamics.com",
    },
    readiness: { ready: true, blockers: [] },
    activeFile: {
      file_id: 1,
      filename: "volume.xlsx",
      version_no: 2,
      uploaded_at: "2026-05-30T12:00:00Z",
      uploaded_by: "carmine@u1dynamics.com",
      file_hash_prefix: "abc12345",
      total_gallons: 175319,
      source_total_gallons: 175319,
      reconstructed_total_gallons: 175319,
      has_total_discrepancy: false,
    },
    currentMetrics: {
      total_gallons: 175319,
      customer_count: 5,
      package_count: 3,
      fact_row_count: 12,
    },
    priorMonth: {
      total_gallons: 150000,
      customer_count: 4,
      package_count: 3,
      fact_row_count: 10,
      delta_gallons: 25319,
      delta_pct: 25319 / 150000,
    },
    priorYear: {
      total_gallons: 180000,
      customer_count: 5,
      package_count: 4,
      fact_row_count: 11,
      delta_gallons: -4681,
      delta_pct: -4681 / 180000,
    },
    ytd: {
      current_year_gallons: 700000,
      prior_year_gallons: 650000,
      delta_gallons: 50000,
      delta_pct: 50000 / 650000,
      months_included: 5,
      months_missing: 0,
    },
    reopenCount: 0,
    trend6: [],
    trend12: [],
    topCustomers: [
      {
        customer_key: "A",
        customer_name: "Alpha",
        is_intercompany: false,
        gallons: 80000,
        share_pct: 80000 / 175319,
        prior_month_gallons: 70000,
        prior_year_gallons: 85000,
        mom_delta_gallons: 10000,
        mom_delta_pct: 10000 / 70000,
        yoy_delta_gallons: -5000,
        yoy_delta_pct: -5000 / 85000,
      },
    ],
    customerConcentration: {
      top_customer_share: 80000 / 175319,
      top_customer_name: "Alpha",
      top5_share: 1,
      intercompany_share: 40000 / 175319,
      external_share: 135319 / 175319,
    },
    customerMovers: { topGainers: [], topDecliners: [] },
    topPackages: [
      {
        package_key: "DRUM",
        package_label: "Drum Oil",
        family: "Oil",
        gallons: 90000,
        share_pct: 90000 / 175319,
        prior_month_gallons: 80000,
        prior_year_gallons: 95000,
        mom_delta_gallons: 10000,
        mom_delta_pct: 10000 / 80000,
        yoy_delta_gallons: -5000,
        yoy_delta_pct: -5000 / 95000,
      },
    ],
    categoryMix: {
      total_gallons: 175319,
      slices: [
        { category: "Oil", gallons: 120000, share: 120000 / 175319 },
        { category: "Coolant", gallons: 55319, share: 55319 / 175319 },
      ],
    },
    packageMovers: { topGainers: [], topDecliners: [] },
    operatorNotes: null,
    alertSummary: {
      package_alerts_total: 2,
      customer_alerts_total: 1,
      data_quality_alerts_total: 0,
      resolved_alerts_total: 3,
      pending_alerts_total: 0,
    },
    lockHistory: [],
    finance: null,
    volumeGoal: null,
  };

  return { ...base, ...(overrides ?? {}) };
}

test("generateBoardNarrative creates a concise executive readout from dashboard metrics", () => {
  const narrative = generateBoardNarrative(makeDashboard());
  const readout = narrative.sections.find((section) => section.id === "executive-readout");
  const observations = narrative.sections.find((section) => section.id === "key-observations");

  assert.ok(readout?.paragraphs?.[0].includes("May 2026 closed at 175,319 gallons"));
  assert.ok(readout?.paragraphs?.[0].includes("Volume increased 16.9% (+25,319 gallons) versus the prior month."));
  assert.ok(observations?.bullets?.some((bullet) => bullet.text.includes("Alpha represents 45.6%")));
  assert.equal(narrative.sections.some((section) => section.id === "data-limitations"), false);
});

test("generateBoardNarrative reports missing comparison data without guessing", () => {
  const narrative = generateBoardNarrative(makeDashboard({
    priorMonth: null,
    priorYear: null,
    ytd: {
      current_year_gallons: 175319,
      prior_year_gallons: null,
      delta_gallons: null,
      delta_pct: null,
      months_included: 1,
      months_missing: 4,
    },
    categoryMix: { total_gallons: 0, slices: [] },
    topPackages: [],
  }));
  const limitations = narrative.sections.find((section) => section.id === "data-limitations");

  assert.ok(limitations?.bullets?.some((bullet) => bullet.text.includes("Prior-month comparison is not available")));
  assert.ok(limitations?.bullets?.some((bullet) => bullet.text.includes("Prior-year comparison is not available")));
  assert.ok(limitations?.bullets?.some((bullet) => bullet.text.includes("Prior-year YTD comparison is not available")));
  assert.ok(limitations?.bullets?.some((bullet) => bullet.text.includes("Product/package mix is not available")));
});

test("generateBoardNarrative flags pending alerts and reopens as management focus items", () => {
  const narrative = generateBoardNarrative(makeDashboard({
    reopenCount: 2,
    alertSummary: {
      package_alerts_total: 2,
      customer_alerts_total: 1,
      data_quality_alerts_total: 1,
      resolved_alerts_total: 2,
      pending_alerts_total: 2,
    },
  }));
  const observations = narrative.sections.find((section) => section.id === "key-observations");
  const focus = narrative.sections.find((section) => section.id === "management-focus");

  assert.ok(observations?.bullets?.some((bullet) => bullet.severity === "risk" && bullet.text.includes("2 operational alerts remain pending")));
  assert.ok(observations?.bullets?.some((bullet) => bullet.severity === "watch" && bullet.text.includes("2 reopens")));
  assert.ok(focus?.bullets?.some((bullet) => bullet.text.includes("Resolve or disposition 2 pending alerts")));
});
