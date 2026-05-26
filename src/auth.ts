/**
 * src/auth.ts
 *
 * PR 003A — Full Auth.js configuration (Node runtime).
 *
 * Wraps the edge-safe authConfig and adds DB-aware callbacks that consult
 * u1d_ops.users for the allowlist check. Exposed handlers / helpers are
 * consumed by the route handler at /api/auth/[...nextauth] and by server
 * components / server actions that need the current session.
 */
import NextAuth from "next-auth";
import type { JWT } from "next-auth/jwt";
import { authConfig } from "./auth.config";
import { isEmailAllowed, type AllowlistRole } from "./lib/auth/allowlist";

type EnrichedJWT = JWT & {
  email?: string;
  role?: AllowlistRole;
  isAdmin?: boolean;
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,

    /**
     * signIn — the allowlist gate. Returns false to abort sign-in and
     * route the user to /login?error=AccessDenied via the pages config.
     *
     * Runs once per browser session (subsequent requests use the JWT).
     */
    async signIn({ user }) {
      try {
        const result = await isEmailAllowed(user.email);
        if (!result.allowed) {
          console.warn(
            `[auth] sign-in denied: ${result.reason} email=${result.email ?? "<none>"}`
          );
          return false;
        }
        return true;
      } catch (err) {
        console.error("[auth] allowlist check threw, denying sign-in:", err);
        return false;
      }
    },

    /**
     * jwt — runs on sign-in (with `user`) and on every subsequent request.
     * We enrich the token with role/isAdmin so the middleware authorized()
     * check can read them without a DB round-trip.
     */
    async jwt({ token, user }) {
      const enriched = token as EnrichedJWT;

      // First call after a successful signIn: enrich from the DB once.
      if (user?.email) {
        const result = await isEmailAllowed(user.email);
        if (result.allowed) {
          enriched.email = result.email;
          enriched.role = result.role;
          enriched.isAdmin = result.role === "admin";
        }
      }
      return enriched;
    },

    /**
     * session — surface enriched fields on the client-visible Session.
     */
    async session({ session, token }) {
      const t = token as EnrichedJWT;
      if (session.user) {
        if (t.email) session.user.email = t.email;
        session.user.role = t.role;
        session.user.isAdmin = !!t.isAdmin;
      }
      return session;
    },
  },
});
