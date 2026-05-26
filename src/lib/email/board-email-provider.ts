/**
 * src/lib/email/board-email-provider.ts
 *
 * PR 004D — Email provider abstraction for board deck distribution.
 *
 * Why an interface instead of a hard dependency on Resend/SendGrid/Graph:
 *   - The choice of email provider is an operational decision per deployment.
 *   - The send orchestrator + audit logic must be testable without any
 *     real email infrastructure (we inject a stub provider in tests).
 *   - When the org standardizes on a provider, add a concrete impl that
 *     ships its own env-var contract; the orchestrator does not change.
 *
 * This PR ships:
 *   - The interface
 *   - A typed error for unconfigured providers
 *   - Two reference implementations:
 *       1. NoopConsoleProvider — logs the attempt and returns success.
 *          Lets the rest of the workflow be exercised end-to-end in dev
 *          without sending real mail.
 *       2. UnconfiguredProvider — throws ProviderNotConfiguredError on
 *          every send. Returned by getBoardEmailProvider() when the
 *          deployment hasn't picked a provider yet.
 *
 * Production providers (Resend / Graph) are deferred to a follow-up PR
 * so this PR can ship the end-to-end workflow + audit trail cleanly.
 */

export type EmailAttachment = {
  filename: string;
  contentType: string;
  content: Buffer;
};

export type SendEmailInput = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  htmlBody: string;
  textBody: string;
  attachments: EmailAttachment[];
};

export type SendEmailResult = {
  provider: string;
  providerMessageId: string | null;
};

export interface BoardEmailProvider {
  /** Provider name written to audit (`board_deck_sends.provider`). */
  readonly name: string;
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ProviderNotConfiguredError extends Error {
  constructor(message: string = "Email provider is not configured") {
    super(message);
    this.name = "ProviderNotConfiguredError";
  }
}

export class EmailSendError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "EmailSendError";
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Reference implementations
// ---------------------------------------------------------------------------

/**
 * Returns success without sending a real email. Logs the attempt to
 * stdout so dev runs can inspect what would have gone out. Useful for
 * local development and for integration tests that exercise the full
 * orchestrator + audit path.
 *
 * Selected by setting BOARD_EMAIL_PROVIDER=noop (the default in this PR).
 */
export class NoopConsoleProvider implements BoardEmailProvider {
  readonly name = "noop_console";
  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    // eslint-disable-next-line no-console
    console.log(
      `[email:noop] would send "${input.subject}" to ${input.to.length} ` +
      `to / ${input.cc?.length ?? 0} cc / ${input.bcc?.length ?? 0} bcc · ` +
      `attachments: ${input.attachments.map((a) => `${a.filename}(${a.content.byteLength}B)`).join(", ")}`
    );
    return {
      provider: this.name,
      providerMessageId: `noop-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    };
  }
}

/**
 * Throws on every send. Used when no real provider is configured to
 * surface a clean 503 from the API route rather than letting the call
 * silently succeed.
 */
export class UnconfiguredProvider implements BoardEmailProvider {
  readonly name = "unconfigured";
  async sendEmail(): Promise<SendEmailResult> {
    throw new ProviderNotConfiguredError(
      "No email provider is configured. Set BOARD_EMAIL_PROVIDER to 'noop' for dev " +
      "or wire a real implementation (Resend/SendGrid/Microsoft Graph) in a follow-up PR."
    );
  }
}

/**
 * Pick a provider based on env. Today only "noop" is implemented; any
 * other value (or absent value) returns UnconfiguredProvider so the
 * orchestrator can return a 503.
 */
export function getBoardEmailProvider(): BoardEmailProvider {
  const choice = (process.env.BOARD_EMAIL_PROVIDER ?? "").toLowerCase().trim();
  if (choice === "noop") return new NoopConsoleProvider();
  return new UnconfiguredProvider();
}
