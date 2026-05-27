/**
 * src/lib/auth/require-admin.ts
 *
 * PR 003B — Route-level auth gate used by mutation handlers.
 *
 * Defense in depth on top of middleware. Middleware (PR 003A) returns 401
 * for any unauthenticated request to /api/admin/*; this helper additionally
 * enforces that the session's user is an admin (role !== 'admin' → 403).
 *
 * Pure helper with dependency injection for tests — no module-level imports
 * of `auth()` so tests can pass a stub session.
 */
import type { Session } from "next-auth";

export type RequireAdminResult =
  | { ok: true; session: Session }
  | { ok: false; status: 401 | 403; body: { error: string; message: string } };

/**
 * Resolve an admin session via the provided getSession.
 *
 * - No session  → 401 unauthenticated
 * - No isAdmin  → 403 forbidden (viewer role, or missing role enrichment)
 * - Otherwise  → ok with the session
 */
export async function requireAdminSession(
  getSession: () => Promise<Session | null>
): Promise<RequireAdminResult> {
  let session: Session | null;
  try {
    session = await getSession();
  } catch (err) {
    // A session lookup failure is treated as unauthenticated. Surface a
    // stable error code so the client can retry.
    console.error("[auth] getSession threw, denying admin access:", err);
    return {
      ok: false,
      status: 401,
      body: { error: "unauthenticated", message: "session lookup failed" },
    };
  }

  if (!session?.user) {
    return {
      ok: false,
      status: 401,
      body: { error: "unauthenticated", message: "sign-in required" },
    };
  }
  if (session.user.isAdmin !== true) {
    return {
      ok: false,
      status: 403,
      body: { error: "forbidden", message: "admin role required" },
    };
  }
  return { ok: true, session };
}
