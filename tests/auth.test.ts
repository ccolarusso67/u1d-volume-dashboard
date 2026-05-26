/**
 * tests/auth.test.ts
 *
 * PR 003A — Allowlist behaviour tests.
 *
 * The isEmailAllowed() helper is the gate between Google sign-in and the
 * admin surface. These tests prove the gate behaves correctly without
 * depending on a real Postgres connection — we inject a stub queryOne.
 *
 * Coverage rationale: every code path through isEmailAllowed has a test,
 * including the case where the DB throws (caller is expected to translate
 * that into a denied sign-in; the helper itself just propagates).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isEmailAllowed } from "../src/lib/auth/allowlist";

type UsersRow = {
  email: string;
  role: string;
  is_active: boolean;
};

/**
 * Build a stub queryOne backed by an in-memory user table.
 *
 * The cast to the generic shape is intentional: we control both the SQL
 * (constant in allowlist.ts) and the seeded fixtures, so the row shape is
 * known at call sites.
 */
function makeStub(rows: UsersRow[]) {
  const byEmail = new Map(rows.map((r) => [r.email.toLowerCase(), r]));
  return async function stub<T>(_text: string, params?: unknown[]): Promise<T | null> {
    const lookup = String(params?.[0] ?? "").toLowerCase();
    return ((byEmail.get(lookup) as unknown) ?? null) as T | null;
  };
}

const SEED: UsersRow[] = [
  { email: "carmine.colarusso@ultra1plus.com", role: "admin",  is_active: true  },
  { email: "eugenio.piratelli@ultra1plus.com", role: "admin",  is_active: true  },
  { email: "viewer@ultra1plus.com",            role: "viewer", is_active: true  },
  { email: "inactive@ultra1plus.com",          role: "admin",  is_active: false },
  { email: "weird-role@ultra1plus.com",        role: "outsider", is_active: true },
];

test("null email is rejected with reason 'no_email'", async () => {
  const stub = makeStub(SEED);
  const result = await isEmailAllowed(null, stub);
  assert.equal(result.allowed, false);
  if (!result.allowed) {
    assert.equal(result.reason, "no_email");
    assert.equal(result.email, null);
  }
});

test("undefined email is rejected with reason 'no_email'", async () => {
  const stub = makeStub(SEED);
  const result = await isEmailAllowed(undefined, stub);
  assert.equal(result.allowed, false);
});

test("empty / whitespace-only email is rejected", async () => {
  const stub = makeStub(SEED);
  for (const v of ["", "   ", "\n\t  "]) {
    const r = await isEmailAllowed(v, stub);
    assert.equal(r.allowed, false, `expected ${JSON.stringify(v)} to be rejected`);
  }
});

test("unauthorized Google email (not in u1d_ops.users) is rejected", async () => {
  const stub = makeStub(SEED);
  const result = await isEmailAllowed("randomstranger@gmail.com", stub);
  assert.equal(result.allowed, false);
  if (!result.allowed) {
    assert.equal(result.reason, "not_in_allowlist");
    assert.equal(result.email, "randomstranger@gmail.com");
  }
});

test("inactive allowlisted user is rejected with reason 'inactive'", async () => {
  const stub = makeStub(SEED);
  const result = await isEmailAllowed("inactive@ultra1plus.com", stub);
  assert.equal(result.allowed, false);
  if (!result.allowed) {
    assert.equal(result.reason, "inactive");
  }
});

test("active admin user is allowed and role surfaces as 'admin'", async () => {
  const stub = makeStub(SEED);
  const result = await isEmailAllowed("carmine.colarusso@ultra1plus.com", stub);
  assert.equal(result.allowed, true);
  if (result.allowed) {
    assert.equal(result.role, "admin");
    assert.equal(result.email, "carmine.colarusso@ultra1plus.com");
  }
});

test("active viewer user is allowed with role 'viewer'", async () => {
  const stub = makeStub(SEED);
  const result = await isEmailAllowed("viewer@ultra1plus.com", stub);
  assert.equal(result.allowed, true);
  if (result.allowed) {
    assert.equal(result.role, "viewer");
  }
});

test("unknown role is rejected with reason 'unknown_role'", async () => {
  const stub = makeStub(SEED);
  const result = await isEmailAllowed("weird-role@ultra1plus.com", stub);
  assert.equal(result.allowed, false);
  if (!result.allowed) {
    assert.equal(result.reason, "unknown_role");
  }
});

test("email comparison is case-insensitive", async () => {
  const stub = makeStub(SEED);
  const variants = [
    "CARMINE.COLARUSSO@ULTRA1PLUS.COM",
    "Carmine.Colarusso@Ultra1Plus.com",
    "  carmine.colarusso@ultra1plus.com  ",
  ];
  for (const v of variants) {
    const r = await isEmailAllowed(v, stub);
    assert.equal(r.allowed, true, `expected ${JSON.stringify(v)} to be allowed`);
    if (r.allowed) {
      assert.equal(r.email, "carmine.colarusso@ultra1plus.com", "normalized to lowercase");
    }
  }
});

test("DB throw propagates (caller's signIn translates to denial)", async () => {
  const broken = async () => {
    throw new Error("connection refused");
  };
  await assert.rejects(
    () => isEmailAllowed("carmine.colarusso@ultra1plus.com", broken),
    /connection refused/
  );
});

test("non-string email (number, object) is rejected", async () => {
  const stub = makeStub(SEED);
  // @ts-expect-error — deliberately wrong type to exercise the guard
  const r1 = await isEmailAllowed(42, stub);
  assert.equal(r1.allowed, false);
  // @ts-expect-error — deliberately wrong type to exercise the guard
  const r2 = await isEmailAllowed({}, stub);
  assert.equal(r2.allowed, false);
});
