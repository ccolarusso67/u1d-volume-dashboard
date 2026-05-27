import { Nav } from "@/components/nav";
import { HeroHeader } from "@/components/layout/hero-header";
import { KPITile } from "@/components/kpi-tile";
import {
  getLatestProductionMonth,
  getAllLinesForMonth,
} from "@/lib/queries/production";
import { formatPeriod, fmtNum, fmtPct } from "@/lib/brand";

export const dynamic = "force-dynamic";

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

export default async function ProductionPage() {
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

        <footer className="mt-12 text-xs text-gray-500 italic">
          Capacity sourced from <code>u1d_ops.production_lines</code> ·
          Actuals rolled up from <code>u1d_ops.production_daily</code>.
        </footer>
      </div>
    </main>
  );
}
