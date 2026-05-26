/**
 * tests/require-admin.test.ts
 *
 * PR 003B — auth gate on mutation routes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { requireAdminSession } from "../src/lib/auth/require-admin";

test("requireAdminSession: null session → 401", async () => {
  const r = await requireAdminSession(async () => null);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "unauthenticated");
  }
});

test("requireAdminSession: session without user → 401", async () => {
  // @ts-expect-error — partial session for test
  const r = await requireAdminSession(async () => ({ expires: "x" }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 401);
});

test("requireAdminSession: viewer role → 403", async () => {
  const r = await requireAdminSession(async () => ({
    user: { email: "viewer@ultra1plus.com", role: "viewer", isAdmin: false },
    expires: "2099-01-01",
  }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "forbidden");
  }
});

test("requireAdminSession: isAdmin true → ok", async () => {
  const r = await requireAdminSession(async () => ({
    user: { email: "admin@ultra1plus.com", role: "admin", isAdmin: true },
    expires: "2099-01-01",
  }));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.session.user!.email, "admin@ultra1plus.com");
  }
});

test("requireAdminSession: missing isAdmin flag → 403 (treated as not admin)", async () => {
  const r = await requireAdminSession(async () => ({
    user: { email: "x@y.com" },
    expires: "2099-01-01",
  }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 403);
});

test("requireAdminSession: getSession throws → 401 (safe default)", async () => {
  const r = await requireAdminSession(async () => {
    throw new Error("DB down");
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 401);
});
