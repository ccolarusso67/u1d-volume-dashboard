/**
 * tests/send-board-deck.test.ts
 *
 * PR 004D — sendBoardDeck orchestrator.
 *
 * Strategy:
 *   - Stub the pool with TestPool, responding to every query the
 *     orchestrator touches (board period via getBoardPeriod, distribution
 *     list, recent-send guard, insert audit row).
 *   - Stub the email provider so tests don't actually send mail.
 *   - Use the BoardPeriodView path by patterning responders on the SQL
 *     fragments the underlying helpers use.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TestPool } from "./test-pool";
import {
  sendBoardDeck,
  PeriodNotReadyError,
  PeriodNotFoundError,
  DistributionListNotFoundError,
  NoActiveRecipientsError,
  RecentSendExistsError,
  InvalidSendInputError,
} from "../src/lib/distribution/send-board-deck";
import { ProviderNotConfiguredError } from "../src/lib/email/board-email-provider";
import type { BoardEmailProvider, SendEmailInput, SendEmailResult } from "../src/lib/email/board-email-provider";

// ---------------------------------------------------------------------------
// Stub provider
// ---------------------------------------------------------------------------

class StubProvider implements BoardEmailProvider {
  readonly name = "stub";
  public sent: SendEmailInput[] = [];
  public shouldFail = false;
  public failWith: Error = new Error("stub error");
  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    if (this.shouldFail) throw this.failWith;
    this.sent.push(input);
    return { provider: this.name, providerMessageId: `stub-${this.sent.length}` };
  }
}

// ---------------------------------------------------------------------------
// Pool builder — bundles responders for ALL queries the orchestrator touches.
// ---------------------------------------------------------------------------

const COMPLETE_NOTES_ROW = {
  capacity_md: "ok", supply_chain_md: "ok", quality_md: "ok",
  initiatives_md: "ok", risks_md: "ok",
  completed_at: new Date("2026-05-30T00:00:00Z"),
  completed_by: "x", updated_at: new Date(), updated_by: "x",
};

type BuildOpts = {
  // getBoardPeriod
  periodMissing?: boolean;
  periodStatus?: string;
  activeFileMissing?: boolean;
  pendingAlerts?: number;
  notesIncomplete?: boolean;
  // distribution list
  listMissing?: boolean;
  listInactive?: boolean;
  noActiveTo?: boolean;
  // duplicate-send guard
  recentSendExists?: boolean;
  // audit insert
  auditFails?: boolean;
};

function buildPool(opts: BuildOpts = {}): TestPool {
  const listRow = opts.listMissing
    ? null
    : { list_id: 1, name: "Board Distribution", description: "x", is_active: !opts.listInactive };

  const recipients = opts.noActiveTo
    ? [{ recipient_id: 1, email: "cc@x", display_name: "CC", recipient_type: "cc", is_active: true }]
    : [
        { recipient_id: 10, email: "board@x", display_name: "B", recipient_type: "to",  is_active: true },
        { recipient_id: 11, email: "ops@x",   display_name: "O", recipient_type: "cc",  is_active: true },
        { recipient_id: 12, email: "audit@x", display_name: "A", recipient_type: "bcc", is_active: true },
      ];

  return new TestPool({
    responders: [
      // ----- getBoardPeriod responders (matches PR 004A queries) -----
      // board_periods
      (t) =>
        t.includes("FROM u1d_ops.board_periods\n   WHERE period_year")
          ? {
              rows: opts.periodMissing
                ? []
                : [{
                    status: opts.periodStatus ?? "locked",
                    locked_at: new Date("2026-05-30T15:00:00Z"),
                    locked_by: "carmine@x",
                  }],
            }
          : null,
      // active file
      (t) =>
        t.includes("AND is_active = TRUE\n   LIMIT 1")
          ? {
              rows: opts.activeFileMissing
                ? []
                : [{
                    file_id: 1001, filename: "U1DYNAMICS_VOLUME_2026_05.xlsx",
                    file_hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
                    version_no: 3,
                    uploaded_at: new Date("2026-05-26T15:30:00Z"),
                    uploaded_by: "carmine@x",
                    source_total_row: 175319, computed_customer_sum: 175319,
                    has_total_discrepancy: false, discrepancy_amount: null,
                  }],
            }
          : null,
      // operator notes
      (t) =>
        t.includes("FROM u1d_ops.monthly_operator_notes")
          ? {
              rows: opts.notesIncomplete
                ? [{ ...COMPLETE_NOTES_ROW, risks_md: null, completed_at: null, completed_by: null }]
                : [COMPLETE_NOTES_ROW],
            }
          : null,
      // lock events
      (t) =>
        t.includes("FROM u1d_ops.period_lock_events")
          ? { rows: [] }
          : null,
      // alert counts
      (t) =>
        t.includes("AS package_total")
          ? {
              rows: [{
                package_total: 0, customer_total: 0, dq_total: 0,
                pending_total: opts.pendingAlerts ?? 0,
                resolved_total: 0,
              }],
            }
          : null,
      // top customers / packages / prior aggregates - empty for tests
      (t) => (t.includes("GROUP BY vf.customer_key, c.display_name") ? { rows: [] } : null),
      (t) => (t.includes("GROUP BY vf.package_key, p.display_name") ? { rows: [] } : null),
      (t) => (t.includes("GROUP BY vf.customer_key") && !t.includes("c.display_name") ? { rows: [] } : null),
      (t) => (t.includes("GROUP BY vf.package_key") && !t.includes("p.display_name") ? { rows: [] } : null),
      (t, p) => {
        if (!t.includes("COUNT(DISTINCT vf.customer_key)")) return null;
        return { rows: [{ total_gallons: 175319, customer_count: 5, package_count: 12, fact_row_count: 50 }] };
      },
      // YTD months-in-year + 12-month trend (exec dashboard, v2 deck path).
      // Empty rows are fine — the deck renders with no trend bars.
      (t) => (t.includes("GROUP BY file.period_year, file.period_month") ? { rows: [] } : null),
      (t) => (t.includes("period_pairs") ? { rows: [] } : null),
      // ----- distribution list responders -----
      (t) =>
        t.includes("FROM u1d_ops.board_distribution_lists\n      WHERE list_id")
          ? { rows: listRow === null ? [] : [listRow] }
          : null,
      (t) =>
        t.includes("FROM u1d_ops.board_distribution_recipients\n      WHERE list_id")
          ? { rows: recipients }
          : null,
      // ----- duplicate-send guard -----
      (t) =>
        t.includes("FROM u1d_ops.board_deck_sends\n      WHERE period_year")
          ? {
              rows: opts.recentSendExists
                ? [{
                    send_id: 99,
                    sent_at: new Date("2026-05-30T15:00:00Z"),
                    sent_by: "carmine@x",
                  }]
                : [],
            }
          : null,
      // ----- audit insert -----
      (t) => {
        if (!t.includes("INSERT INTO u1d_ops.board_deck_sends")) return null;
        if (opts.auditFails) throw new Error("audit insert failed");
        return {
          rows: [{
            send_id: 1,
            period_year: 2026, period_month: 5,
            file_id: 1001, version_no: 3,
            deck_filename: "U1D_Board_Report_2026_05.pptx",
            distribution_list_id: 1,
            sent_at: new Date("2026-05-30T16:00:00Z"),
            sent_by: "admin@x", provider: "stub",
            provider_message_id: "stub-1",
            subject: "U1D Monthly Board Report — May 2026",
            to_emails: ["board@x"], cc_emails: ["ops@x"], bcc_count: 1,
            status: "sent", error_message: null, metadata: {},
          }],
        };
      },
    ],
  });
}

const STD_INPUT = {
  year: 2026, month: 5, distributionListId: 1, sentBy: "admin@x",
};

// ---------------------------------------------------------------------------

test("sendBoardDeck: happy path → audit row + email sent with attachment", async () => {
  const pool = buildPool();
  const provider = new StubProvider();
  const r = await sendBoardDeck({ pool: pool as unknown as import("pg").Pool, emailProvider: provider }, STD_INPUT);

  assert.equal(r.ok, true);
  assert.equal(r.provider, "stub");
  assert.equal(r.sent_to_count, 1);
  assert.equal(r.cc_count, 1);
  assert.equal(r.bcc_count, 1);
  assert.equal(r.deck_filename, "U1Dynamics_Board_Report_2026_05.pptx");

  // Provider received the right shape.
  assert.equal(provider.sent.length, 1);
  assert.deepEqual(provider.sent[0].to, ["board@x"]);
  assert.deepEqual(provider.sent[0].cc, ["ops@x"]);
  assert.deepEqual(provider.sent[0].bcc, ["audit@x"]);
  assert.equal(provider.sent[0].attachments.length, 1);
  assert.equal(provider.sent[0].attachments[0].filename, "U1Dynamics_Board_Report_2026_05.pptx");
  assert.ok(provider.sent[0].attachments[0].content.byteLength > 5000, "attachment is a real pptx");

  // Audit insert happened.
  const ins = pool.findQuery("INSERT INTO u1d_ops.board_deck_sends");
  assert.ok(ins);
  assert.equal(ins?.params?.[13], "sent");
});

test("sendBoardDeck: period not ready → PeriodNotReadyError, no audit, no email", async () => {
  const pool = buildPool({ notesIncomplete: true });
  const provider = new StubProvider();
  await assert.rejects(
    () => sendBoardDeck({ pool: pool as unknown as import("pg").Pool, emailProvider: provider }, STD_INPUT),
    PeriodNotReadyError
  );
  assert.equal(provider.sent.length, 0);
  assert.equal(pool.findQuery("INSERT INTO u1d_ops.board_deck_sends"), undefined);
});

test("sendBoardDeck: period missing → PeriodNotFoundError", async () => {
  const pool = buildPool({ periodMissing: true });
  const provider = new StubProvider();
  await assert.rejects(
    () => sendBoardDeck({ pool: pool as unknown as import("pg").Pool, emailProvider: provider }, STD_INPUT),
    PeriodNotFoundError
  );
});

test("sendBoardDeck: period status != 'locked' → PeriodNotReadyError", async () => {
  const pool = buildPool({ periodStatus: "in_review" });
  const provider = new StubProvider();
  await assert.rejects(
    () => sendBoardDeck({ pool: pool as unknown as import("pg").Pool, emailProvider: provider }, STD_INPUT),
    PeriodNotReadyError
  );
});

test("sendBoardDeck: distribution list missing → DistributionListNotFoundError", async () => {
  const pool = buildPool({ listMissing: true });
  const provider = new StubProvider();
  await assert.rejects(
    () => sendBoardDeck({ pool: pool as unknown as import("pg").Pool, emailProvider: provider }, STD_INPUT),
    DistributionListNotFoundError
  );
  assert.equal(provider.sent.length, 0);
});

test("sendBoardDeck: distribution list inactive → InvalidSendInputError code 'distribution_list_inactive'", async () => {
  const pool = buildPool({ listInactive: true });
  const provider = new StubProvider();
  await assert.rejects(
    () => sendBoardDeck({ pool: pool as unknown as import("pg").Pool, emailProvider: provider }, STD_INPUT),
    (err: unknown) => {
      assert.ok(err instanceof InvalidSendInputError);
      assert.equal((err as InvalidSendInputError).code, "distribution_list_inactive");
      return true;
    }
  );
});

test("sendBoardDeck: no active TO recipients → NoActiveRecipientsError, no email", async () => {
  const pool = buildPool({ noActiveTo: true });
  const provider = new StubProvider();
  await assert.rejects(
    () => sendBoardDeck({ pool: pool as unknown as import("pg").Pool, emailProvider: provider }, STD_INPUT),
    NoActiveRecipientsError
  );
  assert.equal(provider.sent.length, 0);
});

test("sendBoardDeck: recent send exists → RecentSendExistsError (without confirmResend)", async () => {
  const pool = buildPool({ recentSendExists: true });
  const provider = new StubProvider();
  await assert.rejects(
    () => sendBoardDeck({ pool: pool as unknown as import("pg").Pool, emailProvider: provider }, STD_INPUT),
    (err: unknown) => {
      assert.ok(err instanceof RecentSendExistsError);
      assert.equal((err as RecentSendExistsError).lastSentAt, "2026-05-30T15:00:00.000Z");
      return true;
    }
  );
  // Provider must not have been called.
  assert.equal(provider.sent.length, 0);
});

test("sendBoardDeck: recent send + confirmResend=true → bypass guard, send + audit", async () => {
  const pool = buildPool({ recentSendExists: true });
  const provider = new StubProvider();
  const r = await sendBoardDeck(
    { pool: pool as unknown as import("pg").Pool, emailProvider: provider },
    { ...STD_INPUT, confirmResend: true }
  );
  assert.equal(r.ok, true);
  assert.equal(provider.sent.length, 1);
});

test("sendBoardDeck: provider failure → audit 'failed' row + rethrow", async () => {
  const pool = buildPool();
  const provider = new StubProvider();
  provider.shouldFail = true;
  provider.failWith = new ProviderNotConfiguredError("not configured");
  await assert.rejects(
    () => sendBoardDeck({ pool: pool as unknown as import("pg").Pool, emailProvider: provider }, STD_INPUT),
    ProviderNotConfiguredError
  );
  const inserts = pool.findQueries("INSERT INTO u1d_ops.board_deck_sends");
  assert.equal(inserts.length, 1, "exactly one audit row written on failure");
  assert.equal(inserts[0].params?.[13], "failed", "status = failed");
  assert.ok(
    String(inserts[0].params?.[14]).includes("provider_not_configured"),
    "error_message captures provider error code"
  );
});

test("sendBoardDeck: invalid input fails fast without DB calls", async () => {
  const pool = buildPool();
  const provider = new StubProvider();
  for (const bad of [
    { ...STD_INPUT, year: 1999 },
    { ...STD_INPUT, month: 13 },
    { ...STD_INPUT, distributionListId: 0 },
    { ...STD_INPUT, sentBy: "" },
  ]) {
    await assert.rejects(
      () => sendBoardDeck({ pool: pool as unknown as import("pg").Pool, emailProvider: provider }, bad),
      InvalidSendInputError
    );
  }
  assert.equal(provider.sent.length, 0);
  // The validation runs before any DB query.
  assert.equal(pool.queries.length, 0);
});
