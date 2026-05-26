/**
 * src/middleware.ts
 *
 * PR 003A — Route protection for /admin and /api/admin.
 *
 * Runs on the Edge runtime, so it imports the edge-safe authConfig only.
 * The `authorized` callback in that config decides whether the request
 * proceeds; this wrapper sends unauthenticated users to /login with a
 * callbackUrl pointing back to where they came from.
 */
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  // The `authorized` callback already returned true if access is permitted
  // OR if the request is for a public route. `req.auth` is non-null iff the
  // user is signed in.
  const { pathname, search } = req.nextUrl;
  const isAdminSurface =
    pathname.startsWith("/admin") || pathname.startsWith("/api/admin");

  if (!isAdminSurface) {
    return NextResponse.next();
  }

  if (req.auth?.user) {
    return NextResponse.next();
  }

  // Unauthenticated on the admin surface. For /api/admin/*, return 401 JSON
  // (machine-readable). For /admin/* pages, redirect to /login with a
  // callbackUrl so the user lands back where they tried to go after sign-in.
  if (pathname.startsWith("/api/admin")) {
    return NextResponse.json(
      { error: "unauthenticated", message: "sign-in required" },
      { status: 401 }
    );
  }

  const loginUrl = new URL("/login", req.nextUrl.origin);
  loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
});

/**
 * Matcher tells Next.js which paths the middleware should run on. We restrict
 * to the admin surface so the public dashboard pages (/, /production,
 * /reconciliation) skip the middleware entirely — zero overhead for the
 * normal viewer experience.
 */
export const config = {
  matcher: [
    "/admin",
    "/admin/:path*",
    "/api/admin/:path*",
  ],
};
