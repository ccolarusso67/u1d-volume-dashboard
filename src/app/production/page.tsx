import { Nav } from "@/components/nav";
import { HeroHeader } from "@/components/layout/hero-header";
import { KPITile } from "@/components/kpi-tile";
import {
  getLatestProductionMonth,
  getAllLinesForMonth,
} from "@/lib/queries/production";
import { getLineMargin } from "@/lib/finance/line-margin";
import { RangeSelector, rangeMonths, rangeLabel, normalizeRange } from "@/components/range-selector";
import { formatPeriod, fmtNum, fmtPct } from "@/lib/brand";
import { getLocale } from "@/lib/i18n/server";
import { getDict } from "@/lib/i18n/dictionaries";

export const dynamic = "force-dynamic";

function money(n: number, locale: "en" | "es"): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${fmtNum(Math.abs(n), 0, locale)}`;
}

function barColor(utilPct: number): string {
  if (utilPct >= 90) return "bg-[#E1261C]";
  if (utilPct >= 70) return "bg-amber-500";
  if (utilPct >= 40) return "bg-emerald-500";
  return "bg-navy/40";
}

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const locale = await getLocale();
  const d = getDict(locale);
  const t = d.production;

  function utilLabel(utilPct: number): string {
    if (utilPct >= 90) return t.statusAtLimit;
    if (utilPct >= 70) return t.statusHot;
    if (utilPct >= 40) return t.statusOk;
    if (utilPct > 0)  return t.statusRoom;
    return t.statusIdle;
  }

  const marginRange = normalizeRange((await searchParams).range ?? "3m");
  const marginMonths = rangeMonths(marginRange);
  const latest = await getLatestProductionMonth();

  if (!latest) {
    return (
      <main>
        <Nav current="/production" />
        <div className="container mx-auto px-8 py-16 max-w-3xl">
          <h1 className="font-heading text-3xl font-bold text-navy mb-4">{t.title}</h1>
          <p className="text-gray-600">{t.noData}</p>
        </div>
      </main>
    );
  }

  const rows = await getAllLinesForMonth(latest.period_year, latest.period_month);
  const margin = await getLineMargin(marginMonths);

  const totalMaxPerDay    = rows.reduce((a, r) => a + r.max_gallons_per_day, 0);
  const totalTargetPerDay = rows.reduce((a, r) => a + r.target_gallons_per_day, 0);
  const totalProduced     = rows.reduce((a, r) => a + r.gallons, 0);
  const maxDaysRun        = Math.max(0, ...rows.map(r => r.working_days));
  const totalMonthlyTarget = totalTargetPerDay * maxDaysRun;
  const overallUtilization = totalMonthlyTarget > 0 ? totalProduced / totalMonthlyTarget : 0;
  const periodLabel = formatPeriod(latest.period_year, latest.period_month, locale);

  return (
    <main>
      <HeroHeader
        eyebrow={d.common.company}
        title={t.title}
        subtitle={t.subtitle(periodLabel, fmtNum(totalProduced, 0, locale), maxDaysRun)}
      />
      <Nav current="/production" />

      <div className="container mx-auto px-8 py-8 max-w-7xl">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KPITile label={t.kpiMonthProduction} value={fmtNum(totalProduced, 0, locale)}
            subtitle={t.kpiMonthProductionSub} accent="navy" />
          <KPITile label={t.kpiDailyAverage}
            value={fmtNum(totalProduced / Math.max(maxDaysRun, 1), 0, locale)}
            subtitle={t.kpiDailyAverageSub(maxDaysRun)} accent="navy" />
          <KPITile label={t.kpiUtilization}
            value={fmtPct(overallUtilization, 1, false, locale)}
            subtitle={t.kpiUtilizationSub}
            accent={overallUtilization >= 0.7 ? "red" : overallUtilization >= 0.4 ? "success" : "navy"} />
          <KPITile label={t.kpiHeadroom}
            value={fmtNum(Math.max(0, totalMonthlyTarget - totalProduced), 0, locale)}
            subtitle={t.kpiHeadroomSub} accent="success" />
        </div>

        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <h2 className="font-heading text-xl font-bold text-navy mb-1">
            {t.capacityTitle}
          </h2>
          <div className="text-xs text-gray-500 mb-4">
            {t.capacityNote(periodLabel)}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                <th className="text-left pb-2 font-medium">{d.common.line}</th>
                <th className="text-right pb-2 font-medium">{t.thDaysRun}</th>
                <th className="text-right pb-2 font-medium">{t.thMaxPerDay}</th>
                <th className="text-right pb-2 font-medium">{t.thTargetPerDay}</th>
                <th className="text-right pb-2 font-medium">{t.thMonthlyTarget}</th>
                <th className="text-right pb-2 font-medium">{t.thProduced}</th>
                <th className="text-right pb-2 font-medium" colSpan={2}>{t.thUtilization}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const monthlyTarget = r.target_gallons_per_day * r.working_days;
                const utilPct = r.utilization_vs_target !== null ? r.utilization_vs_target * 100 : 0;
                const barWidth = Math.min(100, utilPct);
                const idle = r.working_days === 0;
                return (
                  <tr key={r.line_key} className="border-b border-gray-100 last:border-b-0">
                    <td className="py-3">
                      <div className="font-medium text-navy">{r.display_name}</div>
                      <div className="text-[11px] text-gray-500">{r.parent_line}</div>
                    </td>
                    <td className="py-3 text-right">{r.working_days}</td>
                    <td className="py-3 text-right text-gray-500">{fmtNum(r.max_gallons_per_day, 0, locale)}</td>
                    <td className="py-3 text-right text-gray-500">{fmtNum(r.target_gallons_per_day, 0, locale)}</td>
                    <td className="py-3 text-right">{idle ? "—" : fmtNum(monthlyTarget, 0, locale)}</td>
                    <td className="py-3 text-right font-medium">{idle ? "—" : fmtNum(r.gallons, 0, locale)}</td>
                    <td className="py-3 pl-4 pr-2 w-40">
                      {idle ? (
                        <div className="text-[11px] text-gray-400 italic">{t.notScheduled}</div>
                      ) : (
                        <div className="w-full bg-gray-100 h-2 rounded-sm overflow-hidden">
                          <div className={`h-full ${barColor(utilPct)}`} style={{ width: `${barWidth}%` }} />
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-right pl-2 w-24">
                      {idle ? (
                        <span className="text-[11px] text-gray-400">{t.statusIdle}</span>
                      ) : (
                        <>
                          <span className="font-semibold tabular-nums">
                            {fmtPct(r.utilization_vs_target, 1, false, locale)}
                          </span>
                          <div className="text-[10px] uppercase tracking-wider text-gray-500">
                            {utilLabel(utilPct)}
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-navy font-bold">
                <td className="py-3 text-navy">{d.common.total}</td>
                <td className="py-3 text-right text-navy">{maxDaysRun}</td>
                <td className="py-3 text-right text-navy">{fmtNum(totalMaxPerDay, 0, locale)}</td>
                <td className="py-3 text-right text-navy">{fmtNum(totalTargetPerDay, 0, locale)}</td>
                <td className="py-3 text-right text-navy">{fmtNum(totalMonthlyTarget, 0, locale)}</td>
                <td className="py-3 text-right text-navy">{fmtNum(totalProduced, 0, locale)}</td>
                <td className="py-3 pl-4 pr-2">
                  <div className="w-full bg-gray-100 h-2 rounded-sm overflow-hidden">
                    <div className={`h-full ${barColor(overallUtilization * 100)}`}
                      style={{ width: `${Math.min(100, overallUtilization * 100)}%` }} />
                  </div>
                </td>
                <td className="py-3 text-right pl-2 text-navy">
                  {fmtPct(overallUtilization, 1, false, locale)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="bg-white border border-gray-200 rounded-sm p-6 mt-8">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
            <h2 className="font-heading text-xl font-bold text-navy">
              {t.marginTitle}
            </h2>
            <RangeSelector current={marginRange} basePath="/production" />
          </div>
          <div className="text-xs text-gray-500 mb-4">
            {marginRange === "month" ? t.marginWindowLatest : t.marginWindowTrailing(rangeLabel(marginRange))}
            {margin.windowEnd ? ` ${t.marginEndingPrefix} ${margin.windowEnd.slice(0, 7)}` : ""} ·{" "}
            {t.marginNoteBody}
            {margin.intercompanyEliminated > 0
              ? t.marginIntercompany(money(margin.intercompanyEliminated, locale))
              : ""}
          </div>

          {!margin.configured ? (
            <div className="text-sm text-gray-500 italic py-6">
              {t.marginNotConfigured}
            </div>
          ) : !margin.hasData ? (
            <div className="text-sm text-gray-500 italic py-6">
              {t.marginNoData}
            </div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                    <th className="text-left pb-2 font-medium">{d.common.line}</th>
                    <th className="text-right pb-2 font-medium">{d.common.revenue}</th>
                    <th className="text-right pb-2 font-medium">{t.thProductCogs}</th>
                    <th className="text-right pb-2 font-medium">{t.thContribution}</th>
                    <th className="text-right pb-2 font-medium">{t.thMarginPct}</th>
                    <th className="text-right pb-2 font-medium">{t.thGallons}</th>
                    <th className="text-right pb-2 font-medium">{t.thRevPerGal}</th>
                    <th className="text-right pb-2 font-medium">{t.thContribPerGal}</th>
                  </tr>
                </thead>
                <tbody>
                  {margin.lines.map((r) => (
                    <tr key={r.parent_line} className="border-b border-gray-100 last:border-b-0">
                      <td className="py-3 font-medium text-navy">{r.label}</td>
                      <td className="py-3 text-right tabular-nums">{money(r.revenue, locale)}</td>
                      <td className="py-3 text-right tabular-nums text-gray-500">{money(r.cogs, locale)}</td>
                      <td className={`py-3 text-right tabular-nums font-medium ${r.contribution < 0 ? "text-[#E1261C]" : "text-navy"}`}>
                        {money(r.contribution, locale)}
                      </td>
                      <td className={`py-3 text-right tabular-nums ${r.marginPct !== null && r.marginPct < 0 ? "text-[#E1261C]" : ""}`}>
                        {r.marginPct === null ? "—" : fmtPct(r.marginPct, 1, false, locale)}
                      </td>
                      <td className="py-3 text-right tabular-nums text-gray-500">{r.gallons > 0 ? fmtNum(r.gallons, 0, locale) : "—"}</td>
                      <td className="py-3 text-right tabular-nums">{r.revPerGal === null ? "—" : money(r.revPerGal, locale)}</td>
                      <td className={`py-3 text-right tabular-nums ${r.contribPerGal !== null && r.contribPerGal < 0 ? "text-[#E1261C]" : ""}`}>
                        {r.contribPerGal === null ? "—" : money(r.contribPerGal, locale)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-navy font-bold">
                    <td className="py-3 text-navy">{t.totalMapped}</td>
                    <td className="py-3 text-right text-navy tabular-nums">{money(margin.lines.reduce((s, r) => s + r.revenue, 0), locale)}</td>
                    <td className="py-3 text-right text-navy tabular-nums">{money(margin.totalCogs, locale)}</td>
                    <td className={`py-3 text-right tabular-nums ${margin.totalContribution < 0 ? "text-[#E1261C]" : "text-navy"}`}>{money(margin.totalContribution, locale)}</td>
                    <td className="py-3 text-right text-navy tabular-nums">
                      {(() => {
                        const rev = margin.lines.reduce((s, r) => s + r.revenue, 0);
                        return rev > 0 ? fmtPct(margin.totalContribution / rev, 1, false, locale) : "—";
                      })()}
                    </td>
                    <td className="py-3 text-right text-navy tabular-nums">{margin.totalGallons > 0 ? fmtNum(margin.totalGallons, 0, locale) : "—"}</td>
                    <td className="py-3" colSpan={2}></td>
                  </tr>
                </tbody>
              </table>

              <div className="mt-4 text-xs text-gray-500">
                {t.mappedCoverage(fmtPct(margin.mappedPctOfRevenue, 0, false, locale))}
                {margin.unmappedRevenue > 0 && (
                  <>{t.unmappedLabel(money(margin.unmappedRevenue, locale))}
                    {margin.unmappedTop.length > 0 &&
                      t.unmappedTop(margin.unmappedTop.slice(0, 4).map((u) => u.product_name).join(", "))}
                  </>
                )}
              </div>
            </>
          )}
        </section>

        <footer className="mt-12 text-xs text-gray-500 italic">
          {t.footer}
        </footer>
      </div>
    </main>
  );
}
