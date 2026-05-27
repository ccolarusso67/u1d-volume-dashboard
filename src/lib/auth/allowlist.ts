/**
 * src/lib/auth/allowlist.ts
 *
 * PR 003A — Auth allowlist check.
 *
 * Single-purpose helper that decides whether a Google-authenticated email
 * is permitted to sign in. Source of truth is u1d_ops.users; status is
 * derived from is_active and role (viewer | admin).
 *
 * Designed for dependency injection: the queryOne function is optional and
 * defaults to the live DB pool. Tests pass a stub so they run without a DB.
 *
 * Email comparison is case-insensitive (LOWER on both sides of the predicate)
 * because Google may return mixed-case email casing and humans type their
 * own emails in random casing.
 */
import type { QueryResultRow } from "pg";
import { queryOne as defaultQueryOne } from "../db";

export type AllowlistRole = "viewer" | "admin";

export type AllowlistResult =
  | {
      allowed: true;
      email: string;          // normalized lowercase
      role: AllowlistRole;
    }
  | {
      allowed: false;
      reason: "no_email" | "not_in_allowlist" | "inactive" | "unknown_role";
      email: string | null;
    };

type QueryOneFn = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
) => Promise<T | null>;

type UsersRow = QueryResultRow & {
  email: string;
  role: string;
  is_active: boolean;
};

const ALLOWLIST_QUERY = `
  SELECT email, role, is_active
    FROM u1d_ops.users
   WHERE LOWER(email) = $1
   LIMIT 1
`;

/**
 * Resolve an email address against the u1d_ops.users allowlist.
 *
 * - Returns `{ allowed: true, role }` only when the email exists AND
 *   `is_active = TRUE` AND `role IN ('viewer','admin')`.
 * - Returns a typed reason on rejection so callers can distinguish
 *   "user is not in allowlist" from "user was deactivated" for logging.
 *
 * Never throws; DB errors propagate as exceptions to the caller (NextAuth
 * signIn callback turns those into 500s, which is correct — we'd rather
 * block sign-in than silently let someone in on a transient failure).
 */
export async function isEmailAllowed(
  email: string | null | undefined,
  queryOne: QueryOneFn = defaultQueryOne as QueryOneFn
): Promise<AllowlistResult> {
  if (!email || typeof email !== "string") {
    return { allowed: false, reason: "no_email", email: null };
  }

  const normalized = email.toLowerCase().trim();
  if (!normalized) {
    return { allowed: false, reason: "no_email", email: null };
  }

  const row = await queryOne<UsersRow>(ALLOWLIST_QUERY, [normalized]);

  if (!row) {
    return { allowed: false, reason: "not_in_allowlist", email: normalized };
  }
  if (!row.is_active) {
    return { allowed: false, reason: "inactive", email: normalized };
  }
  if (row.role !== "viewer" && row.role !== "admin") {
    return { allowed: false, reason: "unknown_role", email: normalized };
  }

  return {
    allowed: true,
    email: normalized,
    role: row.role as AllowlistRole,
  };
}
