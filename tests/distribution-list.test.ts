/**
 * tests/distribution-list.test.ts
 *
 * PR 004D — distribution list read helpers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TestPool } from "./test-pool";
import { getDistributionList } from "../src/lib/distribution/get-distribution-list";
import { listDistributionLists } from "../src/lib/distribution/list-distribution-lists";

const LIST_ROW = {
  list_id: 1, name: "Board Distribution",
  description: "default", is_active: true,
};

const RECIPIENTS = [
  { recipient_id: 10, email: "board@x", display_name: "Board Chair", recipient_type: "to", is_active: true },
  { recipient_id: 11, email: "cfo@x",   display_name: "CFO",         recipient_type: "to", is_active: true },
  { recipient_id: 12, email: "ops@x",   display_name: "Ops",         recipient_type: "cc", is_active: true },
  { recipient_id: 13, email: "audit@x", display_name: "Audit",       recipient_type: "bcc",is_active: true },
  { recipient_id: 14, email: "old@x",   display_name: null,           recipient_type: "to", is_active: false },
];

function makePool(opts: { list?: typeof LIST_ROW | null; recipients?: typeof RECIPIENTS } = {}) {
  const list = opts.list === undefined ? LIST_ROW : opts.list;
  const recipients = opts.recipients ?? RECIPIENTS;
  return new TestPool({
    responders: [
      (t) =>
        t.includes("FROM u1d_ops.board_distribution_lists\n      WHERE list_id")
          ? { rows: list === null ? [] : [list] }
          : null,
      (t) =>
        t.includes("FROM u1d_ops.board_distribution_recipients\n      WHERE list_id")
          ? { rows: recipients }
          : null,
    ],
  });
}

test("getDistributionList: returns list with grouped recipient counts", async () => {
  const pool = makePool();
  const l = await getDistributionList(pool as unknown as import("pg").Pool, 1);
  assert.ok(l);
  assert.equal(l!.name, "Board Distribution");
  assert.equal(l!.is_active, true);
  assert.equal(l!.recipients.length, 5);
  assert.equal(l!.active_to_count, 2, "2 active to recipients (old@x is inactive)");
  assert.equal(l!.active_cc_count, 1);
  assert.equal(l!.active_bcc_count, 1);
});

test("getDistributionList: missing list returns null", async () => {
  const pool = makePool({ list: null });
  const l = await getDistributionList(pool as unknown as import("pg").Pool, 9999);
  assert.equal(l, null);
});

test("getDistributionList: inactive list returns the row (caller decides)", async () => {
  const pool = makePool({ list: { ...LIST_ROW, is_active: false } });
  const l = await getDistributionList(pool as unknown as import("pg").Pool, 1);
  assert.ok(l);
  assert.equal(l!.is_active, false);
});

test("getDistributionList: list with no recipients returns empty arrays + zero counts", async () => {
  const pool = makePool({ recipients: [] });
  const l = await getDistributionList(pool as unknown as import("pg").Pool, 1);
  assert.equal(l!.recipients.length, 0);
  assert.equal(l!.active_to_count, 0);
  assert.equal(l!.active_cc_count, 0);
  assert.equal(l!.active_bcc_count, 0);
});

test("getDistributionList: invalid listId throws", async () => {
  const pool = makePool();
  await assert.rejects(
    () => getDistributionList(pool as unknown as import("pg").Pool, 0),
    /invalid listId/
  );
  await assert.rejects(
    () => getDistributionList(pool as unknown as import("pg").Pool, -1),
    /invalid listId/
  );
});

test("listDistributionLists: returns rows ordered active-first then name", async () => {
  const pool = new TestPool({
    responders: [
      (t) =>
        t.includes("FROM u1d_ops.board_distribution_lists bdl")
          ? {
              rows: [
                { list_id: 1, name: "Board Distribution", description: "x", is_active: true,
                  active_to_count: 3, active_cc_count: 1, active_bcc_count: 0 },
                { list_id: 2, name: "Internal Review",     description: null, is_active: true,
                  active_to_count: 5, active_cc_count: 0, active_bcc_count: 0 },
              ],
            }
          : null,
    ],
  });
  const out = await listDistributionLists(pool as unknown as import("pg").Pool);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, "Board Distribution");
  assert.equal(out[0].active_to_count, 3);
});
