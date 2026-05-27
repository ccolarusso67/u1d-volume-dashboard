/**
 * tests/deck-content.test.ts
 *
 * PR 004C — PPTX content inspection using jszip.
 *
 * Asserts the structural invariants of the generated deck:
 *   - Exactly 10 content slides + standard pptx parts
 *   - Slide order matches the documented sequence
 *   - Key text appears on the right slides
 *   - Speaker notes are attached to content slides
 *   - Fixture customers/packages appear in their respective tables
 *
 * These tests catch shape/layout-level regressions that the byte-level
 * "is this a valid zip?" check in PR 004B cannot.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { generateMonthlyDeck } from "../src/lib/deck/generate-monthly-deck";
import { makeBoardFixture } from "./fixtures/board-period";

const SLIDE_FILE_RE = /^ppt\/slides\/slide(\d+)\.xml$/;
const NOTES_FILE_RE = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/;

async function unzipDeck(buf: Buffer): Promise<JSZip> {
  return await JSZip.loadAsync(buf);
}

async function loadSlideXml(zip: JSZip, n: number): Promise<string> {
  const f = zip.files[`ppt/slides/slide${n}.xml`];
  if (!f) throw new Error(`slide${n}.xml not found`);
  return await f.async("string");
}

async function loadNotesXml(zip: JSZip, n: number): Promise<string | null> {
  const f = zip.files[`ppt/notesSlides/notesSlide${n}.xml`];
  return f ? await f.async("string") : null;
}

// ---------------------------------------------------------------------------
// Structure invariants
// ---------------------------------------------------------------------------

test("PPTX QA: deck has exactly 10 content slides", async () => {
  const buf = await generateMonthlyDeck(makeBoardFixture());
  const zip = await unzipDeck(buf);
  const slides = Object.keys(zip.files).filter((n) => SLIDE_FILE_RE.test(n));
  assert.equal(slides.length, 10, `expected 10 slides, got ${slides.length}`);
});

test("PPTX QA: standard pptx parts are present", async () => {
  const buf = await generateMonthlyDeck(makeBoardFixture());
  const zip = await unzipDeck(buf);
  assert.ok(zip.files["[Content_Types].xml"], "content types part missing");
  assert.ok(zip.files["ppt/presentation.xml"], "presentation.xml missing");
  assert.ok(zip.files["ppt/_rels/presentation.xml.rels"], "presentation rels missing");
});

test("PPTX QA: every content slide has an associated notes slide", async () => {
  const buf = await generateMonthlyDeck(makeBoardFixture());
  const zip = await unzipDeck(buf);
  const notes = Object.keys(zip.files).filter((n) => NOTES_FILE_RE.test(n));
  // pptxgenjs writes a notes slide only when addNotes() is called. We add
  // notes to 9 of the 10 content slides (cover has notes too — total 10).
  assert.ok(notes.length >= 9, `expected ≥9 notes slides, got ${notes.length}`);
});

// ---------------------------------------------------------------------------
// Slide-by-slide content sanity (XML text inspection)
// ---------------------------------------------------------------------------

test("PPTX QA: slide 1 (cover) contains period label + product wordmark", async () => {
  const buf = await generateMonthlyDeck(makeBoardFixture());
  const zip = await unzipDeck(buf);
  const xml = await loadSlideXml(zip, 1);
  assert.ok(xml.includes("May 2026"), "cover must show period label");
  assert.ok(xml.includes("U1DYNAMICS MANUFACTURING LLC"), "cover must show company wordmark");
  assert.ok(xml.includes("Monthly Board Report"), "cover must show product title");
});

test("PPTX QA: slide 2 (executive snapshot) contains headline metric values", async () => {
  const buf = await generateMonthlyDeck(makeBoardFixture());
  const zip = await unzipDeck(buf);
  const xml = await loadSlideXml(zip, 2);
  assert.ok(xml.includes("175,319 gal"), "total gallons rendered");
  // Headline MoM% should appear; fixture is +16.9% (25319/150000).
  assert.ok(/16\.9%/.test(xml), "MoM percent rendered");
  // Card label
  assert.ok(xml.includes("TOTAL GALLONS"), "metric card label");
});

test("PPTX QA: slide 4 (top customers) lists fixture customer names", async () => {
  const buf = await generateMonthlyDeck(makeBoardFixture());
  const zip = await unzipDeck(buf);
  const xml = await loadSlideXml(zip, 4);
  assert.ok(xml.includes("ULTRACHEM"), "top customer 1");
  assert.ok(xml.includes("Key Performance"), "top customer 2");
});

test("PPTX QA: slide 5 (top packages) lists fixture package labels", async () => {
  const buf = await generateMonthlyDeck(makeBoardFixture());
  const zip = await unzipDeck(buf);
  const xml = await loadSlideXml(zip, 5);
  assert.ok(xml.includes("Drum Oil"), "top package 1");
  assert.ok(xml.includes("Box Oil"), "top package 2");
});

test("PPTX QA: slide 6 (operations narrative) carries section headers", async () => {
  const buf = await generateMonthlyDeck(makeBoardFixture());
  const zip = await unzipDeck(buf);
  const xml = await loadSlideXml(zip, 6);
  assert.ok(/CAPACITY/i.test(xml), "capacity section");
  assert.ok(/SUPPLY/i.test(xml), "supply chain section");
  assert.ok(/QUALITY/i.test(xml), "quality section");
});

test("PPTX QA: slide 7 (initiatives & risks) carries both section headers", async () => {
  const buf = await generateMonthlyDeck(makeBoardFixture());
  const zip = await unzipDeck(buf);
  const xml = await loadSlideXml(zip, 7);
  assert.ok(/INITIATIVES/i.test(xml), "initiatives section");
  assert.ok(/RISKS/i.test(xml), "risks section");
});

test("PPTX QA: slide 9 (provenance) shows file hash prefix + version", async () => {
  const buf = await generateMonthlyDeck(makeBoardFixture());
  const zip = await unzipDeck(buf);
  const xml = await loadSlideXml(zip, 9);
  assert.ok(xml.includes("a1b2c3d4"), "file hash prefix from fixture");
  assert.ok(/v3/.test(xml), "active file version");
});

test("PPTX QA: slide 10 (closing) carries closing message", async () => {
  const buf = await generateMonthlyDeck(makeBoardFixture());
  const zip = await unzipDeck(buf);
  const xml = await loadSlideXml(zip, 10);
  assert.ok(xml.includes("Board-ready operating view"), "closing message present");
  assert.ok(xml.includes("Confidential"), "confidentiality footer present");
});

// ---------------------------------------------------------------------------
// Speaker notes
// ---------------------------------------------------------------------------

test("PPTX QA: cover notes mention period + locked-by", async () => {
  const buf = await generateMonthlyDeck(makeBoardFixture());
  const zip = await unzipDeck(buf);
  const notes = await loadNotesXml(zip, 1);
  assert.ok(notes, "cover notes slide present");
  assert.ok(notes!.includes("May 2026"), "notes mention period");
  assert.ok(notes!.includes("carmine@x"), "notes mention locker");
});

test("PPTX QA: snapshot notes report total gallons + MoM context", async () => {
  const buf = await generateMonthlyDeck(makeBoardFixture());
  const zip = await unzipDeck(buf);
  const notes = await loadNotesXml(zip, 2);
  assert.ok(notes, "snapshot notes present");
  assert.ok(notes!.includes("175,319"), "notes carry total gallons");
});

test("PPTX QA: lock-history notes count reopened events for the reopened fixture", async () => {
  const buf = await generateMonthlyDeck(makeBoardFixture({ reopened: true }));
  const zip = await unzipDeck(buf);
  const notes = await loadNotesXml(zip, 9);
  assert.ok(notes, "lock history notes present");
  assert.ok(/reopened/.test(notes!), "notes mention reopen");
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("PPTX QA: no-prior-month fixture renders 'No locked prior month available'", async () => {
  const buf = await generateMonthlyDeck(makeBoardFixture({ noPriorMonth: true }));
  const zip = await unzipDeck(buf);
  const xml = await loadSlideXml(zip, 3);
  assert.ok(xml.includes("No locked prior month available"), "MoM fallback message");
});

test("PPTX QA: empty fixture (zero rows) renders fallback messaging on top tables", async () => {
  const buf = await generateMonthlyDeck(makeBoardFixture({ empty: true }));
  const zip = await unzipDeck(buf);
  const xmlC = await loadSlideXml(zip, 4);
  const xmlP = await loadSlideXml(zip, 5);
  assert.ok(xmlC.includes("No customer rows available"), "customers empty fallback");
  assert.ok(xmlP.includes("No package rows available"), "packages empty fallback");
});

test("PPTX QA: page-number footer renders e.g. '2 / 10' on slide 2", async () => {
  const buf = await generateMonthlyDeck(makeBoardFixture());
  const zip = await unzipDeck(buf);
  const xml = await loadSlideXml(zip, 2);
  assert.ok(/2 \/ 10/.test(xml), "page number footer on snapshot slide");
});
