/**
 * tests/render-board-deck-email.test.ts
 *
 * PR 004D — Email rendering helper.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBoardDeckEmail } from "../src/lib/distribution/render-board-deck-email";
import { makeBoardFixture } from "./fixtures/board-period";

test("renderBoardDeckEmail: default subject includes period label", () => {
  const r = renderBoardDeckEmail(makeBoardFixture());
  assert.equal(r.subject, "U1D Monthly Board Report — May 2026");
});

test("renderBoardDeckEmail: subject override applied + trimmed", () => {
  const r = renderBoardDeckEmail(makeBoardFixture(), {
    subjectOverride: "  Custom subject  ",
  });
  assert.equal(r.subject, "Custom subject");
});

test("renderBoardDeckEmail: blank subject override falls back to default", () => {
  const r = renderBoardDeckEmail(makeBoardFixture(), { subjectOverride: "   " });
  assert.equal(r.subject, "U1D Monthly Board Report — May 2026");
});

test("renderBoardDeckEmail: text body includes period + locked metadata", () => {
  const r = renderBoardDeckEmail(makeBoardFixture());
  assert.ok(r.textBody.includes("May 2026"));
  assert.ok(r.textBody.includes("Period: May 2026"));
  assert.ok(r.textBody.includes("Version: v3"));
  assert.ok(r.textBody.includes("Locked by: carmine@x"));
  assert.ok(r.textBody.includes("Locked at: May 30, 2026"));
});

test("renderBoardDeckEmail: HTML body wraps period in <strong> + uses <ul>", () => {
  const r = renderBoardDeckEmail(makeBoardFixture());
  assert.ok(r.htmlBody.includes("<strong>May 2026</strong>"));
  assert.ok(r.htmlBody.includes("<ul>"));
  assert.ok(r.htmlBody.includes("<li>Version: v3</li>"));
});

test("renderBoardDeckEmail: optional message included in both bodies", () => {
  const r = renderBoardDeckEmail(makeBoardFixture(), {
    message: "Please review prior to Friday's meeting.",
  });
  assert.ok(r.textBody.includes("Please review prior to Friday's meeting."));
  assert.ok(r.htmlBody.includes("Please review prior to Friday&#x27;s meeting."));
});

test("renderBoardDeckEmail: HTML-escapes <script> + entities in optional message", () => {
  const evil = `<script>alert("xss")</script> & friends`;
  const r = renderBoardDeckEmail(makeBoardFixture(), { message: evil });
  assert.ok(
    !r.htmlBody.includes("<script>"),
    "raw <script> must not appear in HTML body"
  );
  assert.ok(r.htmlBody.includes("&lt;script&gt;"), "angle brackets must be entity-encoded");
  assert.ok(r.htmlBody.includes("&amp;"), "ampersand must be entity-encoded");
  // The text body should still carry the original characters (text email,
  // no need to escape).
  assert.ok(r.textBody.includes("<script>"));
});

test("renderBoardDeckEmail: message line breaks become <br> in HTML body", () => {
  const r = renderBoardDeckEmail(makeBoardFixture(), {
    message: "Line one\nLine two",
  });
  assert.ok(r.htmlBody.includes("Line one<br>Line two"));
  assert.ok(r.textBody.includes("Line one\nLine two"));
});

test("renderBoardDeckEmail: locked_by null shows em-dash, not 'null'", () => {
  const board = makeBoardFixture({ partial: {
    period: {
      year: 2026, month: 5, label: "May 2026",
      status: "locked", locked_at: "2026-05-30T15:00:00Z", locked_by: null,
    },
  } });
  const r = renderBoardDeckEmail(board);
  assert.ok(r.textBody.includes("Locked by: —"));
  assert.ok(!r.textBody.toLowerCase().includes("null"));
});
