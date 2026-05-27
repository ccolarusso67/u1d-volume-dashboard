/**
 * src/types/next-auth.d.ts
 *
 * PR 003A — Type augmentation for Auth.js Session.user.
 *
 * Adds `role` and `isAdmin` (sourced from u1d_ops.users.role) so consumers
 * can typecheck e.g. `session.user.isAdmin` without casts.
 */
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: "viewer" | "admin";
      isAdmin?: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    email?: string;
    role?: "viewer" | "admin";
    isAdmin?: boolean;
  }
}
