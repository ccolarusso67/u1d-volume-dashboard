/**
 * src/app/admin/distribution/page.tsx
 *
 * PR 004D — Read-only admin view of board distribution lists.
 *
 * For this PR, list mutations happen in SQL. PR 004E will add CRUD
 * (add/remove recipient, toggle active, create new list).
 */
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Nav } from "@/components/nav";
import { HeroHeader } from "@/components/layout/hero-header";
import { getPool } from "@/lib/db-pool";
import { listDistributionLists } from "@/lib/distribution/list-distribution-lists";
import { getDistributionList } from "@/lib/distribution/get-distribution-list";

export const dynamic = "force-dynamic";

export default async function AdminDistributionPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login?callbackUrl=/admin/distribution");
  if (session.user.isAdmin !== true) redirect("/?error=forbidden");

  const pool = getPool();
  const lists = await listDistributionLists(pool);
  const active = lists.find((l) => l.is_active);
  const detail = active ? await getDistributionList(pool, active.list_id) : null;

  return (
    <main>
      <HeroHeader
        eyebrow="U1DYNAMICS MANUFACTURING LLC"
        title="Board Distribution"
        subtitle={
          <>
            Read-only view of the active distribution list and recipients. Edits go through SQL in this PR; the management UI ships in PR 004E.
            <span className="mx-2">·</span>
            <a href="/admin" className="underline opacity-90 hover:opacity-100">Back to admin home</a>
          </>
        }
      />
      <Nav current="/admin/distribution" />

      <div className="container mx-auto px-8 py-8 max-w-5xl space-y-6">
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <h2 className="font-heading text-xl font-bold text-navy mb-4">All lists</h2>
          {lists.length === 0 ? (
            <div className="text-sm italic text-gray-500">No distribution lists configured.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                  <th className="text-left pb-2 pr-3 font-medium">List</th>
                  <th className="text-left pb-2 pr-3 font-medium">Description</th>
                  <th className="text-right pb-2 pr-3 font-medium">To</th>
                  <th className="text-right pb-2 pr-3 font-medium">Cc</th>
                  <th className="text-right pb-2 pr-3 font-medium">Bcc</th>
                  <th className="text-left pb-2 pr-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {lists.map((l) => (
                  <tr key={l.list_id} className="border-b border-gray-100 last:border-b-0">
                    <td className="py-2 pr-3 font-medium text-navy">{l.name}</td>
                    <td className="py-2 pr-3 text-gray-700">{l.description ?? "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{l.active_to_count}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{l.active_cc_count}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{l.active_bcc_count}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm ${
                          l.is_active
                            ? "bg-emerald-50 text-emerald-900"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {l.is_active ? "active" : "inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {detail && (
          <section className="bg-white border border-gray-200 rounded-sm p-6">
            <h2 className="font-heading text-xl font-bold text-navy mb-1">
              Recipients · {detail.name}
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              {detail.recipients.length} total · {detail.active_to_count} active TO ·{" "}
              {detail.active_cc_count} active CC · {detail.active_bcc_count} active BCC
            </p>
            {detail.recipients.length === 0 ? (
              <div className="text-sm italic text-gray-500 px-4 py-6 text-center bg-gray-50 border border-gray-200 rounded-sm">
                No active recipients configured. Insert rows into{" "}
                <code>u1d_ops.board_distribution_recipients</code> to enable sends.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                    <th className="text-left pb-2 pr-3 font-medium">Email</th>
                    <th className="text-left pb-2 pr-3 font-medium">Display name</th>
                    <th className="text-left pb-2 pr-3 font-medium">Type</th>
                    <th className="text-left pb-2 pr-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.recipients.map((r) => (
                    <tr key={r.recipient_id} className="border-b border-gray-100 last:border-b-0">
                      <td className="py-2 pr-3 text-navy">{r.email}</td>
                      <td className="py-2 pr-3 text-gray-700">{r.display_name ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <span className="inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm bg-gray-100 text-gray-700">
                          {r.recipient_type}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm ${
                            r.is_active
                              ? "bg-emerald-50 text-emerald-900"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {r.is_active ? "active" : "inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
