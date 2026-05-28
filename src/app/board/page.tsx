/**
 * src/app/board/page.tsx
 *
 * PR 004A — Board index. Lists locked, board-ready periods.
 *
 * Server-rendered, admin-gated (PR 003A allowlist applies — board pages
 * are NOT publicly accessible in this PR). Phase 2B can introduce a
 * board-viewer role if needed.
 */
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Nav } from "@/components/nav";
import { HeroHeader } from "@/components/layout/hero-header";
import { getPool } from "@/lib/db-pool";
import { listBoardPeriods } from "@/lib/board/list-board-periods";
import { fmtNum, fmtPct } from "@/lib/brand";

export const dynamic = "force-dynamic";

function isLocalBoardPreview(): boolean {
  return process.env.NODE_ENV !== "production" &&
    process.env.U1D_LOCAL_BOARD_PREVIEW === "1";
}

function formatLocaleDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.valueOf())) return iso;
  return d.toLocaleString("en-US", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export default async function BoardIndexPage() {
  const session = await auth();
  const localPreview = isLocalBoardPreview();
  if (!session?.user?.email && !localPreview) {
    redirect("/login?callbackUrl=/board");
  }
  // Admin-only for this PR. When a board-viewer role exists, swap this for a
  // role-aware check.
  if (session?.user?.isAdmin !== true && !localPreview) {
    redirect("/?error=forbidden");
  }
  const viewerEmail = session?.user?.email ?? "local-board-preview";

  let rows: Awaited<ReturnType<typeof listBoardPeriods>> = [];
  let error: string | null = null;
  try {
    rows = await listBoardPeriods(getPool(), { limit: 24 });
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error";
  }

  return (
    <main>
      <HeroHeader
        eyebrow="U1DYNAMICS MANUFACTURING LLC"
        title="Board Dashboard"
        subtitle={
          <>
            Locked, board-ready monthly operating dashboards. Signed in as {viewerEmail}.
            <span className="mx-2">·</span>
            <a href="/admin/periods" className="underline opacity-90 hover:opacity-100">
              Admin: all periods (including unready)
            </a>
          </>
        }
      />
      <Nav current="/board" />

      <div className="container mx-auto px-8 py-8 max-w-6xl">
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-heading text-xl font-bold text-navy">Locked periods</h2>
            <span className="text-xs text-gray-500 italic">
              {rows.length} period{rows.length === 1 ? "" : "s"} · newest first
            </span>
          </div>
          {error ? (
            <div role="alert" className="bg-red-50 border border-red-200 text-red-900 rounded-sm px-4 py-3 text-sm">
              <div className="font-semibold">Could not load board periods</div>
              <div className="text-xs mt-1 font-mono">{error}</div>
            </div>
          ) : rows.length === 0 ? (
            <div className="text-sm italic text-gray-500 px-4 py-8 text-center bg-gray-50 border border-gray-200 rounded-sm">
              No locked board periods are available yet. Lock a period from{" "}
              <a href="/admin/periods" className="text-navy underline">
                /admin/periods
              </a>{" "}
              to surface it here.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                    <th className="text-left pb-2 pr-3 font-medium">Period</th>
                    <th className="text-left pb-2 pr-3 font-medium">Locked at</th>
                    <th className="text-left pb-2 pr-3 font-medium">Locked by</th>
                    <th className="text-right pb-2 pr-3 font-medium">Total gallons</th>
                    <th className="text-right pb-2 pr-3 font-medium">MoM %</th>
                    <th className="text-left pb-2 pr-3 font-medium">Operator notes</th>
                    <th className="text-right pb-2 pr-3 font-medium">Dashboard</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={`${r.period.year}-${r.period.month}`}
                      className="border-b border-gray-100 last:border-b-0"
                    >
                      <td className="py-2.5 pr-3 font-medium text-navy whitespace-nowrap">
                        {r.period.label}
                      </td>
                      <td className="py-2.5 pr-3 text-gray-700 whitespace-nowrap tabular-nums">
                        {formatLocaleDateTime(r.locked_at)}
                      </td>
                      <td className="py-2.5 pr-3 text-gray-700 truncate max-w-[200px]" title={r.locked_by ?? ""}>
                        {r.locked_by ?? "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums font-medium">
                        {r.total_gallons !== null ? fmtNum(r.total_gallons) : "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {r.month_over_month_delta_pct !== null
                          ? fmtPct(r.month_over_month_delta_pct)
                          : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <span
                          className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm ${
                            r.operator_notes_complete
                              ? "bg-emerald-50 text-emerald-900"
                              : "bg-amber-50 text-amber-900"
                          }`}
                        >
                          {r.operator_notes_complete ? "complete" : "incomplete"}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right">
                        <a
                          href={r.href}
                          className="inline-block text-xs bg-navy hover:bg-navy-deep text-white font-medium px-3 py-1 rounded-sm whitespace-nowrap"
                        >
                          View dashboard →
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-[11px] text-gray-500 italic">
                Only locked periods appear here. Unlocked or unready periods stay in{" "}
                <a href="/admin/periods" className="underline">/admin/periods</a>.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
