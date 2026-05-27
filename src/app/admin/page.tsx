/**
 * src/app/admin/page.tsx
 *
 * PR 003A — Minimal authenticated landing for the admin surface.
 *
 * PR 003B (Upload Route) will replace this with the upload dashboard. For
 * now it serves three purposes:
 *   1. Provides a concrete target for the auth middleware so the redirect
 *      flow is testable.
 *   2. Confirms the session callbacks are working — shows the email + role
 *      that were enriched into the JWT.
 *   3. Gives operators a single place to land after sign-in.
 */
import { auth, signOut } from "@/auth";
import { Nav } from "@/components/nav";
import { HeroHeader } from "@/components/layout/hero-header";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const session = await auth();

  // Defense in depth: middleware should have redirected unauthenticated
  // users already. If anyone slips through (mis-configured matcher, edge
  // bypass), we still refuse to render the admin landing.
  if (!session?.user?.email) {
    redirect("/login?callbackUrl=/admin");
  }

  const { email, role, isAdmin } = session.user;

  return (
    <main>
      <HeroHeader
        eyebrow="U1DYNAMICS MANUFACTURING LLC"
        title="Admin"
        subtitle={
          <>
            Signed in as {email} · role: {role ?? "unknown"}
            {isAdmin && (
              <span className="ml-2 not-italic text-[11px] bg-white/10 px-2 py-0.5 rounded-sm tracking-wider">
                ADMIN
              </span>
            )}
          </>
        }
      />
      <Nav current="/admin" />

      <div className="container mx-auto px-8 py-8 max-w-3xl">
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <h2 className="font-heading text-xl font-bold text-navy mb-3">
            Admin surface
          </h2>
          <p className="text-sm text-gray-700 mb-4">
            Use this area to upload the monthly board report and review the
            upload history.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <a
              href="/admin/upload"
              className="block bg-navy hover:bg-navy-deep text-white px-4 py-3 rounded-sm transition-colors"
            >
              <div className="text-sm font-medium">Upload Monthly Report →</div>
              <div className="text-[11px] opacity-80 mt-0.5">
                Parse, version, persist, and flag alerts.
              </div>
            </a>
            <a
              href="/admin/periods"
              className="block bg-white border border-navy text-navy hover:bg-navy hover:text-white px-4 py-3 rounded-sm transition-colors"
            >
              <div className="text-sm font-medium">Periods / Monthly Close →</div>
              <div className="text-[11px] opacity-80 mt-0.5">
                Status, alerts, notes, and next action for every period.
              </div>
            </a>
            <a
              href="/board"
              className="block bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-3 rounded-sm transition-colors"
            >
              <div className="text-sm font-medium">Board Dashboard →</div>
              <div className="text-[11px] opacity-80 mt-0.5">
                View locked, board-ready monthly operating dashboards.
              </div>
            </a>
            <a
              href="/admin/distribution"
              className="block bg-white border border-navy text-navy hover:bg-navy hover:text-white px-4 py-3 rounded-sm transition-colors"
            >
              <div className="text-sm font-medium">Board Distribution →</div>
              <div className="text-[11px] opacity-80 mt-0.5">
                Manage board deck distribution lists and recipients.
              </div>
            </a>
          </div>
          <p className="text-xs text-gray-500 mb-6 italic">
            Access is gated by Google OAuth and the{" "}
            <code>u1d_ops.users</code> allowlist (PR 003A).
          </p>

          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="inline-flex items-center justify-center bg-navy hover:bg-navy-deep text-white font-medium text-sm px-4 py-2 rounded-sm transition-colors"
            >
              Sign out
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
