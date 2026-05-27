/**
 * src/app/board/[year]/[month]/page.tsx
 *
 * PR 004A — Executive monthly board dashboard.
 *
 * Renders only when the period is board-ready (locked + clean alerts +
 * complete operator notes). Otherwise shows a controlled blocked state
 * with friendly labels and (admin-only) links back to the appropriate
 * admin fix-it pages.
 */
import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { Nav } from "@/components/nav";
import { getPool } from "@/lib/db-pool";
import { getBoardPeriod } from "@/lib/board/get-board-period";
import { listDistributionLists } from "@/lib/distribution/list-distribution-lists";
import { listBoardDeckSends } from "@/lib/distribution/list-board-deck-sends";
import { EmailBoardDeckButton } from "@/components/board/email-board-deck-button";
import { SendHistoryPanel } from "@/components/board/send-history-panel";
import { formatBlockerLabels } from "@/lib/review/blocker-labels";
import { fmtNum, fmtPct } from "@/lib/brand";
import { SECTION_KEYS, SECTION_LABELS, type SectionKey } from "@/lib/operator-notes/types";

export const dynamic = "force-dynamic";

type Params = { year: string; month: string };

function formatLocaleDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.valueOf())) return iso;
  return d.toLocaleString("en-US", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function formatSigned(n: number | null): string {
  if (n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${fmtNum(n)}`;
}

function MoMChip({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-gray-400">—</span>;
  const positive = delta >= 0;
  return (
    <span
      className={`inline-block tabular-nums font-semibold ${positive ? "text-emerald-700" : "text-red-700"}`}
    >
      {positive ? "+" : ""}
      {fmtPct(delta)}
    </span>
  );
}

export default async function BoardDashboardPage({ params }: { params: Promise<Params> }) {
  const session = await auth();
  if (!session?.user?.email) {
    redirect(`/login?callbackUrl=/board`);
  }
  if (session.user.isAdmin !== true) {
    redirect("/?error=forbidden");
  }

  const { year: y, month: m } = await params;
  const year = parseInt(y, 10);
  const month = parseInt(m, 10);
  if (
    !Number.isInteger(year) || year < 2020 || year > 2100 ||
    !Number.isInteger(month) || month < 1 || month > 12
  ) {
    notFound();
  }

  let view: Awaited<ReturnType<typeof getBoardPeriod>>;
  let distributionLists: Awaited<ReturnType<typeof listDistributionLists>> = [];
  let recentSends: Awaited<ReturnType<typeof listBoardDeckSends>> = [];
  try {
    const pool = getPool();
    [view, distributionLists, recentSends] = await Promise.all([
      getBoardPeriod(pool, year, month),
      listDistributionLists(pool),
      listBoardDeckSends(pool, year, month, 10),
    ]);
  } catch (err) {
    return (
      <main>
        <header className="bg-navy text-white">
          <div className="container mx-auto px-8 py-6 max-w-7xl">
            <h1 className="font-heading text-2xl font-bold">Board · {year}-{String(month).padStart(2, "0")}</h1>
          </div>
        </header>
        <Nav current="/board" />
        <div className="container mx-auto px-8 py-8 max-w-3xl">
          <div role="alert" className="bg-red-50 border border-red-200 text-red-900 rounded-sm px-4 py-3 text-sm">
            <div className="font-semibold">Could not load board data</div>
            <div className="text-xs mt-1 font-mono">
              {err instanceof Error ? err.message : "Unknown error"}
            </div>
          </div>
        </div>
      </main>
    );
  }

  // -------------------------------------------------------------------
  // Blocked state — period not board-ready
  // -------------------------------------------------------------------
  if (!view.readiness.ready) {
    const friendly = formatBlockerLabels(view.readiness.blockers);
    return (
      <main>
        <header className="bg-navy text-white">
          <div className="container mx-auto px-8 py-6 max-w-7xl">
            <div className="text-[11px] tracking-[0.2em] opacity-80 mb-1">
              U1DYNAMICS MANUFACTURING LLC
            </div>
            <h1 className="font-heading text-3xl font-bold">{view.period.label} · Board Dashboard</h1>
            <div className="text-sm opacity-80 mt-2 italic">
              Current status: {view.period.status ?? "no row"}
            </div>
          </div>
        </header>
        <Nav current="/board" />
        <div className="container mx-auto px-8 py-8 max-w-3xl space-y-4">
          <section className="bg-amber-50 border border-amber-200 text-amber-900 rounded-sm px-5 py-4">
            <div className="font-heading text-xl font-bold mb-2">
              This period is not ready for board reporting yet.
            </div>
            {friendly.length === 0 ? (
              <p className="text-sm">No specific blocker reported.</p>
            ) : (
              <ul className="text-sm list-disc list-inside space-y-1">
                {friendly.map((label, i) => (
                  <li key={i}>{label}</li>
                ))}
              </ul>
            )}
          </section>
          <section className="bg-white border border-gray-200 rounded-sm px-5 py-4 text-sm">
            <div className="font-semibold text-navy mb-2">Admin next steps</div>
            <ul className="space-y-1 text-sm">
              <li>
                <a href={`/admin/review/${year}/${month}`} className="text-navy underline">
                  Open the review page →
                </a>
              </li>
              {view.readiness.blockers.some((b) => b.includes("operator_notes")) && (
                <li>
                  <a href={`/admin/operator-notes/${year}/${month}`} className="text-navy underline">
                    Complete operator notes →
                  </a>
                </li>
              )}
              <li>
                <a href="/admin/periods" className="text-navy underline">
                  All periods (admin) →
                </a>
              </li>
            </ul>
          </section>
          <section className="bg-gray-50 border border-gray-200 rounded-sm px-5 py-4 text-xs text-gray-600">
            Blocker codes (raw):{" "}
            {view.readiness.blockers.length > 0 ? (
              <code className="text-[11px]">{view.readiness.blockers.join("; ")}</code>
            ) : (
              "—"
            )}
            . The readiness API exposes the same codes for downstream consumers.
          </section>
        </div>
      </main>
    );
  }

  // -------------------------------------------------------------------
  // READY — render the executive dashboard
  // -------------------------------------------------------------------
  const headline = view.headlineMetrics;
  const wasReopened = view.lockHistory.some((e) => e.event_type === "reopened");
  const noFacts = headline.fact_row_count === 0;

  return (
    <main>
      <header className="bg-navy text-white">
        <div className="container mx-auto px-8 py-6 max-w-7xl">
          <div className="text-[11px] tracking-[0.2em] opacity-80 mb-1">
            U1DYNAMICS MANUFACTURING LLC
          </div>
          <h1 className="font-heading text-3xl font-bold">
            {view.period.label} Board Dashboard
          </h1>
          <div className="text-sm opacity-80 mt-2 italic">
            Locked monthly operating view based on version {view.activeFile?.version_no ?? "—"} of the uploaded report.
            <span className="mx-2">·</span>
            Locked {formatLocaleDateTime(view.period.locked_at)} by {view.period.locked_by ?? "—"}
            <span className="mx-2">·</span>
            <a href="/board" className="underline opacity-90 hover:opacity-100">
              All locked periods
            </a>
          </div>
          <div className="mt-4">
            <a
              href={`/api/admin/deck/${year}/${month}`}
              className="inline-flex items-center gap-2 bg-white text-navy hover:bg-gray-100 font-medium text-sm px-4 py-2 rounded-sm transition-colors"
              aria-label="Generate and download the PowerPoint board deck for this period"
            >
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
              Generate board deck (.pptx)
            </a>
          </div>
        </div>
      </header>
      <Nav current="/board" />

      <div className="container mx-auto px-8 py-8 max-w-6xl space-y-6">
        {/* No-facts warning (rare: locked period with zero rows) */}
        {noFacts && (
          <section className="bg-amber-50 border border-amber-200 text-amber-900 rounded-sm px-5 py-4 text-sm">
            <div className="font-semibold">This period is locked but contains no volume facts.</div>
            <div className="text-xs mt-1">
              The active file was uploaded but has no per-customer/per-package rows. Confirm the workbook structure
              and reopen the period via <code>/admin/review/{year}/{month}</code> if a re-upload is required.
            </div>
          </section>
        )}

        {/* Board distribution */}
        <section className="bg-white border border-gray-200 rounded-sm p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="font-heading text-base font-bold text-navy">Board distribution</h2>
              <p className="text-xs text-gray-500 mt-1 max-w-xl">
                Send the generated deck to the named distribution list. Sends are audited
                in <code>u1d_ops.board_deck_sends</code>. Repeat sends within 24 hours
                require an explicit confirmation click.
              </p>
              {distributionLists.length > 0 ? (
                <div className="text-xs text-gray-700 mt-2">
                  Active list: <span className="font-medium text-navy">
                    {distributionLists.find((l) => l.is_active)?.name ?? "—"}
                  </span>
                  {" · "}
                  {distributionLists.find((l) => l.is_active)?.active_to_count ?? 0} to ·{" "}
                  {distributionLists.find((l) => l.is_active)?.active_cc_count ?? 0} cc ·{" "}
                  {distributionLists.find((l) => l.is_active)?.active_bcc_count ?? 0} bcc
                </div>
              ) : (
                <div className="text-xs italic text-gray-500 mt-2">
                  No distribution lists configured yet. Insert one into
                  {" "}<code>u1d_ops.board_distribution_lists</code>{" "}
                  and add recipients to{" "}
                  <code>u1d_ops.board_distribution_recipients</code>.
                </div>
              )}
            </div>
            <EmailBoardDeckButton
              year={year} month={month}
              distributionListId={distributionLists.find((l) => l.is_active)?.list_id ?? null}
              distributionListName={distributionLists.find((l) => l.is_active)?.name ?? null}
              recipientCount={distributionLists.find((l) => l.is_active)?.active_to_count ?? 0}
            />
          </div>
        </section>

        {/* Recent deck sends */}
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <h2 className="font-heading text-base font-bold text-navy mb-3">
            Recent deck sends ({recentSends.length})
          </h2>
          <SendHistoryPanel sends={recentSends} />
        </section>

        {/* 1. Headline metrics */}
        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricCard label="Total gallons" value={fmtNum(headline.total_gallons)} sub="this month" />
          <MetricCard
            label="Month over month"
            value={headline.month_over_month_delta_pct !== null
              ? fmtPct(headline.month_over_month_delta_pct)
              : "—"}
            sub={
              headline.prior_month_total_gallons !== null
                ? `${formatSigned(headline.month_over_month_delta_gallons)} gal vs prior`
                : "no prior locked month"
            }
            tone={headline.month_over_month_delta_pct === null ? "neutral" :
              headline.month_over_month_delta_pct >= 0 ? "ok" : "warn"}
          />
          <MetricCard label="Customers" value={fmtNum(headline.customer_count)} sub="active this period" />
          <MetricCard label="Package types" value={fmtNum(headline.package_count)} sub="distinct" />
          <MetricCard label="Volume rows" value={fmtNum(headline.fact_row_count)} sub="customer × package" />
          <MetricCard
            label="Alerts resolved"
            value={fmtNum(view.alertSummary.resolved_alerts_total)}
            sub="during close"
            tone="ok"
          />
        </section>

        {/* 2. Executive summary / operator notes */}
        {view.operatorNotes && (
          <section className="bg-white border border-gray-200 rounded-sm p-6">
            <h2 className="font-heading text-xl font-bold text-navy mb-1">
              Executive summary
            </h2>
            <p className="text-xs text-gray-500 mb-5">
              Operator narrative captured at close, marked complete on{" "}
              {formatLocaleDateTime(view.operatorNotes.completed_at)} by{" "}
              {view.operatorNotes.completed_by ?? "—"}.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              {SECTION_KEYS.map((k: SectionKey) => (
                <div key={k}>
                  <h3 className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">
                    {SECTION_LABELS[k]}
                  </h3>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                    {view.operatorNotes![k] || <span className="italic text-gray-400">—</span>}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 3. Top customers */}
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-heading text-xl font-bold text-navy">Top customers</h2>
            <span className="text-xs text-gray-500 italic">Top {view.topCustomers.length}</span>
          </div>
          {view.topCustomers.length === 0 ? (
            <div className="text-sm italic text-gray-500">No customer rows for this period.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                  <th className="text-left pb-2 pr-3 font-medium">#</th>
                  <th className="text-left pb-2 pr-3 font-medium">Customer</th>
                  <th className="text-right pb-2 pr-3 font-medium">Gallons</th>
                  <th className="text-right pb-2 pr-3 font-medium">Share</th>
                  <th className="text-right pb-2 pr-3 font-medium">Prior month</th>
                  <th className="text-right pb-2 pr-3 font-medium">Δ gal</th>
                  <th className="text-right pb-2 pr-3 font-medium">Δ %</th>
                </tr>
              </thead>
              <tbody>
                {view.topCustomers.map((c, i) => (
                  <tr key={c.customer_key ?? `row-${i}`} className="border-b border-gray-100 last:border-b-0">
                    <td className="py-2 pr-3 text-gray-400 tabular-nums">{i + 1}</td>
                    <td className="py-2 pr-3 text-navy">{c.customer_name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-medium">{fmtNum(c.gallons)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-700">
                      {c.share_pct !== null ? fmtPct(c.share_pct) : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-500">
                      {c.prior_month_gallons !== null ? fmtNum(c.prior_month_gallons) : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatSigned(c.delta_gallons)}</td>
                    <td className="py-2 pr-3 text-right">
                      <MoMChip delta={c.delta_pct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* 4. Top packages */}
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-heading text-xl font-bold text-navy">Top packages</h2>
            <span className="text-xs text-gray-500 italic">Top {view.topPackages.length}</span>
          </div>
          {view.topPackages.length === 0 ? (
            <div className="text-sm italic text-gray-500">No package rows for this period.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                  <th className="text-left pb-2 pr-3 font-medium">#</th>
                  <th className="text-left pb-2 pr-3 font-medium">Package</th>
                  <th className="text-right pb-2 pr-3 font-medium">Gallons</th>
                  <th className="text-right pb-2 pr-3 font-medium">Share</th>
                  <th className="text-right pb-2 pr-3 font-medium">Prior month</th>
                  <th className="text-right pb-2 pr-3 font-medium">Δ gal</th>
                  <th className="text-right pb-2 pr-3 font-medium">Δ %</th>
                </tr>
              </thead>
              <tbody>
                {view.topPackages.map((p, i) => (
                  <tr key={p.package_key ?? `row-${i}`} className="border-b border-gray-100 last:border-b-0">
                    <td className="py-2 pr-3 text-gray-400 tabular-nums">{i + 1}</td>
                    <td className="py-2 pr-3 text-navy">{p.package_label}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-medium">{fmtNum(p.gallons)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-700">
                      {p.share_pct !== null ? fmtPct(p.share_pct) : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-500">
                      {p.prior_month_gallons !== null ? fmtNum(p.prior_month_gallons) : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatSigned(p.delta_gallons)}</td>
                    <td className="py-2 pr-3 text-right">
                      <MoMChip delta={p.delta_pct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* 5. Close quality / alerts */}
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <h2 className="font-heading text-xl font-bold text-navy mb-3">Close quality</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            <SmallStat label="Package alerts" value={view.alertSummary.package_alerts_total} />
            <SmallStat label="Customer alerts" value={view.alertSummary.customer_alerts_total} />
            <SmallStat label="Data quality alerts" value={view.alertSummary.data_quality_alerts_total} />
            <SmallStat label="Resolved" value={view.alertSummary.resolved_alerts_total} tone="ok" />
            <SmallStat
              label="Pending"
              value={view.alertSummary.pending_alerts_total}
              tone={view.alertSummary.pending_alerts_total === 0 ? "ok" : "warn"}
            />
          </div>
          <p className="mt-3 text-xs text-gray-500 italic">
            Locked periods must have zero pending alerts. Counts reflect the active file only.
          </p>
        </section>

        {/* 6. Lock history footer */}
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-heading text-base font-bold text-navy">Lock history</h2>
            {wasReopened && (
              <span className="text-xs italic text-amber-800">
                This period was reopened {view.lockHistory.filter(e => e.event_type === "reopened").length === 1 ? "once" : `${view.lockHistory.filter(e => e.event_type === "reopened").length} times`} before final lock.
              </span>
            )}
          </div>
          {view.lockHistory.length === 0 ? (
            <div className="text-sm italic text-gray-500">No lock events recorded.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                    <th className="text-left pb-2 pr-3 font-medium">Event</th>
                    <th className="text-left pb-2 pr-3 font-medium">At</th>
                    <th className="text-left pb-2 pr-3 font-medium">By</th>
                    <th className="text-left pb-2 pr-3 font-medium">File / version</th>
                    <th className="text-left pb-2 pr-3 font-medium">Transition</th>
                  </tr>
                </thead>
                <tbody>
                  {view.lockHistory.map((e) => (
                    <tr key={e.event_id} className="border-b border-gray-100 last:border-b-0">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span
                          className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm ${
                            e.event_type === "locked"
                              ? "bg-emerald-50 text-emerald-900"
                              : "bg-purple-50 text-purple-900"
                          }`}
                        >
                          {e.event_type}
                        </span>
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-gray-700 whitespace-nowrap">
                        {formatLocaleDateTime(e.event_at)}
                      </td>
                      <td className="py-2 pr-3 text-gray-700 truncate max-w-[220px]" title={e.event_by}>
                        {e.event_by}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {e.version_no !== null ? (
                          <span className="text-navy font-medium">v{e.version_no}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs whitespace-nowrap">
                        <span className="text-gray-500">{e.prior_status ?? "—"}</span>
                        <span className="mx-1 text-gray-400">→</span>
                        <span className="text-navy font-medium">{e.new_status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 7. Data provenance footer */}
        <section className="bg-gray-50 border border-gray-200 rounded-sm p-5">
          <h2 className="text-[11px] uppercase tracking-wider text-gray-500 mb-3">
            Data provenance
          </h2>
          {view.activeFile ? (
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
              <ProvenanceItem label="File ID" value={String(view.activeFile.file_id)} />
              <ProvenanceItem label="Version" value={`v${view.activeFile.version_no}`} />
              <ProvenanceItem
                label="Hash prefix"
                value={view.activeFile.file_hash_prefix}
                mono
              />
              <ProvenanceItem
                label="Discrepancy"
                value={view.activeFile.has_total_discrepancy ? "flagged" : "none"}
                tone={view.activeFile.has_total_discrepancy ? "warn" : "ok"}
              />
              <ProvenanceItem
                label="Uploaded at"
                value={formatLocaleDateTime(view.activeFile.uploaded_at)}
              />
              <ProvenanceItem label="Uploaded by" value={view.activeFile.uploaded_by ?? "—"} />
              <ProvenanceItem
                label="Locked at"
                value={formatLocaleDateTime(view.period.locked_at)}
              />
              <ProvenanceItem label="Locked by" value={view.period.locked_by ?? "—"} />
            </dl>
          ) : (
            <div className="text-xs italic text-gray-500">No active file metadata.</div>
          )}
        </section>
      </div>
    </main>
  );
}

// ---- small server components ----

function MetricCard({
  label, value, sub, tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ok" | "warn" | "neutral";
}) {
  const accent =
    tone === "ok" ? "border-t-emerald-600"
    : tone === "warn" ? "border-t-amber-500"
    : "border-t-navy";
  return (
    <div className={`bg-white border border-gray-200 border-t-4 ${accent} rounded-sm shadow-sm px-4 py-3`}>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="font-heading text-2xl font-bold text-navy leading-tight mt-1">{value}</div>
      {sub && <div className="text-[11px] text-gray-500 italic mt-1">{sub}</div>}
    </div>
  );
}

function SmallStat({
  label, value, tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn" | "neutral";
}) {
  const palette =
    tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900"
    : "border-gray-200 bg-white text-navy";
  return (
    <div className={`border rounded-sm px-3 py-2 ${palette}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="font-heading text-xl font-bold mt-0.5">{value.toLocaleString("en-US")}</div>
    </div>
  );
}

function ProvenanceItem({
  label, value, mono, tone,
}: { label: string; value: string; mono?: boolean; tone?: "ok" | "warn" }) {
  const valClass =
    tone === "warn" ? "text-amber-900"
    : tone === "ok" ? "text-emerald-900"
    : "text-gray-800";
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className={`${valClass} ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
