/**
 * src/lib/distribution/send-board-deck.ts
 *
 * PR 004D — End-to-end orchestrator for emailing a board deck.
 *
 * Pure-ish function (depends only on injected pool + email provider) so the
 * route is a thin shell. Validates readiness, distribution list, recipient
 * presence, and duplicate-send guard BEFORE generating a deck — those are
 * the cheap checks that prevent wasted work.
 *
 * Order of operations (all guarded by typed errors):
 *   1. Load board period (PR 004A)
 *   2. Refuse if !readiness.ready or status !== 'locked'
 *   3. Load distribution list (PR 004D)
 *   4. Refuse if no active list / list not found
 *   5. Filter to active recipients; refuse if no active TO recipients
 *   6. Duplicate-send guard: refuse if a successful send for this
 *      (period, list) exists within last 24h unless confirmResend=true
 *   7. Generate deck (PR 004B/C)
 *   8. Render subject/body
 *   9. Send via provider
 *   10. Record audit (success on send, failure on error)
 */
import type { Pool } from "pg";
import { getBoardPeriod } from "../board/get-board-period";
import { getBoardExecutiveDashboard } from "../board/get-board-executive-dashboard";
import { generateMonthlyDeckV2, deckFilenameV2 } from "../deck/generate-monthly-deck-v2";
import { getDistributionList } from "./get-distribution-list";
import { renderBoardDeckEmail } from "./render-board-deck-email";
import { recordBoardDeckSend } from "./record-board-deck-send";
import { findRecentSuccessfulSend } from "./list-board-deck-sends";
import type {
  BoardEmailProvider,
} from "../email/board-email-provider";
import {
  ProviderNotConfiguredError,
  EmailSendError,
} from "../email/board-email-provider";

// ---------------------------------------------------------------------------
// Typed errors. Each maps cleanly to an HTTP status in the route handler.
// ---------------------------------------------------------------------------

export class InvalidSendInputError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "InvalidSendInputError";
    this.code = code;
  }
}
export class PeriodNotFoundError extends Error {
  constructor() { super("Board period not found"); this.name = "PeriodNotFoundError"; }
}
export class PeriodNotReadyError extends Error {
  readonly blockers: string[];
  constructor(blockers: string[]) {
    super(`Period not board-ready: ${blockers.join(", ") || "unknown"}`);
    this.name = "PeriodNotReadyError";
    this.blockers = blockers;
  }
}
export class DistributionListNotFoundError extends Error {
  constructor() { super("Distribution list not found"); this.name = "DistributionListNotFoundError"; }
}
export class NoActiveRecipientsError extends Error {
  constructor() { super("Distribution list has no active TO recipients"); this.name = "NoActiveRecipientsError"; }
}
export class RecentSendExistsError extends Error {
  readonly lastSentAt: string;
  readonly lastSentBy: string;
  constructor(lastSentAt: string, lastSentBy: string) {
    super(`Recent send exists at ${lastSentAt} by ${lastSentBy}`);
    this.name = "RecentSendExistsError";
    this.lastSentAt = lastSentAt;
    this.lastSentBy = lastSentBy;
  }
}

// ---------------------------------------------------------------------------

export type SendBoardDeckInput = {
  year: number;
  month: number;
  distributionListId: number;
  sentBy: string;
  subjectOverride?: string;
  message?: string;
  confirmResend?: boolean;
};

export type SendBoardDeckSuccess = {
  ok: true;
  send_id: number;
  provider: string;
  provider_message_id: string | null;
  subject: string;
  sent_to_count: number;
  cc_count: number;
  bcc_count: number;
  deck_filename: string;
};

export type SendBoardDeckDeps = {
  pool: Pool;
  emailProvider: BoardEmailProvider;
};

export async function sendBoardDeck(
  deps: SendBoardDeckDeps,
  input: SendBoardDeckInput
): Promise<SendBoardDeckSuccess> {
  // ---- Input validation ----
  if (!Number.isInteger(input.year) || input.year < 2020 || input.year > 2100) {
    throw new InvalidSendInputError("invalid_year", `Invalid year ${input.year}`);
  }
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    throw new InvalidSendInputError("invalid_month", `Invalid month ${input.month}`);
  }
  if (!Number.isInteger(input.distributionListId) || input.distributionListId <= 0) {
    throw new InvalidSendInputError(
      "invalid_distribution_list_id",
      `Invalid distribution_list_id ${input.distributionListId}`
    );
  }
  if (!input.sentBy || input.sentBy.trim().length === 0) {
    throw new InvalidSendInputError("sent_by_required", "sent_by is required");
  }

  // ---- 1. Load board period ----
  const board = await getBoardPeriod(deps.pool, input.year, input.month);
  if (!board.period.status) {
    // getBoardPeriod returns null status when no board_periods row exists.
    throw new PeriodNotFoundError();
  }
  if (!board.readiness.ready || board.period.status !== "locked") {
    throw new PeriodNotReadyError(board.readiness.blockers);
  }

  // ---- 2. Load distribution list ----
  const list = await getDistributionList(deps.pool, input.distributionListId);
  if (!list) throw new DistributionListNotFoundError();
  if (!list.is_active) {
    throw new InvalidSendInputError(
      "distribution_list_inactive",
      `Distribution list ${list.list_id} is not active`
    );
  }

  // ---- 3. Filter active recipients ----
  const activeTo = list.recipients.filter((r) => r.is_active && r.recipient_type === "to").map((r) => r.email);
  const activeCc = list.recipients.filter((r) => r.is_active && r.recipient_type === "cc").map((r) => r.email);
  const activeBcc = list.recipients.filter((r) => r.is_active && r.recipient_type === "bcc").map((r) => r.email);
  if (activeTo.length === 0) throw new NoActiveRecipientsError();

  // ---- 4. Duplicate-send guard (within 24h) ----
  if (!input.confirmResend) {
    const recent = await findRecentSuccessfulSend(
      deps.pool, input.year, input.month, list.list_id, 24
    );
    if (recent) {
      throw new RecentSendExistsError(recent.sent_at, recent.sent_by);
    }
  }

  // ---- 5. Generate the deck (v2). From here on, failures are audited. ----
  // Load the full executive dashboard (incl. finance overlay) that the v2
  // generator needs. Same period the readiness gate above already passed, so
  // generateMonthlyDeckV2's own locked/ready guard will pass too. This keeps
  // the emailed deck identical to the one the /api/admin/deck download serves.
  const view = await getBoardExecutiveDashboard(deps.pool, input.year, input.month);
  const filename = deckFilenameV2(view);
  let buffer: Buffer;
  try {
    buffer = await generateMonthlyDeckV2(view);
  } catch (err) {
    // The generator itself has a readiness gate that we already passed,
    // so this is a real generator failure. Audit + rethrow.
    await safeAuditFailure(deps.pool, board, list.list_id, input, filename,
      deps.emailProvider.name,
      `deck_generation_failed: ${err instanceof Error ? err.message : "unknown"}`,
      activeTo, activeCc, activeBcc.length);
    throw err;
  }

  // ---- 6. Render the email ----
  const email = renderBoardDeckEmail(board, {
    subjectOverride: input.subjectOverride,
    message: input.message,
  });

  // ---- 7. Send via provider ----
  let providerResult;
  try {
    providerResult = await deps.emailProvider.sendEmail({
      to: activeTo,
      cc: activeCc.length > 0 ? activeCc : undefined,
      bcc: activeBcc.length > 0 ? activeBcc : undefined,
      subject: email.subject,
      htmlBody: email.htmlBody,
      textBody: email.textBody,
      attachments: [{
        filename,
        contentType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        content: buffer,
      }],
    });
  } catch (err) {
    const code = err instanceof ProviderNotConfiguredError
      ? "provider_not_configured"
      : err instanceof EmailSendError
      ? "provider_send_failed"
      : "provider_error";
    const msg = err instanceof Error ? err.message : "unknown provider error";
    await safeAuditFailure(deps.pool, board, list.list_id, input, filename,
      deps.emailProvider.name, `${code}: ${msg}`,
      activeTo, activeCc, activeBcc.length);
    // Rethrow so the route maps to the right HTTP status.
    throw err;
  }

  // ---- 8. Record audit on success ----
  const audit = await recordBoardDeckSend(deps.pool, {
    period_year: input.year,
    period_month: input.month,
    file_id: board.activeFile?.file_id ?? null,
    version_no: board.activeFile?.version_no ?? null,
    deck_filename: filename,
    distribution_list_id: list.list_id,
    sent_by: input.sentBy.trim(),
    provider: providerResult.provider,
    provider_message_id: providerResult.providerMessageId,
    subject: email.subject,
    to_emails: activeTo,
    cc_emails: activeCc,
    bcc_count: activeBcc.length,
    status: "sent",
    error_message: null,
    metadata: {
      confirm_resend: !!input.confirmResend,
      list_name: list.name,
    },
  });

  return {
    ok: true,
    send_id: audit.send_id,
    provider: providerResult.provider,
    provider_message_id: providerResult.providerMessageId,
    subject: email.subject,
    sent_to_count: activeTo.length,
    cc_count: activeCc.length,
    bcc_count: activeBcc.length,
    deck_filename: filename,
  };
}

/**
 * Wrap the audit insert in a try/catch so a failed audit cannot
 * shadow the original failure cause. Logged but never thrown.
 */
async function safeAuditFailure(
  pool: Pool,
  board: Awaited<ReturnType<typeof getBoardPeriod>>,
  listId: number,
  input: SendBoardDeckInput,
  filename: string,
  providerName: string,
  errorMessage: string,
  toEmails: string[],
  ccEmails: string[],
  bccCount: number
): Promise<void> {
  try {
    await recordBoardDeckSend(pool, {
      period_year: input.year,
      period_month: input.month,
      file_id: board.activeFile?.file_id ?? null,
      version_no: board.activeFile?.version_no ?? null,
      deck_filename: filename,
      distribution_list_id: listId,
      sent_by: input.sentBy.trim(),
      provider: providerName || "unknown",
      provider_message_id: null,
      subject: `U1D Monthly Board Report — ${board.period.label}`,
      to_emails: toEmails,
      cc_emails: ccEmails,
      bcc_count: bccCount,
      status: "failed",
      error_message: errorMessage,
      metadata: { confirm_resend: !!input.confirmResend },
    });
  } catch (auditErr) {
    console.error("[send-board-deck] audit insert failed:", auditErr);
  }
}
