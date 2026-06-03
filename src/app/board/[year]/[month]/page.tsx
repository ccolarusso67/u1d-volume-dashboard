/**
 * src/app/board/[year]/[month]/page.tsx
 *
 * Executive board dashboard. Bilingual (EN/ES) via getLocale() + the board
 * dictionary; the auto-generated narrative and decision cards are localized
 * inside their generator modules (narrative.ts / decision-cards.ts).
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
import { getReconciliation } from "@/lib/queries/production";
import { VolumeGoalChart } from "@/components/charts/VolumeGoalChart";
import { RangeSelector, rangeMonths, rangeLabel, normalizeRange } from "@/components/range-selector";
import type { MonthlyPnl } from "@/lib/finance/types";
import type { BoardFinanceOverlay } from "@/lib/board/executive-types";
import { generateBoardNarrative, type NarrativeSeverity } from "@/lib/board/narrative";
import {
  getVolumeDecisionCard,
  getMarginDecisionCard,
  getCashDecisionCard,
  getCustomerDecisionCard,
  type DecisionCard as DecisionCardData,
  type DecisionTone,
} from "@/lib/board/decision-cards";
import { listDistributionLists } from "@/lib/distribution/list-distribution-lists";
import { listBoardDeckSends } from "@/lib/distribution/list-board-deck-sends";
import { formatBlockerLabels } from "@/lib/review/blocker-labels";
import { fmtNum, fmtPct } from "@/lib/brand";
import { getSectionLabels, type SectionKey } from "@/lib/operator-notes/types";
import { EmailBoardDeckButton } from "@/components/board/email-board-deck-button";
import { SendHistoryPanel } from "@/components/board/send-history-panel";
import { getLocale } from "@/lib/i18n/server";
import { getDict } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locale";

const MON_SHORT_BOARD_EN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MON_SHORT_BOARD_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

export const dynamic = "force-dynamic";

type Params = { year: string; month: string };

function isLocalBoardPreview(): boolean {
  return process.env.NODE_ENV !== "production" &&
    process.env.U1D_LOCAL_BOARD_PREVIEW === "1";
}

function localeCode(locale: Locale): "en-US" | "es-ES" {
  return locale === "es" ? "es-ES" : "en-US";
}

function formatLocaleDateTime(iso: string | null, locale: Locale): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (isNaN(dt.valueOf())) return iso;
  return dt.toLocaleString(localeCode(locale), {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function formatSigned(n: number | null, locale: Locale): string {
  if (n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${fmtNum(n, 0, locale)}`;
}

function formatMoney(n: number | null, locale: Locale): string {
  if (n === null) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${fmtNum(Math.abs(n), 0, locale)}`;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function pnlMarginPct(row: MonthlyPnl, locale: Locale): string {
  const income = num(row.income);
  if (income === 0) return "—";
  return fmtPct(num(row.gross_profit) / income, 1, false, locale);
}

function marginTone(row: MonthlyPnl): "ok" | "warn" | "neutral" {
  const income = num(row.income);
  if (income === 0) return "neutral";
  return num(row.gross_profit) / income >= 0 ? "ok" : "warn";
}

function monthShort(m: number, locale: Locale): string {
  const names = locale === "es" ? MON_SHORT_BOARD_ES : MON_SHORT_BOARD_EN;
  return names[m - 1] ?? `M${m}`;
}

function pnlMonthLabel(monthIso: string, locale: Locale): string {
  const dt = new Date(monthIso);
  if (isNaN(dt.valueOf())) return monthIso;
  return `${monthShort(dt.getUTCMonth() + 1, locale)} ${dt.getUTCFullYear()}`;
}

function financeFreshness(
  finance: { sync_assessment: { worst_status: "ok" | "stale" | "error"; newest_success_at: string | null } },
  tb: ReturnType<typeof getDict>["board"],
  locale: Locale
): string {
  const a = finance.sync_assessment;
  if (a.worst_status === "error") return tb.syncError;
  if (a.worst_status === "stale") return tb.syncStale;
  if (a.newest_success_at) return tb.syncLast(formatLocaleDateTime(a.newest_success_at, locale));
  return "";
}

function DeltaText({ value, locale }: { value: number | null; locale: Locale }) {
  if (value === null) return <span className="text-gray-400">—</span>;
  const positive = value >= 0;
  return (
    <span className={`tabular-nums font-medium ${positive ? "text-emerald-700" : "text-red-700"}`}>
      {positive ? "+" : ""}{fmtPct(value, 1, true, locale)}
    </span>
  );
}

export default async function BoardDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const locale = await getLocale();
  const d = getDict(locale);
  const tb = d.board;
  const sectionLabels = getSectionLabels(locale);

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
            eyebrow={d.common.company}
            title={`Board · ${year}-${String(month).padStart(2, "0")}`}
            subtitle={tb.loadErrorSubtitle}
          />
        }
        nav={<Nav current="/board" />}
        contentClassName="container mx-auto px-8 py-8 max-w-3xl"
      >
        <div role="alert" className="bg-red-50 border border-red-200 text-red-900 rounded-sm px-4 py-3 text-sm">
          <div className="font-semibold">{tb.loadErrorTitle}</div>
          <div className="text-xs mt-1 font-mono">
            {err instanceof Error ? err.message : tb.unknownError}
          </div>
        </div>
      </AppShell>
    );
  }

  const statusText = (s: string | null | undefined) =>
    s ? (tb.status[s] ?? (s.charAt(0).toUpperCase() + s.slice(1))) : tb.status.noStatus;

  // ---------------- Blocked state ----------------
  if (!view.readiness.ready) {
    const friendly = formatBlockerLabels(view.readiness.blockers, locale);
    return (
      <AppShell
        hero={
          <HeroHeader
            eyebrow={d.common.company}
            title={`${view.period.label} · ${tb.blockedTitleSuffix}`}
            subtitle={<>{tb.currentStatus} <span className="not-italic font-medium">{statusText(view.period.status) ?? tb.noRow}</span></>}
          />
        }
        nav={<Nav current="/board" />}
        contentClassName="container mx-auto px-8 py-8 max-w-3xl space-y-4"
      >
        <section className="bg-amber-50 border border-amber-200 text-amber-900 rounded-sm px-5 py-4">
          <div className="font-heading text-xl font-bold mb-2">
            {tb.notReady}
          </div>
          <ul className="text-sm list-disc list-inside space-y-1">
            {friendly.map((label, i) => <li key={i}>{label}</li>)}
          </ul>
        </section>
        <SectionCard variant="subtle" title={tb.adminNextSteps}>
          <ul className="space-y-1 text-sm">
            <li><a href={`/admin/review/${year}/${month}`} className="text-navy underline hover:no-underline">{tb.openReview}</a></li>
            {view.readiness.blockers.some((b) => b.includes("operator_notes")) && (
              <li><a href={`/admin/operator-notes/${year}/${month}`} className="text-navy underline hover:no-underline">{tb.completeNotes}</a></li>
            )}
            <li><a href="/admin/periods" className="text-navy underline hover:no-underline">{tb.allPeriodsAdmin}</a></li>
          </ul>
        </SectionCard>
      </AppShell>
    );
  }

  // ---------------- READY: render the executive dashboard ----------------
  const h = view.currentMetrics;
  const noFacts = h.fact_row_count === 0;

  const reconRows = await getReconciliation();
  const wdByPeriod = new Map(reconRows.map((r) => [`${r.period_year}-${r.period_month}`, r.working_days]));
  const dailyTarget = view.volumeGoal?.daily_target ?? 7000;

  const boardRange = normalizeRange((await searchParams).range);
  const boardMonths = rangeMonths(boardRange);
  const boardOrd = year * 12 + month;
  const winRows = reconRows
    .filter((r) => r.billed_gallons != null && r.period_year * 12 + r.period_month <= boardOrd)
    .sort((a, b) => (b.period_year * 12 + b.period_month) - (a.period_year * 12 + a.period_month))
    .slice(0, boardMonths);
  const winVol = winRows.reduce((s, r) => s + (r.billed_gallons ?? 0), 0);
  const winWd = winRows.reduce((s, r) => s + (r.working_days ?? 0), 0);
  const winGoal = winWd * dailyTarget;
  const winDelta = winVol - winGoal;
  const winMet = winVol >= winGoal;
  const winSuffix = boardMonths === 1 ? "" : ` · ${rangeLabel(boardRange)}`;

  const bBilledByOrd = new Map<number, number>();
  for (const r of reconRows) {
    if (r.billed_gallons != null) bBilledByOrd.set(r.period_year * 12 + r.period_month, r.billed_gallons);
  }
  const bCur = bBilledByOrd.get(boardOrd) ?? h.total_gallons;
  const bCompare = [
    { label: d.common.vs3Months, ref: bBilledByOrd.get(boardOrd - 3) ?? null },
    { label: d.common.vs6Months, ref: bBilledByOrd.get(boardOrd - 6) ?? null },
    { label: d.common.vsYearAgo, ref: bBilledByOrd.get(boardOrd - 12) ?? null },
  ];

  const sumWindow = (endOrd: number, mo: number): number | null => {
    let s = 0;
    let any = false;
    for (let k = 0; k < mo; k++) {
      const v = bBilledByOrd.get(endOrd - k);
      if (v != null) { s += v; any = true; }
    }
    return any ? s : null;
  };
  const winCur = sumWindow(boardOrd, boardMonths);
  const winPrevPeriod = sumWindow(boardOrd - boardMonths, boardMonths);
  const winYearAgo = sumWindow(boardOrd - 12, boardMonths);
  const popPct = winCur != null && winPrevPeriod ? (winCur - winPrevPeriod) / winPrevPeriod : null;
  const popDelta = winCur != null && winPrevPeriod != null ? winCur - winPrevPeriod : null;
  const yoyPctWin = winCur != null && winYearAgo ? (winCur - winYearAgo) / winYearAgo : null;
  const yoyDeltaWin = winCur != null && winYearAgo != null ? winCur - winYearAgo : null;
  const popLabel = boardMonths === 1 ? tb.monthOverMonth : tb.periodOverPeriod(winSuffix);
  const yoyLabel = boardMonths === 1 ? tb.yearOverYear : tb.yearOverYearWin(winSuffix);
  const popSubUnit = boardMonths === 1 ? tb.vsPriorMonth : tb.vsPriorWindow(rangeLabel(boardRange));
  const boardVolGoalSeries = view.trend12.map((tr) => {
    const wd = wdByPeriod.get(`${tr.period_year}-${tr.period_month}`);
    return {
      month: monthShort(tr.period_month, locale),
      billed: Math.round(tr.total_gallons),
      goal: wd != null ? wd * dailyTarget : null,
    };
  });
  const activeList = distributionLists.find((l) => l.is_active);
  const lockedAtLabel = formatLocaleDateTime(view.period.locked_at, locale);
  const uploadedAtLabel = formatLocaleDateTime(view.activeFile?.uploaded_at ?? null, locale);
  const lastUpdatedLabel = formatLocaleDateTime(view.lockHistory[0]?.event_at ?? view.period.locked_at, locale);
  const narrative = generateBoardNarrative(view, locale);

  const decisionVolume = getVolumeDecisionCard(view, locale);
  const decisionMargin = getMarginDecisionCard(view, locale);
  const decisionCash = getCashDecisionCard(view, locale);
  const decisionCustomer = getCustomerDecisionCard(view, locale);

  return (
    <AppShell
      hero={
        <HeroHeader
          eyebrow={d.common.company}
          title={tb.title}
          subtitle={
            <div className="not-italic">
              <span className="font-medium text-white">{view.period.label}</span>
              <span className="mx-2 opacity-70">·</span>
              <span>{tb.lockedView}</span>
              <span className="mx-2 opacity-70">·</span>
              <a href="/board" className="underline opacity-90 hover:opacity-100">{tb.allLockedPeriods}</a>
              {view.reopenCount > 0 && (
                <span className="ml-2 text-[11px] bg-white/10 px-2 py-0.5 rounded-sm">
                  {view.reopenCount === 1 ? tb.reopenedOnce : tb.reopenedTimes(view.reopenCount)}
                </span>
              )}
            </div>
          }
          actions={
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <HeroMetaItem label={tb.metaReportingPeriod} value={view.period.label} />
                <HeroMetaItem label={tb.metaStatus} value={statusText(view.period.status)} sub={tb.lockedBy(view.period.locked_by ?? "—")} />
                <HeroMetaItem label={tb.metaDataFreshness} value={uploadedAtLabel} sub={tb.sourceV(String(view.activeFile?.version_no ?? "—"))} />
                <HeroMetaItem label={tb.metaLastUpdated} value={lastUpdatedLabel} sub={tb.lockedAtMeta(lockedAtLabel)} />
              </div>
              <a
                href={`/api/admin/deck/${year}/${month}`}
                className="inline-flex shrink-0 items-center justify-center gap-2 bg-white text-navy hover:bg-gray-100 font-medium text-sm px-4 py-2.5 rounded-sm transition-colors shadow-sm"
                aria-label={tb.generateDeckAria}
              >
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                </svg>
                {tb.generateDeck}
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
          <div className="font-semibold">{tb.noFacts}</div>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 mb-4">
        <span className="text-[10px] uppercase tracking-[0.14em] text-gray-400 font-semibold">{tb.goalWindow}</span>
        <RangeSelector current={boardRange} basePath={`/board/${year}/${month}`} />
      </div>

      {/* 1. Executive snapshot */}
      <SectionCard title={tb.execSummary} subtitle={tb.execSummarySub}>
        <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label={boardMonths === 1 ? tb.totalGallons : tb.totalGallonsWin(winSuffix)}
            value={fmtNum(boardMonths === 1 ? h.total_gallons : (winCur ?? h.total_gallons), 0, locale)}
            sub={boardMonths === 1 ? tb.thisMonth : tb.trailing(rangeLabel(boardRange))}
            tone="navy"
          />
          <KpiCard
            label={popLabel}
            value={popPct === null ? "—" : fmtPct(popPct, 1, true, locale)}
            sub={popDelta === null ? (boardMonths === 1 ? tb.noPriorMonthLocked : tb.noPriorWindowLocked) : `${formatSigned(popDelta, locale)} ${popSubUnit}`}
            tone={popPct === null ? "navy" : popPct >= 0 ? "ok" : "warn"}
          />
          <KpiCard
            label={yoyLabel}
            value={yoyPctWin === null ? "—" : fmtPct(yoyPctWin, 1, true, locale)}
            sub={yoyDeltaWin === null ? tb.noPriorYearLocked : `${formatSigned(yoyDeltaWin, locale)} ${tb.vsYear(year - 1)}`}
            tone={yoyPctWin === null ? "navy" : yoyPctWin >= 0 ? "ok" : "warn"}
          />
          <KpiCard
            label={tb.ytdGallons}
            value={fmtNum(view.ytd.current_year_gallons, 0, locale)}
            sub={view.ytd.prior_year_gallons !== null
              ? `${view.ytd.delta_pct !== null ? fmtPct(view.ytd.delta_pct, 1, true, locale) : "—"} ${tb.vsPriorYtd}`
              : tb.noPriorYtd}
            tone={view.ytd.delta_pct === null ? "navy" : view.ytd.delta_pct >= 0 ? "ok" : "warn"}
          />
          {winWd > 0 && (
            <KpiCard
              label={tb.volumeGoalWin(winSuffix)}
              value={fmtNum(winGoal, 0, locale)}
              sub={tb.daysTimesTarget(winWd, fmtNum(dailyTarget, 0, locale))}
              tone="navy"
            />
          )}
          {winWd > 0 && (
            <KpiCard
              label={tb.goalDeltaWin(winSuffix)}
              value={formatSigned(winDelta, locale)}
              sub={`${winMet ? tb.goalSurpassed : tb.belowGoal}${winGoal > 0 ? ` · ${fmtPct(winDelta / winGoal, 1, true, locale)}` : ""}`}
              tone={winMet ? "ok" : "warn"}
            />
          )}
          <KpiCard label={tb.customers} value={fmtNum(h.customer_count, 0, locale)} sub={tb.activeThisPeriod} tone="neutral" />
          <KpiCard label={tb.packageTypes} value={fmtNum(h.package_count, 0, locale)} sub={tb.distinct} tone="neutral" />
          <KpiCard label={tb.alertsResolved} value={fmtNum(view.alertSummary.resolved_alerts_total, 0, locale)} sub={tb.duringClose} tone="ok" />
          <KpiCard
            label={tb.reopens}
            value={String(view.reopenCount)}
            sub={view.reopenCount === 0 ? tb.firstLockHeld : tb.revisionsBeforeLock}
            tone={view.reopenCount === 0 ? "ok" : "warn"}
          />
        </div>
        <p className="mt-3 text-[11px] italic text-gray-500">
          {tb.ytdFootnote(view.ytd.months_included, view.ytd.months_included + view.ytd.months_missing)}
        </p>

        <div className="mt-6 border-t border-gray-100 pt-5">
          <div className="mb-5">
            <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 font-semibold">
              {tb.boardNarrative}
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
                        <NarrativeSeverityBadge severity={bullet.severity} tb={tb} />
                        <span>{bullet.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        </div>
      </SectionCard>

      {/* 2. Volume vs goal */}
      <SectionCard title={tb.volVsGoal} subtitle={tb.volVsGoalSub}>
        <div className="flex flex-wrap justify-end gap-4 text-xs text-gray-500 mb-2">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-navy" />{tb.billedVolume}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "#ED8B00" }} />
            {tb.monthlyGoalLegend(fmtNum(dailyTarget, 0, locale))}
          </span>
        </div>
        <VolumeGoalChart data={boardVolGoalSeries} />
        <DecisionCard card={decisionVolume} />
      </SectionCard>

      {/* Volume comparison */}
      <SectionCard title={tb.volComparison} subtitle={tb.volComparisonSub}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label={tb.thisPeriod} value={fmtNum(bCur, 0, locale)} sub={view.period.label} tone="navy" />
          {bCompare.map((c) => {
            const pct = c.ref != null && c.ref !== 0 ? (bCur - c.ref) / c.ref : null;
            return (
              <KpiCard
                key={c.label}
                label={c.label}
                value={pct == null ? "—" : `${pct >= 0 ? "+" : ""}${fmtPct(pct, 1, true, locale)}`}
                sub={c.ref == null ? tb.noPriorPeriod : tb.galSuffix(fmtNum(c.ref, 0, locale))}
                tone={pct == null ? "neutral" : pct >= 0 ? "ok" : "warn"}
              />
            );
          })}
        </div>
      </SectionCard>

      {/* 3. Financial performance */}
      <SectionCard
        title={tb.finPerf}
        subtitle={view.finance ? tb.finPerfSub(financeFreshness(view.finance, tb, locale)) : tb.finNotConnected}
      >
        {view.finance ? (
          <>
            {view.finance.current ? (
              <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard label={tb.revenue} value={formatMoney(num(view.finance.current.income), locale)} sub={tb.accrualSuffix(view.period.label)} tone="navy" />
                <KpiCard label={tb.cogs} value={formatMoney(num(view.finance.current.cogs), locale)} sub={tb.thisMonth} tone="neutral" />
                <KpiCard label={tb.grossProfit} value={formatMoney(num(view.finance.current.gross_profit), locale)} sub={tb.revenueLessCogs} tone={num(view.finance.current.gross_profit) >= 0 ? "ok" : "warn"} />
                <KpiCard
                  label={tb.grossMargin}
                  value={pnlMarginPct(view.finance.current, locale)}
                  sub={tb.gpDivRevenue}
                  tone={marginTone(view.finance.current)}
                />
              </div>
            ) : (
              <FinancialEmptyState>
                {tb.noPnlRow(view.period.label)}
              </FinancialEmptyState>
            )}

            <div className="mt-4 grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SmallStat label={tb.revenueTtm} value={formatMoney(view.finance.trailing_12m.income, locale)}
                sub={tb.monthsSynced(view.finance.trailing_12m.months_included)} />
              <SmallStat label={tb.grossMarginTtm} value={fmtPct(view.finance.trailing_12m.gross_margin_pct, 1, false, locale)}
                sub={tb.gpDivRevenue} tone={view.finance.trailing_12m.gross_margin_pct >= 0 ? "ok" : "warn"} />
              <SmallStat label={tb.netIncomeTtm} value={formatMoney(view.finance.trailing_12m.net_income, locale)}
                sub={tb.afterExpenses} tone={view.finance.trailing_12m.net_income >= 0 ? "ok" : "warn"} />
              <SmallStat label={tb.netMarginTtm} value={fmtPct(view.finance.trailing_12m.net_margin_pct, 1, false, locale)}
                sub={tb.niDivRevenue} tone={view.finance.trailing_12m.net_margin_pct >= 0 ? "ok" : "warn"} />
            </div>

            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div className="rounded-sm border border-gray-200 bg-gray-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                    {tb.workingCapital}
                  </h3>
                  {view.finance.working_capital.ap_to_ar_ratio !== null &&
                    view.finance.working_capital.ap_to_ar_ratio > 1 && (
                      <span className="rounded-sm border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-800">
                        {tb.apExceedsAr}
                      </span>
                    )}
                </div>
                <div className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm">
                  <FinancialMetric label={tb.accountsReceivable} value={formatMoney(view.finance.working_capital.total_ar, locale)} />
                  <FinancialMetric label={tb.accountsPayable} value={formatMoney(view.finance.working_capital.total_ap, locale)} />
                  <FinancialMetric label={tb.netWorkingCapital} value={formatMoney(view.finance.working_capital.net_position, locale)} />
                  <FinancialMetric
                    label={tb.apArRatio}
                    value={view.finance.working_capital.ap_to_ar_ratio !== null
                      ? `${view.finance.working_capital.ap_to_ar_ratio.toLocaleString(localeCode(locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`
                      : "—"}
                  />
                </div>
                {view.finance.working_capital.snapshot_at && (
                  <p className="mt-3 text-[10px] italic text-gray-500">
                    {tb.arApSnapshot(formatLocaleDateTime(view.finance.working_capital.snapshot_at, locale))}
                  </p>
                )}
              </div>

              <div className="rounded-sm border border-gray-200 bg-gray-50 p-4">
                <h3 className="mb-3 text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                  {tb.monthlyTrend}
                </h3>
                {view.finance.pnl_trend.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-[10px] uppercase tracking-wider text-gray-500">
                          <th className="pb-2 pr-3 text-left font-medium">{tb.thMonth}</th>
                          <th className="pb-2 pr-3 text-right font-medium">{tb.revenue}</th>
                          <th className="pb-2 pr-3 text-right font-medium">{tb.cogs}</th>
                          <th className="pb-2 pr-3 text-right font-medium">{tb.grossProfit}</th>
                          <th className="pb-2 text-right font-medium">{tb.thMargin}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {view.finance.pnl_trend.slice(-6).map((row) => (
                          <tr key={row.month} className="border-b border-gray-100 last:border-b-0">
                            <td className="py-2 pr-3 text-navy">{pnlMonthLabel(row.month, locale)}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(num(row.income), locale)}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(num(row.cogs), locale)}</td>
                            <td className="py-2 pr-3 text-right tabular-nums font-medium">{formatMoney(num(row.gross_profit), locale)}</td>
                            <td className="py-2 text-right tabular-nums">{pnlMarginPct(row, locale)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">
                    {tb.noPnlTrend}
                  </p>
                )}
              </div>
            </div>

            <DecisionCard card={decisionMargin} />
            <DecisionCard card={decisionCash} />
          </>
        ) : (
          <FinancialEmptyState>
            {tb.finNotConnectedLong}
          </FinancialEmptyState>
        )}
      </SectionCard>

      {/* 4. Customer intelligence */}
      <SectionCard
        title={tb.customerIntel}
        subtitle={tb.customerIntelSub}
        meta={tb.topN(view.topCustomers.length)}
      >
        <div className="grid auto-rows-fr grid-cols-1 gap-3 mb-5 sm:grid-cols-2 lg:grid-cols-4">
          <SmallStat label={tb.topCustomerShare} value={view.customerConcentration.top_customer_share !== null
            ? fmtPct(view.customerConcentration.top_customer_share, 1, true, locale) : "—"}
            sub={view.customerConcentration.top_customer_name ?? "—"}
          />
          <SmallStat label={tb.top5Share} value={view.customerConcentration.top5_share !== null
            ? fmtPct(view.customerConcentration.top5_share, 1, true, locale) : "—"}
            sub={tb.combined}
          />
          <SmallStat label={tb.intercompanyShare} value={view.customerConcentration.intercompany_share !== null
            ? fmtPct(view.customerConcentration.intercompany_share, 1, true, locale) : "—"}
            sub={tb.ofTotalVolume}
            tone={(view.customerConcentration.intercompany_share ?? 0) >= 0.5 ? "warn" : "ok"}
          />
          <SmallStat label={tb.externalShare} value={view.customerConcentration.external_share !== null
            ? fmtPct(view.customerConcentration.external_share, 1, true, locale) : "—"}
            sub={tb.nonIntercompany}
          />
        </div>

        {view.topCustomers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                  <th className="text-left pb-2 pr-3 font-medium">{tb.thRank}</th>
                  <th className="text-left pb-2 pr-3 font-medium">{tb.thCustomer}</th>
                  <th className="text-right pb-2 pr-3 font-medium">{tb.thGallons}</th>
                  <th className="text-right pb-2 pr-3 font-medium">{tb.thShare}</th>
                  <th className="text-right pb-2 pr-3 font-medium">{tb.thMoM}</th>
                  <th className="text-right pb-2 pr-3 font-medium">{tb.thYoY}</th>
                </tr>
              </thead>
              <tbody>
                {view.topCustomers.map((c, i) => (
                  <tr key={c.customer_key ?? `c-${i}`} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                    <td className="py-2.5 pr-3 text-gray-400 tabular-nums">{i + 1}</td>
                    <td className="py-2.5 pr-3 text-navy">
                      {c.customer_name}
                      {c.is_intercompany && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-gray-500">{tb.intercompanyShort}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums font-medium">{fmtNum(c.gallons, 0, locale)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-gray-700">
                      {c.share_pct !== null ? fmtPct(c.share_pct, 1, true, locale) : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right"><DeltaText value={c.mom_delta_pct} locale={locale} /></td>
                    <td className="py-2.5 pr-3 text-right"><DeltaText value={c.yoy_delta_pct} locale={locale} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(view.customerMovers.topGainers.length > 0 || view.customerMovers.topDecliners.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <MoversBlock title={tb.custIncreasing} tone="ok" rows={view.customerMovers.topGainers} locale={locale} emptyLabel={tb.noMovers} />
            <MoversBlock title={tb.custDecreasing} tone="warn" rows={view.customerMovers.topDecliners} locale={locale} emptyLabel={tb.noMovers} />
          </div>
        )}
        <DecisionCard card={decisionCustomer} />
      </SectionCard>

      {/* 5. Product / package mix */}
      <SectionCard title={tb.productMix} meta={tb.topN(view.topPackages.length)}>
        {view.categoryMix.slices.length > 0 && (
          <div className="mb-5">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">{tb.categoryMix}</div>
            <div className="w-full h-6 flex rounded-sm overflow-hidden border border-gray-300">
              {view.categoryMix.slices.map((s) => (
                <div
                  key={s.category}
                  title={tb.catTitle(d.common.categories[s.category] ?? s.category, fmtNum(s.gallons, 0, locale), fmtPct(s.share, 1, true, locale))}
                  style={{ width: `${s.share * 100}%`, backgroundColor: CATEGORY_BG[s.category] ?? "#9CA3AF" }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-700">
              {view.categoryMix.slices.map((s) => (
                <span key={s.category}>
                  <span className="inline-block w-3 h-3 mr-1 align-middle rounded-sm"
                    style={{ backgroundColor: CATEGORY_BG[s.category] ?? "#9CA3AF" }} />
                  {d.common.categories[s.category] ?? s.category}: {fmtPct(s.share, 1, true, locale)}
                </span>
              ))}
            </div>
          </div>
        )}

        {view.topPackages.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                  <th className="text-left pb-2 pr-3 font-medium">{tb.thRank}</th>
                  <th className="text-left pb-2 pr-3 font-medium">{tb.thPackage}</th>
                  <th className="text-left pb-2 pr-3 font-medium">{tb.thFamily}</th>
                  <th className="text-right pb-2 pr-3 font-medium">{tb.thGallons}</th>
                  <th className="text-right pb-2 pr-3 font-medium">{tb.thShare}</th>
                  <th className="text-right pb-2 pr-3 font-medium">{tb.thMoM}</th>
                  <th className="text-right pb-2 pr-3 font-medium">{tb.thYoY}</th>
                </tr>
              </thead>
              <tbody>
                {view.topPackages.map((p, i) => (
                  <tr key={p.package_key ?? `p-${i}`} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                    <td className="py-2.5 pr-3 text-gray-400 tabular-nums">{i + 1}</td>
                    <td className="py-2.5 pr-3 text-navy">{p.package_label}</td>
                    <td className="py-2.5 pr-3 text-gray-500 text-xs uppercase tracking-wider">{p.family}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums font-medium">{fmtNum(p.gallons, 0, locale)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-gray-700">
                      {p.share_pct !== null ? fmtPct(p.share_pct, 1, true, locale) : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right"><DeltaText value={p.mom_delta_pct} locale={locale} /></td>
                    <td className="py-2.5 pr-3 text-right"><DeltaText value={p.yoy_delta_pct} locale={locale} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(view.packageMovers.topGainers.length > 0 || view.packageMovers.topDecliners.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <MoversBlock title={tb.pkgIncreasing} tone="ok" rows={view.packageMovers.topGainers} locale={locale} emptyLabel={tb.noMovers} />
            <MoversBlock title={tb.pkgDecreasing} tone="warn" rows={view.packageMovers.topDecliners} locale={locale} emptyLabel={tb.noMovers} />
          </div>
        )}
      </SectionCard>

      {/* 6. Operational narrative + 7. Management attention */}
      {view.operatorNotes && (
        <>
          <SectionCard
            title={tb.opNarrative}
            subtitle={tb.opNarrativeSub(formatLocaleDateTime(view.operatorNotes.completed_at, locale), view.operatorNotes.completed_by ?? "—")}
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {(["capacity_production", "supply_chain", "quality_incidents"] as SectionKey[]).map((k) => (
                <div key={k}>
                  <h3 className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">{sectionLabels[k]}</h3>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                    {view.operatorNotes![k] || <span className="italic text-gray-400">—</span>}
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title={tb.mgmtAttention}
            subtitle={tb.mgmtAttentionSub}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="border-l-4 border-navy pl-4">
                <h3 className="text-[11px] uppercase tracking-wider text-navy font-bold mb-2">
                  {sectionLabels.initiatives}
                </h3>
                <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {view.operatorNotes.initiatives || <span className="italic text-gray-400">—</span>}
                </p>
              </div>
              <div className="border-l-4 border-amber-500 pl-4">
                <h3 className="text-[11px] uppercase tracking-wider text-amber-700 font-bold mb-2">
                  {sectionLabels.risks}
                </h3>
                <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {view.operatorNotes.risks || <span className="italic text-gray-400">—</span>}
                </p>
              </div>
            </div>
          </SectionCard>
        </>
      )}

      {/* 8. Operational alerts */}
      <SectionCard title={tb.opAlerts} subtitle={tb.opAlertsSub}>
        <div className="grid auto-rows-fr grid-cols-1 gap-3 text-sm mb-4 sm:grid-cols-2 lg:grid-cols-5">
          <SmallStat label={tb.packageAlerts} value={fmtNum(view.alertSummary.package_alerts_total, 0, locale)} />
          <SmallStat label={tb.customerAlerts} value={fmtNum(view.alertSummary.customer_alerts_total, 0, locale)} />
          <SmallStat label={tb.dataQualityAlerts} value={fmtNum(view.alertSummary.data_quality_alerts_total, 0, locale)} />
          <SmallStat label={tb.resolved} value={fmtNum(view.alertSummary.resolved_alerts_total, 0, locale)} tone="ok" />
          <SmallStat label={tb.pending} value={fmtNum(view.alertSummary.pending_alerts_total, 0, locale)}
            tone={view.alertSummary.pending_alerts_total === 0 ? "ok" : "warn"} />
        </div>

        {view.lockHistory.length > 0 && (
          <div className="mt-4">
            <h3 className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">{tb.lockHistory}</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-200">
                  <th className="text-left pb-1 pr-2 font-medium">{tb.thEvent}</th>
                  <th className="text-left pb-1 pr-2 font-medium">{tb.thAt}</th>
                  <th className="text-left pb-1 pr-2 font-medium">{tb.thBy}</th>
                  <th className="text-left pb-1 pr-2 font-medium">{tb.thVersion}</th>
                </tr>
              </thead>
              <tbody>
                {view.lockHistory.slice(0, 5).map((e) => (
                  <tr key={e.event_id} className="border-b border-gray-100 last:border-b-0">
                    <td className="py-1 pr-2">
                      <span className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm ${
                        e.event_type === "locked" ? "bg-emerald-50 text-emerald-900" : "bg-purple-50 text-purple-900"
                      }`}>{statusText(e.event_type)}</span>
                    </td>
                    <td className="py-1 pr-2 tabular-nums text-gray-700 whitespace-nowrap">{formatLocaleDateTime(e.event_at, locale)}</td>
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
            <h3 className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">{tb.dataProvenance}</h3>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-xs">
              <ProvItem label={tb.provActiveFile} value={view.activeFile.filename} />
              <ProvItem label={tb.provVersion} value={`v${view.activeFile.version_no}`} />
              <ProvItem label={tb.provHashPrefix} value={view.activeFile.file_hash_prefix} mono />
              <ProvItem label={tb.provDiscrepancy} value={view.activeFile.has_total_discrepancy ? tb.flagged : tb.none}
                tone={view.activeFile.has_total_discrepancy ? "warn" : "ok"} />
              <ProvItem label={tb.provUploadedBy} value={view.activeFile.uploaded_by ?? "—"} />
              <ProvItem label={tb.provUploadedAt} value={formatLocaleDateTime(view.activeFile.uploaded_at, locale)} />
              <ProvItem label={tb.provLockedBy} value={view.period.locked_by ?? "—"} />
              <ProvItem label={tb.provLockedAt} value={formatLocaleDateTime(view.period.locked_at, locale)} />
            </dl>
          </div>
        )}

        <DataIntegrityDisclosure finance={view.finance} hasDiscrepancy={view.activeFile?.has_total_discrepancy ?? false} tb={tb} />
      </SectionCard>

      {/* Send / distribution history */}
      <SectionCard
        title={tb.sendHistory}
        subtitle={<>Deck distribution is audited in <code>u1d_ops.board_deck_sends</code>.</>}
      >
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(280px,0.75fr)_minmax(0,1.25fr)]">
          <div className="rounded-sm border border-gray-200 bg-gray-50 p-4">
            <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500 font-semibold">
              {tb.activeDistList}
            </div>
            {activeList ? (
              <div className="mt-3 space-y-3">
                <div>
                  <div className="font-heading text-xl font-bold text-navy leading-tight">
                    {activeList.name}
                  </div>
                  <div className="mt-1 text-xs text-gray-600">
                    {tb.toCcBcc(activeList.active_to_count, activeList.active_cc_count, activeList.active_bcc_count)}
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
                {tb.noDistList}
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <h3 className="text-[11px] uppercase tracking-[0.16em] text-gray-500 font-semibold">
                {tb.recentSends}
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

function FinancialEmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-sm text-gray-600">
      {children}
    </div>
  );
}

function FinancialMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-1 font-heading text-lg font-bold text-navy tabular-nums">{value}</div>
    </div>
  );
}

const DECISION_TONE: Record<DecisionTone, string> = {
  neutral: "border-navy/40 bg-navy/[0.04] text-navy",
  attention: "border-amber-400 bg-amber-50 text-amber-900",
  urgent: "border-red-400 bg-red-50 text-red-900",
};

function DecisionCard({ card }: { card: DecisionCardData | null }) {
  if (!card) return null;
  return (
    <div className={`mt-5 rounded-sm border border-l-4 px-4 py-3 ${DECISION_TONE[card.tone]}`}>
      <div className="text-[10px] uppercase tracking-[0.16em] font-bold opacity-80">{card.title}</div>
      <p className="mt-1 text-sm leading-relaxed">{card.body}</p>
    </div>
  );
}

function DataIntegrityDisclosure({
  finance, hasDiscrepancy, tb,
}: {
  finance: BoardFinanceOverlay | null;
  hasDiscrepancy: boolean;
  tb: ReturnType<typeof getDict>["board"];
}) {
  const lines: string[] = [tb.di1];
  if (finance) {
    const a = finance.sync_assessment;
    const freshness = a.worst_status === "ok"
      ? tb.diFinCurrent
      : a.worst_status === "stale"
        ? tb.diFinStale(a.jobs_stale, a.total_jobs)
        : tb.diFinError(a.jobs_error);
    lines.push(tb.di2, tb.di3, tb.diFreshness(freshness), tb.di4);
  } else {
    lines.push(tb.diNoFin1, tb.diNoFin2);
  }
  if (hasDiscrepancy) {
    lines.push(tb.diDiscrepancy);
  }
  return (
    <div className="mt-5 pt-4 border-t border-gray-200">
      <h3 className="text-[11px] uppercase tracking-wider text-gray-500 mb-2 font-semibold">{tb.dataIntegrity}</h3>
      <ul className="space-y-1.5 text-xs text-gray-700 leading-relaxed list-disc list-inside">
        {lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    </div>
  );
}

function NarrativeSeverityBadge({ severity, tb }: { severity: NarrativeSeverity; tb: ReturnType<typeof getDict>["board"] }) {
  const map: Record<NarrativeSeverity, { label: string; className: string }> = {
    positive: { label: tb.badgeOk, className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
    neutral: { label: tb.badgeNote, className: "border-gray-200 bg-gray-50 text-gray-600" },
    watch: { label: tb.badgeWatch, className: "border-amber-200 bg-amber-50 text-amber-800" },
    risk: { label: tb.badgeRisk, className: "border-red-200 bg-red-50 text-red-800" },
  };
  const badge = map[severity];
  return (
    <span className={`mt-0.5 inline-flex min-w-[3.25rem] justify-center rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${badge.className}`}>
      {badge.label}
    </span>
  );
}

function MoversBlock({
  title, tone, rows, locale, emptyLabel,
}: {
  title: string;
  tone: "ok" | "warn";
  rows: { key: string; display_name: string; delta_gallons: number; delta_pct: number | null }[];
  locale: Locale;
  emptyLabel: string;
}) {
  const color = tone === "ok" ? "text-emerald-700" : "text-red-700";
  if (rows.length === 0) {
    return (
      <div>
        <h3 className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">{title}</h3>
        <div className="text-sm italic text-gray-400">{emptyLabel}</div>
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
                {formatSigned(r.delta_gallons, locale)}
              </td>
              <td className={`py-1.5 text-right tabular-nums ${color}`}>
                {r.delta_pct !== null ? fmtPct(r.delta_pct, 1, true, locale) : "—"}
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
