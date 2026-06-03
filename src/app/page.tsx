import { KPITile } from "@/components/kpi-tile";
import { Nav } from "@/components/nav";
import { HeroHeader } from "@/components/layout/hero-header";
import {
  getLatestMonth, getMonth, getRecentMonths,
  getCustomerYoYForMonth, getPackageMixForMonth,
  getPackageYoYForMonth, getYTDComparison,
  getMonthlyCategoryTrend, getWindowAggregates,
} from "@/lib/queries/monthly";
import { formatPeriod, fmtNum, fmtPct } from "@/lib/brand";
import { getReconciliation } from "@/lib/queries/production";
import { getDailyTargetGallons } from "@/lib/settings/app-settings";
import { VolumeGoalChart } from "@/components/charts/VolumeGoalChart";
import { MixDonut } from "@/components/charts/MixDonut";
import { RangeSelector, rangeMonths, rangeLabel, normalizeRange } from "@/components/range-selector";
import { StackedTrendChart, StackedTrendRow, CATEGORY_COLORS } from "@/components/charts/StackedTrendChart";
import { CATEGORY_DISPLAY_ORDER, categorizeFamily } from "@/lib/queries/category";
import { YoYDriversChart } from "@/components/charts/YoYDriversChart";
import { PackageMixChart } from "@/components/charts/PackageMixChart";
import { getLocale } from "@/lib/i18n/server";
import { getDict } from "@/lib/i18n/dictionaries";

export const dynamic = "force-dynamic";

// Categories rendered by the stacked-bar chart. Sourced from the canonical
// CATEGORY_DISPLAY_ORDER so any change to the family -> category mapping flows
// through one place. "Other" is intentionally omitted from the chart stack.
const CATEGORIES = CATEGORY_DISPLAY_ORDER.filter((c) => c !== "Other");

export default async function DashboardPage(props: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const locale = await getLocale();
  const d = getDict(locale);
  const t = d.overview;
  const MON = locale === "es"
    ? ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"]
    : ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const catLabel = (name: string) => d.common.categories[name] ?? name;
  const ytdLabel = (month: number): string => {
    if (month <= 3) return t.ytdQ1;
    if (month <= 6) return t.ytdH1;
    if (month <= 9) return t.ytdQ3;
    return t.ytdFY;
  };

  const range = normalizeRange((await props.searchParams).range);
  const months = rangeMonths(range);
  const latest = await getLatestMonth();
  if (!latest) {
    return (
      <main>
        <Nav current="/" />
        <div className="container mx-auto px-8 py-16 max-w-3xl">
          <h1 className="font-heading text-3xl font-bold text-navy mb-4">
            {t.noDataTitle}
          </h1>
          <p className="text-gray-600">{d.common.noData}</p>
        </div>
      </main>
    );
  }

  const yearAgo = { year: latest.period_year - 1, month: latest.period_month };

  const [yearAgoData, customers, packages, drivers, ytd, trend6m, categoryTrend] =
    await Promise.all([
      getMonth(yearAgo.year, yearAgo.month),
      getCustomerYoYForMonth(latest.period_year, latest.period_month),
      getPackageMixForMonth(latest.period_year, latest.period_month),
      getPackageYoYForMonth(latest.period_year, latest.period_month),
      getYTDComparison(latest.period_year, latest.period_month),
      getRecentMonths(6),
      getMonthlyCategoryTrend(6),
    ]);

  const [reconRows, dailyTarget] = await Promise.all([
    getReconciliation(),
    getDailyTargetGallons(),
  ]);
  const volGoalSeries = reconRows
    .filter((r) => r.billed_gallons != null)
    .sort((a, b) => a.period_year - b.period_year || a.period_month - b.period_month)
    .slice(-12)
    .map((r) => ({
      month: MON[r.period_month - 1],
      billed: Math.round(r.billed_gallons ?? 0),
      goal: r.working_days != null ? r.working_days * dailyTarget : null,
    }));

  // Trailing-window totals for the selected range (from already-loaded data).
  const billedDesc = reconRows
    .filter((r) => r.billed_gallons != null)
    .sort((a, b) => (b.period_year * 12 + b.period_month) - (a.period_year * 12 + a.period_month));
  const win = billedDesc.slice(0, months);
  const windowVol = win.reduce((s, r) => s + (r.billed_gallons ?? 0), 0);
  const windowWd = win.reduce((s, r) => s + (r.working_days ?? 0), 0);
  const windowGoal = windowWd * dailyTarget;
  const windowDelta = windowVol - windowGoal;
  const windowMet = windowVol >= windowGoal;
  const windowSuffix = months === 1 ? "" : ` · ${rangeLabel(range)}`;
  const windowAgg = await getWindowAggregates(months);

  const yoyPct = yearAgoData
    ? (latest.total_gallons - yearAgoData.total_gallons) / yearAgoData.total_gallons
    : null;

  const positiveDrivers = drivers.filter(d => d.delta_gallons > 0).slice(0, 6);
  const negativeDrivers = drivers
    .filter(d => d.delta_gallons < 0)
    .sort((a, b) => a.delta_gallons - b.delta_gallons)
    .slice(0, 3);

  // Pivot category trend into recharts-friendly shape
  const trendMonthKeys = Array.from(
    new Set(categoryTrend.map(r => `${r.period_year}-${r.period_month}`))
  ).sort();
  const stackedData: StackedTrendRow[] = trendMonthKeys.map(key => {
    const [y, m] = key.split("-").map(Number);
    const monthRows = categoryTrend.filter(r => r.period_year === y && r.period_month === m);
    const row: StackedTrendRow = { month: formatPeriod(y, m, locale) };
    for (const cat of CATEGORIES) {
      row[cat] = monthRows.find(r => r.category === cat)?.gallons ?? 0;
    }
    return row;
  });

  // Product-mix donut + customer concentration over the selected window.
  const catAgg = new Map<string, number>();
  for (const p of windowAgg.byPackage) {
    const cat = categorizeFamily(p.family);
    catAgg.set(cat, (catAgg.get(cat) ?? 0) + p.gallons);
  }
  const donutData = Array.from(catAgg.entries())
    .map(([name, value]) => ({ name, value }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);
  const donutTotal = windowAgg.total_gallons || 1;
  const donutColors = donutData.map(
    (d, i) => CATEGORY_COLORS[d.name] ?? ["#15385D", "#ED8B00", "#1C6FB8", "#8A95A3", "#C7CFD9"][i % 5]
  );
  const topConcentration = windowAgg.byCustomer.slice(0, 5);
  const concMax = topConcentration.length ? topConcentration[0].gallons : 1;

  // Point-in-time comparison — current month vs 3M / 6M / 1Y ago (billed).
  const billedByOrd = new Map<number, number>();
  for (const r of reconRows) {
    if (r.billed_gallons != null) billedByOrd.set(r.period_year * 12 + r.period_month, r.billed_gallons);
  }
  const curOrd = latest.period_year * 12 + latest.period_month;
  const curVol = billedByOrd.get(curOrd) ?? latest.total_gallons;
  const comparePoints = [
    { label: d.common.vs3Months, ref: billedByOrd.get(curOrd - 3) ?? null },
    { label: d.common.vs6Months, ref: billedByOrd.get(curOrd - 6) ?? null },
    { label: d.common.vsYearAgo, ref: billedByOrd.get(curOrd - 12) ?? null },
  ];

  // Windowed comparison KPIs: current window vs prior equal window, and vs the
  // same window one year back. For range=Month these equal MoM / YoY.
  const sumOrds = (fromOrd: number, toOrd: number) => {
    let s = 0;
    for (let o = fromOrd; o <= toOrd; o++) s += billedByOrd.get(o) ?? 0;
    return s;
  };
  const winCur = sumOrds(curOrd - months + 1, curOrd);
  const winPrior = sumOrds(curOrd - 2 * months + 1, curOrd - months);
  const winYoY = sumOrds(curOrd - months + 1 - 12, curOrd - 12);
  const periodChange = winPrior > 0 ? (winCur - winPrior) / winPrior : null;
  const yoyChangeWin = winYoY > 0 ? (winCur - winYoY) / winYoY : null;
  const interGal = windowAgg.byCustomer
    .filter((c) => c.is_intercompany)
    .reduce((s, c) => s + c.gallons, 0);
  const ultraShareWin = windowAgg.total_gallons > 0 ? interGal / windowAgg.total_gallons : 0;
  const changeLabel = months === 1 ? t.changeMoM : t.changeWindow(rangeLabel(range));
  const scopeLabel = months === 1 ? formatPeriod(latest.period_year, latest.period_month, locale) : rangeLabel(range);

  // Driver chart wants biggest at top => largest delta first
  const driverData = positiveDrivers.map(d => ({
    package: d.display_name,
    delta: d.delta_gallons,
  }));
  // Package mix chart — top 7
  const mixData = packages.slice(0, 7).map(p => ({
    package: p.display_name,
    gallons: p.gallons,
  }));

  return (
    <main>
      <HeroHeader
        eyebrow={d.common.company}
        title={t.title}
        subtitle={t.subtitle(formatPeriod(latest.period_year, latest.period_month, locale), fmtNum(latest.total_gallons, 0, locale))}
      />
      <Nav current="/" />

      <div className="container mx-auto px-8 py-8 max-w-7xl">
        {/* Time range selector */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="text-[10px] uppercase tracking-[0.14em] text-gray-400 font-semibold">{t.timeRange}</div>
          <RangeSelector current={range} basePath="/" />
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 mb-8">
          <KPITile
            label={months === 1 ? t.kpiMonthVolume : t.kpiVolume(windowSuffix)}
            value={fmtNum(windowVol, 0, locale)}
            subtitle={months === 1 ? t.kpiVolumeSubMonth : t.kpiVolumeSubWindow(win.length)}
            accent="navy"
          />
          {windowWd > 0 && (
            <KPITile
              label={t.kpiVolumeGoal(windowSuffix)}
              value={fmtNum(windowGoal, 0, locale)}
              subtitle={t.goalSub(`${windowDelta >= 0 ? "+" : "−"}${fmtNum(Math.abs(windowDelta), 0, locale)}`, windowMet, windowWd, fmtNum(dailyTarget, 0, locale))}
              accent={windowMet ? "success" : "red"}
            />
          )}
          <KPITile
            label={changeLabel}
            value={periodChange !== null ? fmtPct(periodChange, 1, true, locale) : "—"}
            subtitle={months === 1 ? t.changeSubMonth(fmtNum(winPrior, 0, locale)) : t.changeSubWindow(rangeLabel(range), fmtNum(winPrior, 0, locale))}
            accent={periodChange === null ? "neutral" : periodChange >= 0 ? "success" : "red"}
          />
          <KPITile
            label={t.yoyChange}
            value={yoyChangeWin !== null ? fmtPct(yoyChangeWin, 1, true, locale) : "—"}
            subtitle={winYoY > 0 ? t.yoySub(fmtNum(winYoY, 0, locale)) : t.yoyNoData}
            accent={yoyChangeWin === null ? "neutral" : yoyChangeWin >= 0 ? "success" : "red"}
          />
          <KPITile
            label={t.ultrachemShare(windowSuffix)}
            value={fmtPct(ultraShareWin, 1, false, locale)}
            subtitle={t.ultrachemSub}
            accent="navy"
          />
          <KPITile label={ytdLabel(latest.period_month)} value={fmtNum(ytd.current_ytd, 0, locale)}
            subtitle={ytd.delta_pct !== null
              ? t.ytdSub(fmtPct(ytd.delta_pct, 1, true, locale), fmtNum(ytd.prior_ytd, 0, locale)) : t.ytdNoData}
            accent={ytd.delta_pct !== null && ytd.delta_pct >= 0 ? "success" : "red"} />
        </div>

        {/* Volume vs goal — signature chart */}
        {volGoalSeries.length > 0 && (
          <section className="bg-white border border-line rounded-xl p-6 mb-6">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
              <div>
                <h2 className="font-heading text-xl font-bold text-navy">{t.volVsGoal}</h2>
                <div className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-semibold mt-1">
                  {t.last12}
                </div>
              </div>
              <div className="flex gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-navy" />{t.billedVolume}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "#ED8B00" }} />
                  {t.monthlyGoalLegend(fmtNum(dailyTarget, 0, locale))}
                </span>
              </div>
            </div>
            <VolumeGoalChart data={volGoalSeries} />
          </section>
        )}

        {/* Product mix + customer concentration */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <section className="bg-white border border-line rounded-xl p-6">
            <h2 className="font-heading text-xl font-bold text-navy">{t.productMix}</h2>
            <div className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-semibold mt-1 mb-3">
              {t.shareOfGallons(scopeLabel)}
            </div>
            {donutData.length > 0 ? (
              <>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-2">
                  {donutData.map((item, i) => (
                    <span key={item.name} className="flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: donutColors[i] }} />
                      {catLabel(item.name)} {fmtPct(item.value / donutTotal, 1, false, locale)}
                    </span>
                  ))}
                </div>
                <MixDonut data={donutData} colors={donutColors} />
              </>
            ) : (
              <div className="text-sm italic text-gray-400 py-8 text-center">{t.noCategoryData}</div>
            )}
          </section>

          <section className="bg-white border border-line rounded-xl p-6">
            <h2 className="font-heading text-xl font-bold text-navy">{t.custConcentration}</h2>
            <div className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-semibold mt-1 mb-4">
              {t.topAccounts(scopeLabel)}
            </div>
            {topConcentration.map((c) => {
              const share = donutTotal > 0 ? c.gallons / donutTotal : 0;
              const w = concMax > 0 ? (c.gallons / concMax) * 100 : 0;
              return (
                <div key={c.customer_key} className="flex items-center gap-3 my-2.5 text-sm">
                  <div className="w-40 truncate text-navy">
                    {c.display_name}
                    {c.is_intercompany && <span className="text-[#1C6FB8] text-[11px]"> · {t.intercompany}</span>}
                  </div>
                  <div className="flex-1 h-2.5 bg-gray-100 rounded overflow-hidden">
                    <div className="h-full rounded" style={{ width: `${w}%`, background: c.is_intercompany ? "#1C6FB8" : "#15385D" }} />
                  </div>
                  <div className="w-12 text-right font-bold text-navy tabular-nums">{fmtPct(share, 1, false, locale)}</div>
                </div>
              );
            })}
          </section>
        </div>

        {/* Point-in-time comparison */}
        <section className="bg-white border border-line rounded-xl p-6 mb-6">
          <h2 className="font-heading text-xl font-bold text-navy">{d.common.comparisonTitle}</h2>
          <div className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-semibold mt-1 mb-4">
            {t.comparisonSubtitle(formatPeriod(latest.period_year, latest.period_month, locale))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPITile label={d.common.thisMonthKpi} value={fmtNum(curVol, 0, locale)} subtitle={d.common.billedGallons} accent="navy" />
            {comparePoints.map((p) => {
              const change = p.ref && p.ref > 0 ? (curVol - p.ref) / p.ref : null;
              return (
                <KPITile
                  key={p.label}
                  label={p.label}
                  value={change !== null ? `${change >= 0 ? "+" : ""}${fmtPct(change, 1, true, locale)}` : "—"}
                  subtitle={p.ref != null ? `${fmtNum(p.ref, 0, locale)} → ${fmtNum(curVol, 0, locale)}` : d.common.noPeriodData}
                  accent={change === null ? "neutral" : change >= 0 ? "success" : "red"}
                />
              );
            })}
          </div>
        </section>

        {/* 6-Month Stacked Trend Chart */}
        <section className="bg-white border border-line rounded-xl p-6 mb-6">
          <h2 className="font-heading text-xl font-bold text-navy mb-1">
            {t.trendTitle}
          </h2>
          <div className="text-xs text-gray-500 mb-4">
            {t.trendNote}
          </div>
          <StackedTrendChart data={stackedData} categories={CATEGORIES} />
          <div className="text-xs text-gray-500 mt-3 pt-3 border-t border-gray-100">
            {t.monthlyTotals}
            {trend6m.slice().reverse().map((m, i) =>
              <span key={i}>
                {i > 0 && " · "}
                <span className="font-semibold text-navy">
                  {formatPeriod(m.period_year, m.period_month, locale)}
                </span>{" "}
                {fmtNum(m.total_gallons, 0, locale)}
              </span>
            )}
          </div>
        </section>

        {/* Customer Detail with YoY */}
        <section className="bg-white border border-line rounded-xl p-6 mb-6">
          <h2 className="font-heading text-xl font-bold text-navy mb-1">
            {t.custDetailTitle(formatPeriod(latest.period_year, latest.period_month, locale), formatPeriod(yearAgo.year, yearAgo.month, locale))}
          </h2>
          <table className="w-full text-sm mt-4">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-line">
                <th className="text-left pb-2 font-medium">{t.thCustomer}</th>
                <th className="text-right pb-2 font-medium">{formatPeriod(yearAgo.year, yearAgo.month, locale)}</th>
                <th className="text-right pb-2 font-medium">{formatPeriod(latest.period_year, latest.period_month, locale)}</th>
                <th className="text-right pb-2 font-medium">{d.common.deltaGal}</th>
                <th className="text-right pb-2 font-medium">{d.common.deltaPct}</th>
                <th className="text-right pb-2 font-medium">{t.pctOfMonth}</th>
              </tr>
            </thead>
            <tbody>
              {customers.map(c => {
                const pctOfMonth = latest.total_gallons > 0 ? c.current_gallons / latest.total_gallons : 0;
                return (
                  <tr key={c.customer_key} className="border-b border-gray-100 last:border-b-0">
                    <td className="py-2 text-navy">
                      {c.display_name}
                      {c.is_intercompany && <span className="ml-2 text-[10px] uppercase tracking-wider text-gray-500">{t.intercompanyShort}</span>}
                    </td>
                    <td className="py-2 text-right text-gray-500">{fmtNum(c.prior_gallons, 0, locale)}</td>
                    <td className="py-2 text-right font-medium">{fmtNum(c.current_gallons, 0, locale)}</td>
                    <td className="py-2 text-right tabular-nums">{c.delta_gallons >= 0 ? "+" : ""}{fmtNum(c.delta_gallons, 0, locale)}</td>
                    <td className="py-2 text-right tabular-nums">{c.delta_pct !== null ? (c.delta_pct >= 0 ? "+" : "") + fmtPct(c.delta_pct, 1, false, locale) : "—"}</td>
                    <td className="py-2 text-right text-gray-500">{fmtPct(pctOfMonth, 1, false, locale)}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-navy font-bold">
                <td className="py-2 text-navy">{d.common.total}</td>
                <td className="py-2 text-right text-navy">{fmtNum(yearAgoData?.total_gallons ?? 0, 0, locale)}</td>
                <td className="py-2 text-right text-navy">{fmtNum(latest.total_gallons, 0, locale)}</td>
                <td className="py-2 text-right text-navy">+{fmtNum(latest.total_gallons - (yearAgoData?.total_gallons ?? 0), 0, locale)}</td>
                <td className="py-2 text-right text-navy">{fmtPct(yoyPct, 1, true, locale)}</td>
                <td className="py-2 text-right text-navy">{fmtPct(1, 1, false, locale)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Package Mix chart + table side by side */}
        <section className="bg-white border border-line rounded-xl p-6 mb-6">
          <h2 className="font-heading text-xl font-bold text-navy mb-1">
            {t.pkgMixTitle(formatPeriod(latest.period_year, latest.period_month, locale))}
          </h2>
          <div className="text-xs text-gray-500 mb-4">{t.pkgMixNote}</div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <PackageMixChart data={mixData} />
            </div>
            <div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-line">
                    <th className="text-left pb-2 font-medium">{t.thRank}</th>
                    <th className="text-left pb-2 font-medium">{t.thCategory}</th>
                    <th className="text-right pb-2 font-medium">{t.thPctMonth}</th>
                  </tr>
                </thead>
                <tbody>
                  {packages.slice(0, 7).map((p, i) => (
                    <tr key={p.package_key} className="border-b border-gray-100 last:border-b-0">
                      <td className="py-1.5 text-gray-400">{i + 1}</td>
                      <td className="py-1.5 text-navy">{p.display_name}</td>
                      <td className="py-1.5 text-right text-gray-600">{fmtPct(p.pct_of_month, 1, false, locale)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-navy font-semibold">
                    <td></td>
                    <td className="py-1.5 text-navy">{t.subtotalTop7}</td>
                    <td className="py-1.5 text-right text-navy">
                      {fmtPct(packages.slice(0, 7).reduce((a, p) => a + p.pct_of_month, 0), 1, false, locale)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* YoY Drivers chart + drags context */}
        <section className="bg-white border border-line rounded-xl p-6 mb-6">
          <h2 className="font-heading text-xl font-bold text-navy mb-1">
            {t.yoyDriversTitle}
          </h2>
          <div className="text-xs text-gray-500 mb-4">
            {t.yoyDriversNote(formatPeriod(latest.period_year, latest.period_month, locale), formatPeriod(yearAgo.year, yearAgo.month, locale))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <YoYDriversChart data={driverData} />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
                {t.context}
              </div>
              <p className="text-sm text-gray-700 mb-4">
                {t.contextBody(fmtNum(positiveDrivers.slice(0, 3).reduce((a, dr) => a + dr.delta_gallons, 0), 0, locale))}
              </p>
              {negativeDrivers.length > 0 && (
                <>
                  <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-2 mt-4">
                    {t.drags}
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {negativeDrivers.map(dr => (
                        <tr key={dr.package_key}>
                          <td className="py-1 text-navy">{dr.display_name}</td>
                          <td className="py-1 text-right tabular-nums">{fmtNum(dr.delta_gallons, 0, locale)}</td>
                          <td className="py-1 text-right text-gray-500 w-16 tabular-nums">{fmtPct(dr.delta_pct, 0, false, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>
        </section>

        <footer className="mt-12 text-xs text-gray-500 italic">
          {t.footer}
        </footer>
      </div>
    </main>
  );
}
