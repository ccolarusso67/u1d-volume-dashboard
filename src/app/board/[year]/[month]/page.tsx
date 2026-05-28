/**
 * src/app/board/[year]/[month]/page.tsx
 *
 * PR 005A — Executive board dashboard upgrade (sections / data surface).
 * PR 005B — Executive UI / brand refresh. Refactored to use AppShell,
 *           HeroHeader, SectionCard, KpiCard. All data wiring, readiness
 *           logic, and copy unchanged — purely presentational.
 *
 * Sections (board-grade order):
 *   1. Executive snapshot
 *   2. Volume trends (6 + 12 month)
 *   3. Customer intelligence (top + concentration + movers + intercompany)
 *   4. Product / package mix (top + category mix + movers)
 *   5. Operational narrative (operator notes — capacity/supply/quality)
 *   6. Management attention (initiatives + risks)
 *   7. Close quality & audit (alerts + lock history + provenance)
 *
 * Distribution + send history sections from PR 004D are preserved.
 */
import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { Nav } from "@/components/nav";
import { AppShell } from "@/components/layout/app-shell";
import { HeroHeader } from "@/components/layout/hero-header";
import { SectionCard } from "@/components/layout/section-card";
import { KpiCard } from "@/components/layout/kpi-card";
import { getPool } from "@/lib/db-pool";
import { getBoardExecutiveDashboard } from "@/lib/board/get-board-executive-dashboard";
import { generateBoardNarrative, type NarrativeSeverity } from "@/lib/board/narrative";
import { listDistributionLists } from "@/lib/distribution/list-distribution-lists";
import { listBoardDeckSends } from "@/lib/distribution/list-board-deck-sends";
import { formatBlockerLabels } from "@/lib/review/blocker-labels";
import { fmtNum, fmtPct } from "@/lib/brand";
import { SECTION_LABELS, type SectionKey } from "@/lib/operator-notes/types";
import { EmailBoardDeckButton } from "@/components/board/email-board-deck-button";
import { SendHistoryPanel } from "@/components/board/send-history-panel";

export const dynamic = "force-dynamic";

type Params = { year: string; month: string };

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

function formatSigned(n: number | null): string {
  if (n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${fmtNum(n)}`;
}

function DeltaText({ value }: { value: number | null }) {
  if (value === null) return <span className="text-gray-400">—</span>;
  const positive = value >= 0;
  return (
    <span className={`tabular-nums font-medium ${positive ? "text-emerald-700" : "text-red-700"}`}>
      {positive ? "+" : ""}{fmtPct(value)}
    </span>
  );
}

export default async function BoardDashboardPage({ params }: { params: Promise<Params> }) {
  const session = await auth();
  const localPreview = isLocalBoardPreview();
  if (!session?.user?.email && !localPreview) redirect(`/login?callbackUrl=/board`);
  if (session?.user?.isAdmin !== true && !localPreview) redirect("/?error=forbidden");

  const { year: y, month: m } = await params;
  const year = parseInt(y, 10);
  const month = parseInt(m, 10);
  if (
    !Number.isInteger(year) || year < 2020 || year > 2100 ||
    !Number.isInteger(month) || month < 1 || month > 12
  ) {
    notFound();
  }

  let view: Awaited<ReturnType<typeof getBoardExecutiveDashboard>>;
  let distributionLists: Awaited<ReturnType<typeof listDistributionLists>> = [];
  let recentSends: Awaited<ReturnType<typeof listBoardDeckSends>> = [];
  try {
    const pool = getPool();
    [view, distributionLists, recentSends] = await Promise.all([
      getBoardExecutiveDashboard(pool, year, month),
      listDistributionLists(pool),
      listBoardDeckSends(pool, year, month, 10),
    ]);
  } catch (err) {
    return (
      <AppShell
        hero={
          <HeroHeader
            eyebrow="U1DYNAMICS MANUFACTURING LLC"
            title={`Board · ${year}-${String(month).padStart(2, "0")}`}
            subtitle="Could not load the executive view for this period."
          />
        }
        nav={<Nav current="/board" />}
        contentClassName="container mx-auto px-8 py-8 max-w-3xl"
      >
        <div role="alert" className="bg-red-50 border border-red-200 text-red-900 rounded-sm px-4 py-3 text-sm">
          <div className="font-semibold">Could not load board data</div>
          <div className="text-xs mt-1 font-mono">
            {err instanceof Error ? err.message : "Unknown error"}
          </div>
        </div>
      </AppShell>
    );
  }

  // ---------------- Blocked state ----------------
  if (!view.readiness.ready) {
    const friendly = formatBlockerLabels(view.readiness.blockers);
    return (
      <AppShell
        hero={
          <HeroHeader
            eyebrow="U1DYNAMICS MANUFACTURING LLC"
            title={`${view.period.label} · Board Dashboard`}
            subtitle={<>Current status: <span className="not-italic font-medium">{view.period.status ?? "no row"}</span></>}
          />
        }
        nav={<Nav current="/board" />}
        contentClassName="container mx-auto px-8 py-8 max-w-3xl space-y-4"
      >
        <section className="bg-amber-50 border border-amber-200 text-amber-900 rounded-sm px-5 py-4">
          <div className="font-heading text-xl font-bold mb-2">
            This period is not ready for board reporting yet.
          </div>
          <ul className="text-sm list-disc list-inside space-y-1">
            {friendly.map((label, i) => <li key={i}>{label}</li>)}
          </ul>
        </section>
        <SectionCard variant="subtle" title="Admin next steps">
          <ul className="space-y-1 text-sm">
            <li><a href={`/admin/review/${year}/${month}`} className="text-navy underline hover:no-underline">Open the review page →</a></li>
            {view.readiness.blockers.some((b) => b.includes("operator_notes")) && (
              <li><a href={`/admin/operator-notes/${year}/${month}`} className="text-navy underline hover:no-underline">Complete operator notes →</a></li>
            )}
            <li><a href="/admin/periods" className="text-navy underline hover:no-underline">All periods (admin) →</a></li>
          </ul>
        </SectionCard>
      </AppShell>
    );
  }

  // ---------------- READY: render the executive dashboard ----------------
  const h = view.currentMetrics;
  const noFacts = h.fact_row_count === 0;
  const activeList = distributionLists.find((l) => l.is_active);
  const statusLabel = view.period.status
    ? view.period.status.charAt(0).toUpperCase() + view.period.status.slice(1)
    : "No status";
  const lockedAtLabel = formatLocaleDateTime(view.period.locked_at);
  const uploadedAtLabel = formatLocaleDateTime(view.activeFile?.uploaded_at ?? null);
  const lastUpdatedLabel = formatLocaleDateTime(view.lockHistory[0]?.event_at ?? view.period.locked_at);
  const narrative = generateBoardNarrative(view);

  return (
    <AppShell
      hero={
        <HeroHeader
          eyebrow="U1DYNAMICS MANUFACTURING LLC"
          title="Board Report"
          subtitle={
            <div className="not-italic">
              <span className="font-medium text-white">{view.period.label}</span>
              <span className="mx-2 opacity-70">·</span>
              <span>Locked monthly operating view</span>
              <span className="mx-2 opacity-70">·</span>
              <a href="/board" className="underline opacity-90 hover:opacity-100">All locked periods</a>
              {view.reopenCount > 0 && (
                <span className="ml-2 text-[11px] bg-white/10 px-2 py-0.5 rounded-sm">
                  reopened {view.reopenCount === 1 ? "once" : `${view.reopenCount} times`}
                </span>
              )}
            </div>
          }
          actions={
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <HeroMetaItem label="Reporting period" value={view.period.label} />
                <HeroMetaItem label="Status" value={statusLabel} sub={`Locked by ${view.period.locked_by ?? "—"}`} />
                <HeroMetaItem label="Data freshness" value={uploadedAtLabel} sub={`Source v${view.activeFile?.version_no ?? "—"}`} />
                <HeroMetaItem label="Last updated" value={lastUpdatedLabel} sub={`Locked ${lockedAtLabel}`} />
              </div>
              <a
                href={`/api/admin/deck/${year}/${month}`}
                className="inline-flex shrink-0 items-center justify-center gap-2 bg-white text-navy hover:bg-gray-100 font-medium text-sm px-4 py-2.5 rounded-sm transition-colors shadow-sm"
                aria-label="Generate and download the PowerPoint board deck for this period"
              >
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                </svg>
                Generate board deck (.pptx)
              </a>
            </div>
          }
        />
      }
      nav={<Nav current="/board" />}
      contentClassName="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-7xl space-y-8"
    >
      {noFacts && (
        <section className="bg-amber-50 border border-amber-200 text-amber-900 rounded-sm px-5 py-4 text-sm">
          <div className="font-semibold">This period is locked but contains no volume facts.</div>
        </section>
      )}

      {/* 1. Executive snapshot — 8 KPI cards */}
      <SectionCard
        title="Executive Summary"
        subtitle="Locked-only data. YoY uses the same month one year prior; superseded versions are excluded."
      >
        <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Total gallons" value={fmtNum(h.total_gallons)} sub="this month" tone="navy" />
          <KpiCard
            label="Month over month"
            value={view.priorMonth ? fmtPct(view.priorMonth.delta_pct) : "—"}
            sub={view.priorMonth ? `${formatSigned(view.priorMonth.delta_gallons)} vs prior month` : "no prior month locked"}
            tone={
              view.priorMonth?.delta_pct === undefined || view.priorMonth?.delta_pct === null ? "navy"
                : view.priorMonth.delta_pct >= 0 ? "ok" : "warn"
            }
          />
          <KpiCard
            label="Year over year"
            value={view.priorYear ? fmtPct(view.priorYear.delta_pct) : "—"}
            sub={view.priorYear ? `${formatSigned(view.priorYear.delta_gallons)} vs same month ${year - 1}` : "no prior year locked"}
            tone={
              view.priorYear?.delta_pct === undefined || view.priorYear?.delta_pct === null ? "navy"
                : view.priorYear.delta_pct >= 0 ? "ok" : "warn"
            }
          />
          <KpiCard
            label="YTD gallons"
            value={fmtNum(view.ytd.current_year_gallons)}
            sub={view.ytd.prior_year_gallons !== null
              ? `${view.ytd.delta_pct !== null ? fmtPct(view.ytd.delta_pct) : "—"} vs prior YTD`
              : "no prior YTD"}
            tone={view.ytd.delta_pct === null ? "navy" : view.ytd.delta_pct >= 0 ? "ok" : "warn"}
          />
          <KpiCard label="Customers" value={fmtNum(h.customer_count)} sub="active this period" tone="neutral" />
          <KpiCard label="Package types" value={fmtNum(h.package_count)} sub="distinct" tone="neutral" />
          <KpiCard label="Alerts resolved" value={fmtNum(view.alertSummary.resolved_alerts_total)} sub="during close" tone="ok" />
          <KpiCard
            label="Reopens"
            value={String(view.reopenCount)}
            sub={view.reopenCount === 0 ? "first lock held" : "revisions before final lock"}
            tone={view.reopenCount === 0 ? "ok" : "warn"}
          />
        </div>
        <p className="mt-3 text-[11px] italic text-gray-500">
          YTD includes {view.ytd.months_included} of {view.ytd.months_included + view.ytd.months_missing} months locked this year.
        </p>

        <div className="mt-6 border-t border-gray-100 pt-5">
          <div className="mb-5">
            <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 font-semibold">
              Board narrative
            </div>
            {narrative.sections
              .find((section) => section.id === "executive-readout")
              ?.paragraphs?.map((paragraph, i) => (
                <p key={i} className="mt-2 max-w-5xl text-sm leading-relaxed text-gray-800">
                  {paragraph}
                </p>
              ))}
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {narrative.sections
              .filter((section) => section.id !== "executive-readout")
              .map((section) => (
                <div key={section.id}>
                  <h3 className="mb-3 text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                    {section.title}
                  </h3>
                  <ul className="space-y-2">
                    {(section.bullets ?? []).map((bullet, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-gray-800">
                        <NarrativeSeverityBadge severity={bullet.severity} />
                        <span>{bullet.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        </div>
      </SectionCard>

      {/* 2. Revenue / volume */}
      <SectionCard
        title="Revenue / Volume"
        subtitle="Current board data is volume-based. Each bar is total gallons for a locked period; outline-only bars indicate periods not yet locked."
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TrendBars title="6-month trend" rows={view.trend6} />
          <TrendBars title="12-month trend" rows={view.trend12} />
        </div>
      </SectionCard>

      {/* 3. Customer intelligence */}
      <SectionCard
        title="Customer intelligence"
        meta={`Top ${view.topCustomers.length}`}
      >
        {/* Concentration strip */}
        <div className="grid auto-rows-fr grid-cols-1 gap-3 mb-5 sm:grid-cols-2 lg:grid-cols-4">
          <SmallStat label="Top customer share" value={view.customerConcentration.top_customer_share !== null
            ? fmtPct(view.customerConcentration.top_customer_share) : "—"}
            sub={view.customerConcentration.top_customer_name ?? "—"}
          />
          <SmallStat label="Top 5 share" value={view.customerConcentration.top5_share !== null
            ? fmtPct(view.customerConcentration.top5_share) : "—"}
            sub="combined"
          />
          <SmallStat label="Intercompany share" value={view.customerConcentration.intercompany_share !== null
            ? fmtPct(view.customerConcentration.intercompany_share) : "—"}
            sub="of total volume"
            tone={(view.customerConcentration.intercompany_share ?? 0) >= 0.5 ? "warn" : "ok"}
          />
          <SmallStat label="External share" value={view.customerConcentration.external_share !== null
            ? fmtPct(view.customerConcentration.external_share) : "—"}
            sub="non-intercompany"
          />
        </div>

        {/* Top customers table */}
        {view.topCustomers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                  <th className="text-left pb-2 pr-3 font-medium">#</th>
                  <th className="text-left pb-2 pr-3 font-medium">Customer</th>
                  <th className="text-right pb-2 pr-3 font-medium">Gallons</th>
                  <th className="text-right pb-2 pr-3 font-medium">Share</th>
                  <th className="text-right pb-2 pr-3 font-medium">MoM</th>
                  <th className="text-right pb-2 pr-3 font-medium">YoY</th>
                </tr>
              </thead>
              <tbody>
                {view.topCustomers.map((c, i) => (
                  <tr key={c.customer_key ?? `c-${i}`} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                    <td className="py-2.5 pr-3 text-gray-400 tabular-nums">{i + 1}</td>
                    <td className="py-2.5 pr-3 text-navy">
                      {c.customer_name}
                      {c.is_intercompany && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-gray-500">intercomp.</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums font-medium">{fmtNum(c.gallons)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-gray-700">
                      {c.share_pct !== null ? fmtPct(c.share_pct) : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right"><DeltaText value={c.mom_delta_pct} /></td>
                    <td className="py-2.5 pr-3 text-right"><DeltaText value={c.yoy_delta_pct} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(view.customerMovers.topGainers.length > 0 || view.customerMovers.topDecliners.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <MoversBlock title="Customers increasing materially" tone="ok" rows={view.customerMovers.topGainers} />
            <MoversBlock title="Customers decreasing materially" tone="warn" rows={view.customerMovers.topDecliners} />
          </div>
        )}
      </SectionCard>

      {/* 4. Product / package mix */}
      <SectionCard
        title="Product / package mix"
        meta={`Top ${view.topPackages.length}`}
      >
        {/* Category mix bar */}
        {view.categoryMix.slices.length > 0 && (
          <div className="mb-5">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Category mix</div>
            <div className="w-full h-6 flex rounded-sm overflow-hidden border border-gray-300">
              {view.categoryMix.slices.map((s) => (
                <div
                  key={s.category}
                  title={`${s.category}: ${fmtNum(s.gallons)} gal · ${fmtPct(s.share)}`}
                  style={{ width: `${s.share * 100}%`, backgroundColor: CATEGORY_BG[s.category] ?? "#9CA3AF" }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-700">
              {view.categoryMix.slices.map((s) => (
                <span key={s.category}>
                  <span className="inline-block w-3 h-3 mr-1 align-middle rounded-sm"
                    style={{ backgroundColor: CATEGORY_BG[s.category] ?? "#9CA3AF" }} />
                  {s.category}: {fmtPct(s.share)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Top packages table */}
        {view.topPackages.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                  <th className="text-left pb-2 pr-3 font-medium">#</th>
                  <th className="text-left pb-2 pr-3 font-medium">Package</th>
                  <th className="text-left pb-2 pr-3 font-medium">Family</th>
                  <th className="text-right pb-2 pr-3 font-medium">Gallons</th>
                  <th className="text-right pb-2 pr-3 font-medium">Share</th>
                  <th className="text-right pb-2 pr-3 font-medium">MoM</th>
                  <th className="text-right pb-2 pr-3 font-medium">YoY</th>
                </tr>
              </thead>
              <tbody>
                {view.topPackages.map((p, i) => (
                  <tr key={p.package_key ?? `p-${i}`} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                    <td className="py-2.5 pr-3 text-gray-400 tabular-nums">{i + 1}</td>
                    <td className="py-2.5 pr-3 text-navy">{p.package_label}</td>
                    <td className="py-2.5 pr-3 text-gray-500 text-xs uppercase tracking-wider">{p.family}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums font-medium">{fmtNum(p.gallons)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-gray-700">
                      {p.share_pct !== null ? fmtPct(p.share_pct) : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right"><DeltaText value={p.mom_delta_pct} /></td>
                    <td className="py-2.5 pr-3 text-right"><DeltaText value={p.yoy_delta_pct} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(view.packageMovers.topGainers.length > 0 || view.packageMovers.topDecliners.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <MoversBlock title="Packages increasing materially" tone="ok" rows={view.packageMovers.topGainers} />
            <MoversBlock title="Packages decreasing materially" tone="warn" rows={view.packageMovers.topDecliners} />
          </div>
        )}
      </SectionCard>

      {/* 5. Operational narrative + 6. Management attention */}
      {view.operatorNotes && (
        <>
          <SectionCard
            title="Operational narrative"
            subtitle={
              <>Operator-authored narrative for this close. Marked complete on{" "}
                {formatLocaleDateTime(view.operatorNotes.completed_at)} by{" "}
                {view.operatorNotes.completed_by ?? "—"}.</>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {(["capacity_production", "supply_chain", "quality_incidents"] as SectionKey[]).map((k) => (
                <div key={k}>
                  <h3 className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">{SECTION_LABELS[k]}</h3>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                    {view.operatorNotes![k] || <span className="italic text-gray-400">—</span>}
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Management attention"
            subtitle="Strategic initiatives and risks the board should be aware of. Sourced from operator notes."
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="border-l-4 border-navy pl-4">
                <h3 className="text-[11px] uppercase tracking-wider text-navy font-bold mb-2">
                  {SECTION_LABELS.initiatives}
                </h3>
                <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {view.operatorNotes.initiatives || <span className="italic text-gray-400">—</span>}
                </p>
              </div>
              <div className="border-l-4 border-amber-500 pl-4">
                <h3 className="text-[11px] uppercase tracking-wider text-amber-700 font-bold mb-2">
                  {SECTION_LABELS.risks}
                </h3>
                <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {view.operatorNotes.risks || <span className="italic text-gray-400">—</span>}
                </p>
              </div>
            </div>
          </SectionCard>
        </>
      )}

      {/* 7. Operational alerts */}
      <SectionCard
        title="Operational Alerts"
        subtitle="Close quality, alert resolution, and audit trail for the locked period."
      >
        <div className="grid auto-rows-fr grid-cols-1 gap-3 text-sm mb-4 sm:grid-cols-2 lg:grid-cols-5">
          <SmallStat label="Package alerts" value={fmtNum(view.alertSummary.package_alerts_total)} />
          <SmallStat label="Customer alerts" value={fmtNum(view.alertSummary.customer_alerts_total)} />
          <SmallStat label="Data quality alerts" value={fmtNum(view.alertSummary.data_quality_alerts_total)} />
          <SmallStat label="Resolved" value={fmtNum(view.alertSummary.resolved_alerts_total)} tone="ok" />
          <SmallStat label="Pending" value={fmtNum(view.alertSummary.pending_alerts_total)}
            tone={view.alertSummary.pending_alerts_total === 0 ? "ok" : "warn"} />
        </div>

        {view.lockHistory.length > 0 && (
          <div className="mt-4">
            <h3 className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Lock history</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-200">
                  <th className="text-left pb-1 pr-2 font-medium">Event</th>
                  <th className="text-left pb-1 pr-2 font-medium">At</th>
                  <th className="text-left pb-1 pr-2 font-medium">By</th>
                  <th className="text-left pb-1 pr-2 font-medium">Version</th>
                </tr>
              </thead>
              <tbody>
                {view.lockHistory.slice(0, 5).map((e) => (
                  <tr key={e.event_id} className="border-b border-gray-100 last:border-b-0">
                    <td className="py-1 pr-2">
                      <span className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm ${
                        e.event_type === "locked" ? "bg-emerald-50 text-emerald-900" : "bg-purple-50 text-purple-900"
                      }`}>{e.event_type}</span>
                    </td>
                    <td className="py-1 pr-2 tabular-nums text-gray-700 whitespace-nowrap">{formatLocaleDateTime(e.event_at)}</td>
                    <td className="py-1 pr-2 text-gray-700">{e.event_by}</td>
                    <td className="py-1 pr-2 text-xs text-gray-500">{e.version_no !== null ? `v${e.version_no}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {view.activeFile && (
          <div className="mt-5 pt-4 border-t border-gray-200">
            <h3 className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Data provenance</h3>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-xs">
              <ProvItem label="Active file" value={view.activeFile.filename} />
              <ProvItem label="Version" value={`v${view.activeFile.version_no}`} />
              <ProvItem label="Hash prefix" value={view.activeFile.file_hash_prefix} mono />
              <ProvItem label="Discrepancy" value={view.activeFile.has_total_discrepancy ? "flagged" : "none"}
                tone={view.activeFile.has_total_discrepancy ? "warn" : "ok"} />
              <ProvItem label="Uploaded by" value={view.activeFile.uploaded_by ?? "—"} />
              <ProvItem label="Uploaded at" value={formatLocaleDateTime(view.activeFile.uploaded_at)} />
              <ProvItem label="Locked by" value={view.period.locked_by ?? "—"} />
              <ProvItem label="Locked at" value={formatLocaleDateTime(view.period.locked_at)} />
            </dl>
          </div>
        )}
      </SectionCard>

      {/* Send / distribution history */}
      <SectionCard
        title="Send / Distribution History"
        subtitle={<>Deck distribution is audited in <code>u1d_ops.board_deck_sends</code>.</>}
      >
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(280px,0.75fr)_minmax(0,1.25fr)]">
          <div className="rounded-sm border border-gray-200 bg-gray-50 p-4">
            <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 font-semibold">
              Active distribution list
            </div>
            {activeList ? (
              <div className="mt-3 space-y-3">
                <div>
                  <div className="font-heading text-xl font-bold text-navy leading-tight">
                    {activeList.name}
                  </div>
                  <div className="mt-1 text-xs text-gray-600">
                    {activeList.active_to_count} to · {activeList.active_cc_count} cc · {activeList.active_bcc_count} bcc
                  </div>
                </div>
                <EmailBoardDeckButton
                  year={year} month={month}
                  distributionListId={activeList.list_id}
                  distributionListName={activeList.name}
                  recipientCount={activeList.active_to_count}
                />
              </div>
            ) : (
              <div className="mt-3 text-xs italic text-gray-500">
                No distribution list configured.
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <h3 className="text-[11px] uppercase tracking-[0.16em] text-gray-500 font-semibold">
                Recent deck sends
              </h3>
              <span className="text-xs text-gray-500 tabular-nums">{recentSends.length}</span>
            </div>
            <SendHistoryPanel sends={recentSends} />
          </div>
        </div>
      </SectionCard>
    </AppShell>
  );
}

// ---------------- Small server components ----------------

function HeroMetaItem({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-h-[86px] rounded-sm border border-white/15 bg-white/10 px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/65 font-semibold leading-snug">
        {label}
      </div>
      <div className="mt-2 text-sm font-semibold text-white tabular-nums leading-snug">
        {value}
      </div>
      {sub && (
        <div className="mt-1 text-[11px] text-white/70 leading-snug line-clamp-2">
          {sub}
        </div>
      )}
    </div>
  );
}

const CATEGORY_BG: Record<string, string> = {
  Oil: "#003C71",
  Coolant: "#E1261C",
  WW: "#F59E0B",
  DEF: "#6B7280",
  Other: "#9CA3AF",
};

function SmallStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "neutral" }) {
  const palette = tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900"
    : "border-gray-200 bg-white text-navy";
  return (
    <div className={`flex h-full min-h-[92px] flex-col border rounded-sm px-3.5 py-3 ${palette}`}>
      <div className="min-h-[1.75rem] text-[10px] uppercase tracking-[0.14em] opacity-80 leading-snug">{label}</div>
      <div className="font-heading text-xl font-bold mt-1 leading-none tabular-nums">{value}</div>
      {sub && <div className="text-[10px] opacity-70 mt-auto pt-2 truncate">{sub}</div>}
    </div>
  );
}

const NARRATIVE_BADGE: Record<NarrativeSeverity, { label: string; className: string }> = {
  positive: { label: "OK", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  neutral: { label: "Note", className: "border-gray-200 bg-gray-50 text-gray-600" },
  watch: { label: "Watch", className: "border-amber-200 bg-amber-50 text-amber-800" },
  risk: { label: "Risk", className: "border-red-200 bg-red-50 text-red-800" },
};

function NarrativeSeverityBadge({ severity }: { severity: NarrativeSeverity }) {
  const badge = NARRATIVE_BADGE[severity];
  return (
    <span className={`mt-0.5 inline-flex min-w-[3.25rem] justify-center rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${badge.className}`}>
      {badge.label}
    </span>
  );
}

function TrendBars({ title, rows }: { title: string; rows: { period_year: number; period_month: number; label: string; total_gallons: number; is_locked: boolean }[] }) {
  if (rows.length === 0) {
    return (
      <div>
        <h3 className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">{title}</h3>
        <div className="text-sm italic text-gray-400">No data.</div>
      </div>
    );
  }
  const max = rows.reduce((m, r) => Math.max(m, r.total_gallons), 0) || 1;
  return (
    <div>
      <h3 className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">{title}</h3>
      <div className="flex items-end gap-1 h-32">
        {rows.map((r) => (
          <div key={`${r.period_year}-${r.period_month}`} className="flex-1 flex flex-col items-center"
            title={`${r.label}: ${fmtNum(r.total_gallons)} gal${r.is_locked ? "" : " (not locked)"}`}>
            <div className={`w-full ${r.is_locked ? "bg-navy" : "bg-white border border-navy/40"}`}
              style={{ height: `${(r.total_gallons / max) * 100}%`, minHeight: r.total_gallons > 0 ? "2px" : "0" }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-2 text-[10px] text-gray-500">
        {rows.map((r) => (
          <div key={`${r.period_year}-${r.period_month}-lbl`} className="flex-1 text-center truncate">
            {monthShort(r.period_month)}
          </div>
        ))}
      </div>
    </div>
  );
}

function monthShort(m: number): string {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return names[m - 1] ?? `M${m}`;
}

function MoversBlock({ title, tone, rows }: { title: string; tone: "ok" | "warn"; rows: { key: string; display_name: string; delta_gallons: number; delta_pct: number | null }[] }) {
  const color = tone === "ok" ? "text-emerald-700" : "text-red-700";
  if (rows.length === 0) {
    return (
      <div>
        <h3 className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">{title}</h3>
        <div className="text-sm italic text-gray-400">No material movers.</div>
      </div>
    );
  }
  return (
    <div>
      <h3 className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">{title}</h3>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-gray-100 last:border-b-0">
              <td className="py-1.5 pr-2 text-navy">{r.display_name}</td>
              <td className={`py-1.5 pr-2 text-right tabular-nums font-medium ${color}`}>
                {formatSigned(r.delta_gallons)}
              </td>
              <td className={`py-1.5 text-right tabular-nums ${color}`}>
                {r.delta_pct !== null ? fmtPct(r.delta_pct) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProvItem({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: "ok" | "warn" }) {
  const valClass = tone === "warn" ? "text-amber-900"
    : tone === "ok" ? "text-emerald-900"
    : "text-gray-800";
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className={`${valClass} ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
