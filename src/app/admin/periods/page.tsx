/**
 * src/app/admin/periods/page.tsx
 *
 * PR 003F — Admin periods index.
 *
 * Server component:
 *   - Auth + admin gate.
 *   - listPeriods(getPool(), { limit: 60 }) — 60 = five years of monthlies,
 *     more than enough until a paging UI is needed.
 *   - Renders PeriodsTable.
 */
import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import { Nav } from "@/components/nav";
import { HeroHeader } from "@/components/layout/hero-header";
import { PeriodsTable } from "@/components/admin/periods-table";
import { listPeriods } from "@/lib/periods/list-periods";
import { getPool } from "@/lib/db-pool";

export const dynamic = "force-dynamic";

export default async function PeriodsIndexPage() {
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/login?callbackUrl=/admin/periods");
  }
  if (session.user.isAdmin !== true) {
    redirect("/?error=forbidden");
  }

  let rows: Awaited<ReturnType<typeof listPeriods>> = [];
  let error: string | null = null;
  try {
    rows = await listPeriods(getPool(), { limit: 60 });
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error";
  }

  return (
    <main>
      <HeroHeader
        eyebrow="U1DYNAMICS MANUFACTURING LLC"
        title="Periods / Monthly Close"
        subtitle={
          <>
            Every tracked period and where it stands in the monthly close workflow. Signed in as {session.user.email}.
            <span className="mx-2">·</span>
            <a href="/admin" className="underline opacity-90 hover:opacity-100">Back to admin home</a>
          </>
        }
      />
      <Nav current="/admin/periods" />

      <div className="container mx-auto px-8 py-8 max-w-7xl space-y-6">
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-heading text-xl font-bold text-navy">
              All periods
            </h2>
            <span className="text-xs text-gray-500 italic">
              Showing latest 60 · sorted newest first
            </span>
          </div>
          {error ? (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 text-red-900 rounded-sm px-4 py-3 text-sm"
            >
              <div className="font-semibold">Could not load periods</div>
              <div className="text-xs mt-1 font-mono">{error}</div>
            </div>
          ) : (
            <PeriodsTable rows={rows} />
          )}
        </section>

        <section className="bg-gray-50 border border-gray-200 rounded-sm p-4">
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="text-xs text-gray-600 hover:text-navy underline"
            >
              Sign out
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
