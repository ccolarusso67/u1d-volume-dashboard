/**
 * tests/generate-monthly-deck.test.ts
 *
 * PR 004B — PowerPoint deck generator behavior + content sanity.
 *
 * We can't perform full XML/PPTX inspection without unzipping in tests
 * (pptx is a zip of XML parts), but we exercise the most important
 * behavioral contracts and confirm the output is a real, non-empty,
 * well-formed pptx by checking the ZIP signature ("PK\x03\x04") and
 * the presence of the standard root content type.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMonthlyDeck, DeckNotReadyError, deckFilename } from "../src/lib/deck/generate-monthly-deck";
import { makeBoardFixture } from "./fixtures/board-period";

/** Detect the PKZip signature at the start of the buffer. */
function isZipBuffer(b: Buffer): boolean {
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test("generateMonthlyDeck: returns a non-empty Buffer with valid pptx zip header", async () => {
  const board = makeBoardFixture();
  const buf = await generateMonthlyDeck(board);
  assert.ok(Buffer.isBuffer(buf), "expected Node Buffer");
  assert.ok(buf.length > 5000, `expected non-trivial pptx output, got ${buf.length} bytes`);
  assert.ok(isZipBuffer(buf), "output must start with PKZip signature");
});

test("generateMonthlyDeck: deckFilename follows U1D_Board_Report_YYYY_MM.pptx", () => {
  const board = makeBoardFixture();
  assert.equal(deckFilename(board), "U1D_Board_Report_2026_05.pptx");
  const board2 = makeBoardFixture({ partial: {
    period: { year: 2025, month: 11, label: "November 2025",
              status: "locked", locked_at: null, locked_by: null },
  } });
  assert.equal(deckFilename(board2), "U1D_Board_Report_2025_11.pptx");
});

// ---------------------------------------------------------------------------
// Defensive readiness gate
// ---------------------------------------------------------------------------

test("generateMonthlyDeck: refuses an unready BoardPeriodView", async () => {
  const board = makeBoardFixture({ ready: false });
  await assert.rejects(
    () => generateMonthlyDeck(board),
    (err: unknown) => {
      assert.ok(err instanceof DeckNotReadyError);
      assert.ok((err as DeckNotReadyError).blockers.length > 0);
      return true;
    }
  );
});

test("generateMonthlyDeck: refuses if period.status is not 'locked' even when readiness.ready=true", async () => {
  // Pathological state — readiness says ready but status isn't locked.
  // The defensive gate inside the generator still refuses.
  const board = makeBoardFixture({ partial: {
    period: { year: 2026, month: 5, label: "May 2026",
              status: "in_review", locked_at: null, locked_by: null },
    readiness: { ready: true, blockers: [] },
  } });
  await assert.rejects(
    () => generateMonthlyDeck(board),
    DeckNotReadyError
  );
});

// ---------------------------------------------------------------------------
// Edge cases: missing prior month, empty arrays, long notes
// ---------------------------------------------------------------------------

test("generateMonthlyDeck: handles missing prior locked month without throwing", async () => {
  const board = makeBoardFixture({ noPriorMonth: true });
  const buf = await generateMonthlyDeck(board);
  assert.ok(isZipBuffer(buf));
  assert.ok(buf.length > 5000);
});

test("generateMonthlyDeck: handles empty top customers + top packages", async () => {
  const board = makeBoardFixture({ empty: true });
  const buf = await generateMonthlyDeck(board);
  assert.ok(isZipBuffer(buf), "empty period still produces valid pptx");
  assert.ok(buf.length > 5000);
});

test("generateMonthlyDeck: long operator notes are truncated (no overflow throw)", async () => {
  const board = makeBoardFixture({ longNotes: true });
  // Each section in the fixture is ~1500-3600 chars; the generator should
  // truncate to 500/500/500/700/700 without throwing.
  const buf = await generateMonthlyDeck(board);
  assert.ok(isZipBuffer(buf));
  assert.ok(buf.length > 5000);
});

// ---------------------------------------------------------------------------
// Reopened lock history surfaces in the deck
// ---------------------------------------------------------------------------

test("generateMonthlyDeck: handles reopened lock history (multi-event)", async () => {
  const board = makeBoardFixture({ reopened: true });
  const buf = await generateMonthlyDeck(board);
  assert.ok(isZipBuffer(buf));
  assert.ok(buf.length > 5000);
});

// ---------------------------------------------------------------------------
// Output content sanity — peek at the first few thousand bytes for the
// standard pptx content type marker. This is a *coarse* check: it just
// confirms we're producing a pptx, not some other zip.
// ---------------------------------------------------------------------------

test("generateMonthlyDeck: output contains the pptx content type marker", async () => {
  const board = makeBoardFixture();
  const buf = await generateMonthlyDeck(board);
  // Search the binary for the well-known content type string; it's part of
  // [Content_Types].xml which sits early in a pptx zip.
  const haystack = buf.toString("binary");
  assert.ok(
    haystack.includes("application/vnd.openxmlformats-officedocument.presentationml"),
    "output must contain pptx content type marker"
  );
});
