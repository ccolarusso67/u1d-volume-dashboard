/**
 * src/lib/auth/password.ts
 *
 * Password hashing + verification for the Credentials sign-in provider.
 *
 * Node-only (uses node:crypto and the pg pool). MUST NOT be imported from
 * auth.config.ts / middleware (Edge runtime). It is consumed by the
 * Credentials.authorize callback in src/auth.ts, which runs on Node.
 *
 * Hash format (self-describing, no external dependency):
 *   scrypt$<saltHex>$<keyHex>
 *   - salt: 16 random bytes
 *   - key:  64-byte scrypt derivation
 *
 * Set/rotate a user's password with scripts/make-password-sql.mjs, which
 * prints the exact UPDATE statement to run against u1d_ops.users.
 */
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { QueryResultRow } from "pg";
import { queryOne as defaultQueryOne } from "../db";

const KEYLEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(plain, salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, saltHex, keyHex] = parts;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(keyHex, "hex");
  } catch {
    return false;
  }
  if (expected.length !== KEYLEN) return false;
  const actual = scryptSync(plain, salt, KEYLEN);
  // timingSafeEqual requires equal-length buffers (guaranteed: both KEYLEN).
  return timingSafeEqual(actual, expected);
}

type QueryOneFn = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
) => Promise<T | null>;

type UsersRow = QueryResultRow & {
  email: string;
  role: string;
  is_active: boolean;
  password_hash: string | null;
  display_name: string | null;
};

const USER_QUERY = `
  SELECT email, role, is_active, password_hash, display_name
    FROM u1d_ops.users
   WHERE LOWER(email) = LOWER($1)
   LIMIT 1
`;

export type VerifiedUser = {
  email: string;
  role: "viewer" | "admin";
  name: string | null;
};

/**
 * Verify an email + password against u1d_ops.users.
 * Returns the user only when: row exists, is_active, role is valid,
 * a password is set, and the password matches. Otherwise null.
 * Never throws on a bad password — only on a DB failure (which correctly
 * blocks sign-in rather than letting someone in on a transient error).
 */
export async function verifyUserPassword(
  email: string,
  password: string,
  queryOne: QueryOneFn = defaultQueryOne as QueryOneFn
): Promise<VerifiedUser | null> {
  const normalized = (email ?? "").toLowerCase().trim();
  if (!normalized || !password) return null;

  const row = await queryOne<UsersRow>(USER_QUERY, [normalized]);
  if (!row) return null;
  if (!row.is_active) return null;
  if (row.role !== "viewer" && row.role !== "admin") return null;
  if (!verifyPassword(password, row.password_hash)) return null;

  return { email: row.email.toLowerCase(), role: row.role, name: row.display_name };
}
