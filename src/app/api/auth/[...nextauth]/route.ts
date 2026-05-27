/**
 * src/app/api/auth/[...nextauth]/route.ts
 *
 * PR 003A — NextAuth catch-all route handler.
 *
 * Auth.js v5 pattern: the handlers object exported from src/auth.ts already
 * encapsulates GET/POST for the OAuth dance, callback URL, and session
 * endpoints. We just re-export them.
 *
 * Runs on the Node runtime (default) so it can talk to Postgres via the
 * allowlist helper in the signIn callback.
 */
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
