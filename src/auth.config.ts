/**
 * src/auth.config.ts
 *
 * PR 003A — Edge-safe Auth.js configuration.
 *
 * This file MUST NOT import anything that pulls in Node-only modules
 * (pg, fs, crypto-derived helpers). It is consumed by middleware.ts which
 * runs on the Edge runtime, and the `pg` driver is incompatible there.
 *
 * The DB-aware callbacks (signIn / jwt / session) live in src/auth.ts and
 * are wired by the route handler under /api/auth/[...nextauth] which runs
 * on Node and can talk to Postgres.
 */
import Google from "next-auth/providers/google";
import type { NextAuthConfig } from "next-auth";

/** Paths that any authenticated user (admin or viewer) may access. */
const ADMIN_PATH_PREFIXES = ["/admin", "/api/admin"];

/** Public dashboard pages — never require auth. */
const PUBLIC_PATHS = new Set([
  "/",
  "/production",
  "/reconciliation",
]);

function isAdminPath(pathname: string): boolean {
  return ADMIN_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

/**
 * Edge-safe NextAuth config. Used by middleware to short-circuit
 * unauthenticated requests at the network layer before they hit a handler.
 *
 * Note: the `authorized` callback runs in middleware. It can only inspect
 * `auth.user` (set from the JWT) and the request URL. Any DB-dependent
 * decision (allowlist refresh, role change) must happen in signIn/jwt.
 */
export const authConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // Limit to a single Google account per session (no account picker race).
      allowDangerousEmailAccountLinking: false,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  // JWT sessions: no DB session store needed; allowlist check happens
  // exactly once at signIn time and the result is encoded in the JWT.
  session: { strategy: "jwt" },
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;

      // Explicit allow for public dashboard routes — never gate them.
      if (isPublicPath(pathname)) return true;

      // Anything else outside the admin surface is also unrestricted.
      // Only /admin/* and /api/admin/* are protected by this middleware.
      if (!isAdminPath(pathname)) return true;

      // Admin surface: require a signed-in user.
      return !!auth?.user;
    },
  },
  trustHost: true, // Required when running behind Railway's proxy
} satisfies NextAuthConfig;
