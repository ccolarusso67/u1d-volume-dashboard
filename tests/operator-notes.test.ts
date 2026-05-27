/**
 * tests/operator-notes.test.ts
 *
 * PR 003E — operator-notes helpers + readiness contract.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TestPool } from "./test-pool";
import { getOperatorNotes } from "../src/lib/operator-notes/get-operator-notes";
import { saveOperatorNotes } from "../src/lib/operator-notes/save-operator-notes";
import { isComplete, allSectionsFilled } from "../src/lib/operator-notes/is-complete";
import { evaluateReadiness } from "../src/lib/review/readiness";
import { SECTION_KEYS } from "../src/lib/operator-notes/types";
import type { SectionKey } from "../src/lib/operator-notes/types";

// ---------------------------------------------------------------------------
// isComplete + allSectionsFilled
// ---------------------------------------------------------------------------

function filledSections(): Record<SectionKey, string | null> {
  return Object.fromEntries(
    SECTION_KEYS.map((k) => [k, `narrative for ${k}`])
  ) as Record<SectionKey, string | null>;
}

test("allSectionsFilled: all five non-blank → true", () => {
  assert.equal(allSectionsFilled(filledSections()), true);
});

test("allSectionsFilled: any null → false", () => {
  const s = filledSections();
  s.risks = null;
  assert.equal(allSectionsFilled(s), false);
});

test("allSectionsFilled: any whitespace-only → false", () => {
  const s = filledSections();
  s.risks = "   \n\t ";
  assert.equal(allSectionsFilled(s), false);
});

test("isComplete: needs both all-filled AND completed_at", () => {
  assert.equal(
    isComplete({ sections: filledSections(), completed_at: null }),
    false,
    "all filled but completed_at null"
  );
  const partial = filledSections();
  partial.risks = "";
  assert.equal(
    isComplete({ sections: partial, completed_at: "2026-05-30T00:00:00Z" }),
    false,
    "completed_at set but section blank"
  );
  assert.equal(
    isComplete({ sections: filledSections(), completed_at: "2026-05-30T00:00:00Z" }),
    true,
    "both → complete"
  );
});

// ---------------------------------------------------------------------------
// getOperatorNotes
// ---------------------------------------------------------------------------

test("getOperatorNotes: no row → returns empty shape with exists=false", async () => {
  const pool = new TestPool({
    responders: [(t) => (t.includes("FROM u1d_ops.monthly_operator_notes") ? { rows: [] } : null)],
  });
  const r = await getOperatorNotes(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(r.exists, false);
  assert.equal(r.is_complete, false);
  assert.equal(r.period_year, 2026);
  assert.equal(r.period_month, 5);
  for (const k of SECTION_KEYS) assert.equal(r.sections[k], null);
});

test("getOperatorNotes: row with all sections + completed_at → is_complete=true", async () => {
  const pool = new TestPool({
    responders: [
      (t) =>
        t.includes("FROM u1d_ops.monthly_operator_notes")
          ? {
              rows: [{
                capacity_md: "Capacity copy",
                supply_chain_md: "Supply copy",
                quality_md: "Quality copy",
                initiatives_md: "Initiatives copy",
                risks_md: "Risks copy",
                completed_at: new Date("2026-05-30T00:00:00Z"),
                completed_by: "eugenio@x",
                updated_at: new Date("2026-05-30T00:00:00Z"),
                updated_by: "eugenio@x",
              }],
            }
          : null,
    ],
  });
  const r = await getOperatorNotes(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(r.exists, true);
  assert.equal(r.is_complete, true);
  assert.equal(r.sections.capacity_production, "Capacity copy");
  assert.equal(r.sections.supply_chain, "Supply copy");
  assert.equal(r.completed_at, "2026-05-30T00:00:00.000Z");
});

test("getOperatorNotes: row exists but one section blank → is_complete=false", async () => {
  const pool = new TestPool({
    responders: [
      (t) =>
        t.includes("FROM u1d_ops.monthly_operator_notes")
          ? {
              rows: [{
                capacity_md: "ok",
                supply_chain_md: "  ",
                quality_md: "ok",
                initiatives_md: "ok",
                risks_md: "ok",
                completed_at: new Date(),
                completed_by: "x",
                updated_at: new Date(),
                updated_by: "x",
              }],
            }
          : null,
    ],
  });
  const r = await getOperatorNotes(pool as unknown as import("pg").Pool, 2026, 5);
  assert.equal(r.is_complete, false);
});

// ---------------------------------------------------------------------------
// saveOperatorNotes
// ---------------------------------------------------------------------------

test("saveOperatorNotes draft: UPSERT with section deltas, no completion fields", async () => {
  const pool = new TestPool({
    responders: [
      (t) => (t.includes("INSERT INTO u1d_ops.monthly_operator_notes") ? { rows: [] } : null),
      // The subsequent getOperatorNotes refresh call
      (t) =>
        t.includes("FROM u1d_ops.monthly_operator_notes")
          ? {
              rows: [{
                capacity_md: "x",
                supply_chain_md: null,
                quality_md: null,
                initiatives_md: null,
                risks_md: null,
                completed_at: null,
                completed_by: null,
                updated_at: new Date(),
                updated_by: "admin@x",
              }],
            }
          : null,
    ],
  });
  const r = await saveOperatorNotes(
    pool as unknown as import("pg").Pool,
    2026, 5,
    { capacity_production: "x" },
    "admin@x",
    "draft"
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.notes.exists, true);
    assert.equal(r.notes.is_complete, false);
  }
  const ins = pool.findQuery("INSERT INTO u1d_ops.monthly_operator_notes");
  assert.ok(ins, "UPSERT query must run");
  assert.ok(!ins!.text.includes("completed_at"), "draft must not touch completed_at");
});

test("saveOperatorNotes mark_complete: refuses if any merged section is blank", async () => {
  let getCalls = 0;
  const pool = new TestPool({
    responders: [
      // First getOperatorNotes (merge check) — existing row has 3 of 5 sections.
      (t) => {
        if (t.includes("FROM u1d_ops.monthly_operator_notes")) {
          getCalls++;
          return {
            rows: [{
              capacity_md: "x",
              supply_chain_md: "x",
              quality_md: "x",
              initiatives_md: null,
              risks_md: null,
              completed_at: null,
              completed_by: null,
              updated_at: new Date(),
              updated_by: null,
            }],
          };
        }
        return null;
      },
    ],
  });
  const r = await saveOperatorNotes(
    pool as unknown as import("pg").Pool,
    2026, 5,
    { initiatives: "x" }, // adds 1 of the 2 missing
    "admin@x",
    "mark_complete"
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "sections_incomplete");
  assert.equal(getCalls, 1, "should not have run the UPSERT");
});

test("saveOperatorNotes mark_complete: succeeds when merge fills all sections", async () => {
  const pool = new TestPool({
    responders: [
      // 1. merge check — existing has 4 of 5 sections filled
      (t, _p) =>
        t.includes("FROM u1d_ops.monthly_operator_notes")
          ? {
              rows: [{
                capacity_md: "x",
                supply_chain_md: "x",
                quality_md: "x",
                initiatives_md: "x",
                risks_md: null,
                completed_at: null,
                completed_by: null,
                updated_at: new Date(),
                updated_by: null,
              }],
            }
          : null,
      // 2. UPSERT
      (t) => (t.includes("INSERT INTO u1d_ops.monthly_operator_notes") ? { rows: [] } : null),
      // 3. refresh getOperatorNotes — now complete
      // Note: this responder is consulted again because pool.query was matched
      //       by the first responder. The TestPool dispatches to the first
      //       matching responder, so we need a second match for the same SQL
      //       to return the updated state. Easiest: bump the response after
      //       the UPSERT by mutating a shared variable.
    ],
  });

  // Build the responders with mutable state.
  let phase: "before" | "after" = "before";
  const pool2 = new TestPool({
    responders: [
      (t) => {
        if (t.includes("INSERT INTO u1d_ops.monthly_operator_notes")) {
          phase = "after";
          return { rows: [] };
        }
        return null;
      },
      (t) => {
        if (t.includes("FROM u1d_ops.monthly_operator_notes")) {
          if (phase === "before") {
            return {
              rows: [{
                capacity_md: "x",
                supply_chain_md: "x",
                quality_md: "x",
                initiatives_md: "x",
                risks_md: null,
                completed_at: null,
                completed_by: null,
                updated_at: new Date(),
                updated_by: null,
              }],
            };
          }
          return {
            rows: [{
              capacity_md: "x",
              supply_chain_md: "x",
              quality_md: "x",
              initiatives_md: "x",
              risks_md: "now filled",
              completed_at: new Date("2026-06-01T00:00:00Z"),
              completed_by: "admin@x",
              updated_at: new Date(),
              updated_by: "admin@x",
            }],
          };
        }
        return null;
      },
    ],
  });

  const r = await saveOperatorNotes(
    pool2 as unknown as import("pg").Pool,
    2026, 5,
    { risks: "now filled" },
    "admin@x",
    "mark_complete"
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.notes.is_complete, true);
    assert.equal(r.notes.completed_by, "admin@x");
  }
  const ins = pool2.findQuery("INSERT INTO u1d_ops.monthly_operator_notes");
  assert.ok(ins, "UPSERT must run");
  assert.ok(ins!.text.includes("completed_at"), "mark_complete must set completed_at");
});

test("saveOperatorNotes reopen: UPSERT clears completed_at/_by", async () => {
  const pool = new TestPool({
    responders: [
      (t) => (t.includes("INSERT INTO u1d_ops.monthly_operator_notes") ? { rows: [] } : null),
      (t) =>
        t.includes("FROM u1d_ops.monthly_operator_notes")
          ? {
              rows: [{
                capacity_md: "x",
                supply_chain_md: "x",
                quality_md: "x",
                initiatives_md: "x",
                risks_md: "x",
                completed_at: null,
                completed_by: null,
                updated_at: new Date(),
                updated_by: "admin@x",
              }],
            }
          : null,
    ],
  });
  const r = await saveOperatorNotes(
    pool as unknown as import("pg").Pool,
    2026, 5,
    {},
    "admin@x",
    "reopen"
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.notes.is_complete, false);
  const ins = pool.findQuery("INSERT INTO u1d_ops.monthly_operator_notes");
  assert.ok(ins!.text.includes("completed_at = NULL"), "reopen sets completed_at = NULL");
});

test("saveOperatorNotes: validation rejects bad year/month/updatedBy", async () => {
  const pool = new TestPool({ responders: [() => ({ rows: [] })] });
  for (const args of [
    [1999, 5, "admin@x", "invalid_year"],
    [2026, 13, "admin@x", "invalid_month"],
    [2026, 5, "", "updated_by_required"],
  ] as const) {
    const r = await saveOperatorNotes(
      pool as unknown as import("pg").Pool,
      args[0] as number,
      args[1] as number,
      {},
      args[2] as string,
      "draft"
    );
    assert.equal(r.ok, false, `expected ok=false for ${JSON.stringify(args)}`);
    if (!r.ok) assert.equal(r.reason, args[3]);
  }
});

// ---------------------------------------------------------------------------
// evaluateReadiness
// ---------------------------------------------------------------------------

test("evaluateReadiness: all good → ready=true, no blockers", () => {
  const r = evaluateReadiness({
    hasActiveFile: true,
    hasBoardPeriodRow: true,
    isAlreadyLocked: false,
    pendingPackageAlerts: 0,
    pendingCustomerAlerts: 0,
    pendingDataQualityAlerts: 0,
    operatorNotesExists: true,
    operatorNotesComplete: true,
  });
  assert.deepEqual(r, { ready: true, blockers: [] });
});

test("evaluateReadiness: missing operator notes → operator_notes_missing reason", () => {
  const r = evaluateReadiness({
    hasActiveFile: true,
    hasBoardPeriodRow: true,
    isAlreadyLocked: false,
    pendingPackageAlerts: 0,
    pendingCustomerAlerts: 0,
    pendingDataQualityAlerts: 0,
    operatorNotesExists: false,
    operatorNotesComplete: false,
  });
  assert.equal(r.ready, false);
  assert.ok(r.blockers.includes("operator_notes_missing"));
  assert.ok(!r.blockers.includes("operator_notes_incomplete"));
});

test("evaluateReadiness: incomplete operator notes → operator_notes_incomplete reason", () => {
  const r = evaluateReadiness({
    hasActiveFile: true,
    hasBoardPeriodRow: true,
    isAlreadyLocked: false,
    pendingPackageAlerts: 0,
    pendingCustomerAlerts: 0,
    pendingDataQualityAlerts: 0,
    operatorNotesExists: true,
    operatorNotesComplete: false,
  });
  assert.ok(r.blockers.includes("operator_notes_incomplete"));
  assert.ok(!r.blockers.includes("operator_notes_missing"));
});

test("evaluateReadiness: multiple blockers cumulate", () => {
  const r = evaluateReadiness({
    hasActiveFile: false,
    hasBoardPeriodRow: false,
    isAlreadyLocked: true,
    pendingPackageAlerts: 2,
    pendingCustomerAlerts: 1,
    pendingDataQualityAlerts: 3,
    operatorNotesExists: false,
    operatorNotesComplete: false,
  });
  assert.equal(r.ready, false);
  assert.ok(r.blockers.includes("no_active_file"));
  assert.ok(r.blockers.includes("no_board_period_row"));
  assert.ok(r.blockers.includes("already_locked"));
  assert.ok(r.blockers.includes("pending_package_alerts:2"));
  assert.ok(r.blockers.includes("pending_customer_alerts:1"));
  assert.ok(r.blockers.includes("pending_data_quality_alerts:3"));
  assert.ok(r.blockers.includes("operator_notes_missing"));
});
