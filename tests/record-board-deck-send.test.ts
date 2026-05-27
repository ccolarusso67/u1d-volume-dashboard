/**
 * tests/record-board-deck-send.test.ts
 *
 * PR 004D — board_deck_sends audit insert.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TestPool } from "./test-pool";
import { recordBoardDeckSend } from "../src/lib/distribution/record-board-deck-send";

function makePool(returnRow: Record<string, unknown> = {}) {
  return new TestPool({
    responders: [
      (t) =>
        t.includes("INSERT INTO u1d_ops.board_deck_sends")
          ? {
              rows: [{
                send_id: 1, period_year: 2026, period_month: 5,
                file_id: 1001, version_no: 3,
                deck_filename: "U1D_Board_Report_2026_05.pptx",
                distribution_list_id: 1,
                sent_at: new Date("2026-05-30T16:00:00Z"),
                sent_by: "admin@x",
                provider: "noop_console",
                provider_message_id: "abc",
                subject: "U1D Monthly Board Report — May 2026",
                to_emails: ["board@x"], cc_emails: [], bcc_count: 0,
                status: "sent", error_message: null, metadata: {},
                ...returnRow,
              }],
            }
          : null,
    ],
  });
}

const VALID_INPUT = {
  period_year: 2026,
  period_month: 5,
  file_id: 1001,
  version_no: 3,
  deck_filename: "U1D_Board_Report_2026_05.pptx",
  distribution_list_id: 1,
  sent_by: "admin@x",
  provider: "noop_console",
  provider_message_id: "abc",
  subject: "U1D Monthly Board Report — May 2026",
  to_emails: ["board@x"],
  cc_emails: [] as string[],
  bcc_count: 0,
  status: "sent" as const,
};

test("recordBoardDeckSend: writes a 'sent' row and returns the inserted record", async () => {
  const pool = makePool();
  const rec = await recordBoardDeckSend(pool as unknown as import("pg").Pool, VALID_INPUT);
  assert.equal(rec.send_id, 1);
  assert.equal(rec.status, "sent");
  assert.equal(rec.sent_at, "2026-05-30T16:00:00.000Z");

  const ins = pool.findQuery("INSERT INTO u1d_ops.board_deck_sends");
  assert.ok(ins, "INSERT must run");
  assert.equal(ins?.params?.[0], 2026);   // period_year
  assert.equal(ins?.params?.[1], 5);      // period_month
  assert.equal(ins?.params?.[2], 1001);   // file_id
  assert.equal(ins?.params?.[3], 3);      // version_no
  assert.equal(ins?.params?.[13], "sent");// status
  assert.deepEqual(ins?.params?.[10], ["board@x"]); // to_emails
});

test("recordBoardDeckSend: writes a 'failed' row with error_message", async () => {
  const pool = makePool({ status: "failed", error_message: "boom", provider_message_id: null });
  const rec = await recordBoardDeckSend(pool as unknown as import("pg").Pool, {
    ...VALID_INPUT, status: "failed", error_message: "boom", provider_message_id: null,
  });
  assert.equal(rec.status, "failed");
  assert.equal(rec.error_message, "boom");
});

test("recordBoardDeckSend: stores period + file + version + deck filename + recipient counts", async () => {
  const pool = makePool();
  await recordBoardDeckSend(pool as unknown as import("pg").Pool, {
    ...VALID_INPUT,
    to_emails: ["a@x", "b@x", "c@x"],
    cc_emails: ["d@x"],
    bcc_count: 2,
  });
  const ins = pool.findQuery("INSERT INTO u1d_ops.board_deck_sends");
  assert.equal(ins?.params?.[4], "U1D_Board_Report_2026_05.pptx");
  assert.deepEqual(ins?.params?.[10], ["a@x", "b@x", "c@x"]);
  assert.deepEqual(ins?.params?.[11], ["d@x"]);
  assert.equal(ins?.params?.[12], 2);
});

test("recordBoardDeckSend: rejects invalid period_year", async () => {
  const pool = makePool();
  await assert.rejects(
    () => recordBoardDeckSend(pool as unknown as import("pg").Pool, { ...VALID_INPUT, period_year: 1999 }),
    /invalid_period_year/
  );
  assert.equal(pool.queries.length, 0);
});

test("recordBoardDeckSend: rejects invalid period_month", async () => {
  const pool = makePool();
  await assert.rejects(
    () => recordBoardDeckSend(pool as unknown as import("pg").Pool, { ...VALID_INPUT, period_month: 13 }),
    /invalid_period_month/
  );
});

test("recordBoardDeckSend: rejects empty sent_by", async () => {
  const pool = makePool();
  await assert.rejects(
    () => recordBoardDeckSend(pool as unknown as import("pg").Pool, { ...VALID_INPUT, sent_by: "  " }),
    /sent_by_required/
  );
});

test("recordBoardDeckSend: rejects empty provider", async () => {
  const pool = makePool();
  await assert.rejects(
    () => recordBoardDeckSend(pool as unknown as import("pg").Pool, { ...VALID_INPUT, provider: "" }),
    /provider_required/
  );
});

test("recordBoardDeckSend: rejects unknown status", async () => {
  const pool = makePool();
  await assert.rejects(
    // @ts-expect-error — deliberately wrong literal
    () => recordBoardDeckSend(pool as unknown as import("pg").Pool, { ...VALID_INPUT, status: "delivered" }),
    /invalid_status/
  );
});

test("recordBoardDeckSend: rejects negative bcc_count", async () => {
  const pool = makePool();
  await assert.rejects(
    () => recordBoardDeckSend(pool as unknown as import("pg").Pool, { ...VALID_INPUT, bcc_count: -1 }),
    /invalid_bcc_count/
  );
});

test("recordBoardDeckSend: serializes metadata to JSON", async () => {
  const pool = makePool();
  await recordBoardDeckSend(pool as unknown as import("pg").Pool, {
    ...VALID_INPUT, metadata: { confirm_resend: true, list_name: "Board Distribution" },
  });
  const ins = pool.findQuery("INSERT INTO u1d_ops.board_deck_sends");
  const m = ins?.params?.[15] as string;
  assert.equal(typeof m, "string");
  assert.deepEqual(JSON.parse(m), { confirm_resend: true, list_name: "Board Distribution" });
});
