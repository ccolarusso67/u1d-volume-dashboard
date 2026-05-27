/**
 * src/lib/distribution/render-board-deck-email.ts
 *
 * PR 004D — Render the email subject + text/HTML body for a board deck send.
 *
 * Pure function: BoardPeriodView + optional message → { subject, text, html }.
 *
 * Tone is deliberately operational. This is a board package delivery, not
 * marketing copy. HTML is minimal: <p>, <ul>, <li>, <strong>, <em>. Anything
 * user-provided (custom subject, message) is HTML-escaped before composition
 * so XSS through the optional message field is impossible.
 */
import type { BoardPeriodView } from "../board/types";
import { formatDate } from "../deck/format";

export type RenderedEmail = {
  subject: string;
  textBody: string;
  htmlBody: string;
};

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

function defaultSubject(board: BoardPeriodView): string {
  return `U1D Monthly Board Report — ${board.period.label}`;
}

export function renderBoardDeckEmail(
  board: BoardPeriodView,
  options?: { subjectOverride?: string; message?: string }
): RenderedEmail {
  // Subject — single line, trimmed, fall back to the default if blank.
  const subjectRaw =
    options?.subjectOverride !== undefined && options.subjectOverride !== null
      ? String(options.subjectOverride).trim()
      : "";
  const subject = subjectRaw.length > 0 ? subjectRaw : defaultSubject(board);

  const lockedDate = formatDate(board.period.locked_at);
  const lockedBy = board.period.locked_by ?? "—";
  const version = board.activeFile ? `v${board.activeFile.version_no}` : "—";

  const message = options?.message?.trim() ?? "";

  // ---- TEXT body ----
  const textLines: string[] = [];
  textLines.push(`The monthly board report for ${board.period.label} is attached.`);
  textLines.push("");
  if (message.length > 0) {
    textLines.push(message);
    textLines.push("");
  }
  textLines.push("This deck was generated from locked monthly close data.");
  textLines.push("");
  textLines.push(`Period: ${board.period.label}`);
  textLines.push(`Status: Locked`);
  textLines.push(`Version: ${version}`);
  textLines.push(`Locked by: ${lockedBy}`);
  textLines.push(`Locked at: ${lockedDate}`);
  textLines.push("");
  textLines.push("This email was sent from the U1D Monthly Board Report system.");

  // ---- HTML body ----
  const safeMessage = message.length > 0 ? escapeHtml(message) : null;
  const safeLocker = escapeHtml(lockedBy);
  const htmlParts: string[] = [];
  htmlParts.push(
    `<p>The monthly board report for <strong>${escapeHtml(board.period.label)}</strong> is attached.</p>`
  );
  if (safeMessage) {
    // Use <p> to render the message; preserve internal line breaks.
    htmlParts.push(`<p>${safeMessage.replace(/\n/g, "<br>")}</p>`);
  }
  htmlParts.push(`<p>This deck was generated from locked monthly close data.</p>`);
  htmlParts.push(
    `<ul>` +
    `<li>Period: ${escapeHtml(board.period.label)}</li>` +
    `<li>Status: Locked</li>` +
    `<li>Version: ${escapeHtml(version)}</li>` +
    `<li>Locked by: ${safeLocker}</li>` +
    `<li>Locked at: ${escapeHtml(lockedDate)}</li>` +
    `</ul>`
  );
  htmlParts.push(
    `<p><em>This email was sent from the U1D Monthly Board Report system.</em></p>`
  );

  return {
    subject,
    textBody: textLines.join("\n"),
    htmlBody: htmlParts.join("\n"),
  };
}
