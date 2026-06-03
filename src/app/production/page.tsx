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

export const dynamic = "force-dynamic";

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${fmtNum(Math.abs(n))}`;
}

function barColor(utilPct: number): string {
  if (utilPct >= 90) return "bg-[#E1261C]";
  if (utilPct >= 70) return "bg-amber-500";
  if (utilPct >= 40) return "bg-emerald-500";
  return "bg-navy/40";
}

function utilLabel(utilPct: number): string {
  if (utilPct >= 90) return "AT LIMIT";
  if (utilPct >= 70) return "HOT";
  if (utilPct >= 40) return "OK";
  if (utilPct > 0)  return "ROOM";
  return "IDLE";
}

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const marginRange = normalizeRange((await searchParams).range ?? "3m");
  const marginMonths = rangeMonths(marginRange);
  const latest = await getLatestProductionMonth();

  if (!latest) {
    return (
      <main>
        <Nav current="/production" />
        <div className="container mx-auto px-8 py-16 max-w-3xl">
          <h1 className="font-heading text-3xl font-bold text-navy mb-4">Production</h1>
          <p className="text-gray-600">No production data loaded yet.</p>
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

  return (
    <main>
      <HeroHeader
        eyebrow="U1DYNAMICS MANUFACTURING LLC"
        title="Production"
        subtitle={<>Latest month: {formatPeriod(latest.period_year, latest.period_month)} · {fmtNum(totalProduced)} gallons · {maxDaysRun} working days</>}
      />
      <Nav current="/production" />

      <div className="container mx-auto px-8 py-8 max-w-7xl">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KPITile label="Month Production" value={fmtNum(totalProduced)}
            subtitle="gallons produced" accent="navy" />
          <KPITile label="Daily Average"
            value={fmtNum(totalProduced / Math.max(maxDaysRun, 1))}
            subtitle={`across ${maxDaysRun} working days`} accent="navy" />
          <KPITile label="Overall Utilization"
            value={fmtPct(overallUtilization, 1, false)}
            subtitle="actual ÷ (target/day × days)"
            accent={overallUtilization >= 0.7 ? "red" : overallUtilization >= 0.4 ? "success" : "navy"} />
          <KPITile label="Monthly Headroom"
            value={fmtNum(Math.max(0, totalMonthlyTarget - totalProduced))}
            subtitle="gallons of slack vs 80% target" accent="success" />
        </div>

        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <h2 className="font-heading text-xl font-bold text-navy mb-1">
            Capacity vs Actual Production — by Line
          </h2>
          <div className="text-xs text-gray-500 mb-4">
            {formatPeriod(latest.period_year, latest.period_month)} ·
            Monthly target = (target gal/day × days that line ran). Bar shows actual ÷ target.
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                <th className="text-left pb-2 font-medium">Line</th>
                <th className="text-right pb-2 font-medium">Days Run</th>
                <th className="text-right pb-2 font-medium">Max gal/day</th>
                <th className="text-right pb-2 font-medium">Target gal/day</th>
                <th className="text-right pb-2 font-medium">Monthly Target</th>
                <th className="text-right pb-2 font-medium">Produced</th>
                <th className="text-right pb-2 font-medium" colSpan={2}>Utilization</th>
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
                    <td className="py-3 text-right text-gray-500">{fmtNum(r.max_gallons_per_day)}</td>
                    <td className="py-3 text-right text-gray-500">{fmtNum(r.target_gallons_per_day)}</td>
                    <td className="py-3 text-right">{idle ? "—" : fmtNum(monthlyTarget)}</td>
                    <td className="py-3 text-right font-medium">{idle ? "—" : fmtNum(r.gallons)}</td>
                    <td className="py-3 pl-4 pr-2 w-40">
                      {idle ? (
                        <div className="text-[11px] text-gray-400 italic">not scheduled</div>
                      ) : (
                        <div className="w-full bg-gray-100 h-2 rounded-sm overflow-hidden">
                          <div className={`h-full ${barColor(utilPct)}`} style={{ width: `${barWidth}%` }} />
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-right pl-2 w-24">
                      {idle ? (
                        <span className="text-[11px] text-gray-400">IDLE</span>
                      ) : (
                        <>
                          <span className="font-semibold tabular-nums">
                            {fmtPct(r.utilization_vs_target, 1, false)}
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
                <td className="py-3 text-navy">TOTAL</td>
                <td className="py-3 text-right text-navy">{maxDaysRun}</td>
                <td className="py-3 text-right text-navy">{fmtNum(totalMaxPerDay)}</td>
                <td className="py-3 text-right text-navy">{fmtNum(totalTargetPerDay)}</td>
                <td className="py-3 text-right text-navy">{fmtNum(totalMonthlyTarget)}</td>
                <td className="py-3 text-right text-navy">{fmtNum(totalProduced)}</td>
                <td className="py-3 pl-4 pr-2">
                  <div className="w-full bg-gray-100 h-2 rounded-sm overflow-hidden">
                    <div className={`h-full ${barColor(overallUtilization * 100)}`}
                      style={{ width: `${Math.min(100, overallUtilization * 100)}%` }} />
                  </div>
                </td>
                <td className="py-3 text-right pl-2 text-navy">
                  {fmtPct(overallUtilization, 1, false)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="bg-white border border-gray-200 rounded-sm p-6 mt-8">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
            <h2 className="font-heading text-xl font-bold text-navy">
              Contribution Margin by Filling Line
            </h2>
            <RangeSelector current={marginRange} basePath="/production" />
          </div>
          <div className="text-xs text-gray-500 mb-4">
            {marginRange === "month" ? "Latest invoice month" : `Trailing ${rangeLabel(marginRange)}`}
            {margin.windowEnd ? ` ending ${margin.windowEnd.slice(0, 7)}` : ""} ·
            Revenue − product COGS from QuickBooks (u1dynamics), attributed to each
            line. Excludes filling labor &amp; line overhead (Version B).
          </div>

          {!margin.configured ? (
            <div className="text-sm text-gray-500 italic py-6">
              Finance warehouse not connected (<code>U1D_FINANCE_DATABASE_URL</code> unset).
              Margin by line will populate once the finance read replica is wired.
            </div>
          ) : !margin.hasData ? (
            <div className="text-sm text-gray-500 italic py-6">
              No U1Dynamics invoice data in this window yet. As QuickBooks sync
              populates the u1dynamics entity, contribution margin per line will appear here.
            </div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                    <th className="text-left pb-2 font-medium">Line</th>
                    <th className="text-right pb-2 font-medium">Revenue</th>
                    <th className="text-right pb-2 font-medium">Product COGS</th>
                    <th className="text-right pb-2 font-medium">Contribution</th>
                    <th className="text-right pb-2 font-medium">Margin %</th>
                    <th className="text-right pb-2 font-medium">Gallons</th>
                    <th className="text-right pb-2 font-medium">$/gal</th>
                    <th className="text-right pb-2 font-medium">Contrib/gal</th>
                  </tr>
                </thead>
                <tbody>
                  {margin.lines.map((r) => (
                    <tr key={r.parent_line} className="border-b border-gray-100 last:border-b-0">
                      <td className="py-3 font-medium text-navy">{r.label}</td>
                      <td className="py-3 text-right tabular-nums">{money(r.revenue)}</td>
                      <td className="py-3 text-right tabular-nums text-gray-500">{money(r.cogs)}</td>
                      <td className={`py-3 text-right tabular-nums font-medium ${r.contribution < 0 ? "text-[#E1261C]" : "text-navy"}`}>
                        {money(r.contribution)}
                      </td>
                      <td className={`py-3 text-right tabular-nums ${r.marginPct !== null && r.marginPct < 0 ? "text-[#E1261C]" : ""}`}>
                        {r.marginPct === null ? "—" : fmtPct(r.marginPct, 1, false)}
                      </td>
                      <td className="py-3 text-right tabular-nums text-gray-500">{r.gallons > 0 ? fmtNum(r.gallons) : "—"}</td>
                      <td className="py-3 text-right tabular-nums">{r.revPerGal === null ? "—" : money(r.revPerGal)}</td>
                      <td className={`py-3 text-right tabular-nums ${r.contribPerGal !== null && r.contribPerGal < 0 ? "text-[#E1261C]" : ""}`}>
                        {r.contribPerGal === null ? "—" : money(r.contribPerGal)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-navy font-bold">
                    <td className="py-3 text-navy">TOTAL (mapped)</td>
                    <td className="py-3 text-right text-navy tabular-nums">{money(margin.lines.reduce((s, r) => s + r.revenue, 0))}</td>
                    <td className="py-3 text-right text-navy tabular-nums">{money(margin.totalCogs)}</td>
                    <td className={`py-3 text-right tabular-nums ${margin.totalContribution < 0 ? "text-[#E1261C]" : "text-navy"}`}>{money(margin.totalContribution)}</td>
                    <td className="py-3 text-right text-navy tabular-nums">
                      {(() => {
                        const rev = margin.lines.reduce((s, r) => s + r.revenue, 0);
                        return rev > 0 ? fmtPct(margin.totalContribution / rev, 1, false) : "—";
                      })()}
                    </td>
                    <td className="py-3 text-right text-navy tabular-nums">{margin.totalGallons > 0 ? fmtNum(margin.totalGallons) : "—"}</td>
                    <td className="py-3" colSpan={2}></td>
                  </tr>
                </tbody>
              </table>

              <div className="mt-4 text-xs text-gray-500">
                Mapped {fmtPct(margin.mappedPctOfRevenue, 0, false)} of window revenue to a line.
                {margin.unmappedRevenue > 0 && (
                  <> Unmapped: {money(margin.unmappedRevenue)}
                    {margin.unmappedTop.length > 0 && (
                      <> — top: {margin.unmappedTop.slice(0, 4).map((u) => u.product_name).join(", ")}.
                        Extend <code>LINE_RULES</code> in <code>line-margin.ts</code> to capture these.</>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </section>

        <footer className="mt-12 text-xs text-gray-500 italic">
          Capacity sourced from <code>u1d_ops.production_lines</code> ·
          Actuals rolled up from <code>u1d_ops.production_daily</code> ·
          Margin from <code>u1p_finance.invoice_lines</code> (read-only, u1dynamics).
        </footer>
      </div>
    </main>
  );
}
