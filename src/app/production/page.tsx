import { Nav } from "@/components/nav";
import { KPITile } from "@/components/kpi-tile";
import {
  getLatestProductionMonth,
  getProductionByLineForMonth,
  getProductionLines,
} from "@/lib/queries/production";
import { formatPeriod, fmtNum, fmtPct } from "@/lib/brand";

export const dynamic = "force-dynamic";

function utilizationBadge(util: number | null): { text: string; cls: string } {
  if (util === null || util === undefined) return { text: "—", cls: "text-gray-400" };
  const pct = util * 100;
  let cls = "text-gray-500";
  if (pct >= 90) cls = "text-[#E1261C] font-semibold";
  else if (pct >= 70) cls = "text-amber-600 font-semibold";
  else if (pct >= 40) cls = "text-emerald-600";
  return { text: fmtPct(util, 1, false), cls };
}

export default async function ProductionPage() {
  const latest = await getLatestProductionMonth();

  if (!latest) {
    return (
      <main>
        <Nav current="/production" />
        <div className="container mx-auto px-8 py-16 max-w-3xl">
          <h1 className="font-heading text-3xl font-bold text-navy mb-4">
            Production
          </h1>
          <p className="text-gray-600">
            No production data loaded yet. Run <code className="bg-gray-100 px-1 rounded">npm run db:seed:production</code>.
          </p>
        </div>
      </main>
    );
  }

  const [byLine, lines] = await Promise.all([
    getProductionByLineForMonth(latest.period_year, latest.period_month),
    getProductionLines(),
  ]);

  // Aggregate capacity: total target gallons/day across all lines
  const totalTargetPerDay = lines.reduce(
    (acc, l) => acc + l.target_gallons_per_day,
    0
  );
  const totalMaxPerDay = lines.reduce(
    (acc, l) => acc + l.max_gallons_per_day,
    0
  );
  const monthCapacityAtTarget = totalTargetPerDay * latest.working_days;
  const utilizationOfMonth = monthCapacityAtTarget > 0
    ? latest.total_gallons / monthCapacityAtTarget
    : null;

  // Theoretical monthly headroom
  const headroomGal = monthCapacityAtTarget - latest.total_gallons;

  return (
    <main>
      <header className="bg-navy text-white">
        <div className="container mx-auto px-8 py-6 max-w-7xl">
          <div className="text-[11px] tracking-[0.2em] opacity-80 mb-1">
            U1DYNAMICS MANUFACTURING LLC
          </div>
          <h1 className="font-heading text-3xl font-bold">Production</h1>
          <div className="text-sm opacity-80 mt-2 italic">
            Latest month: {formatPeriod(latest.period_year, latest.period_month)} ·{" "}
            {fmtNum(latest.total_gallons)} gallons across{" "}
            {latest.working_days} working days
          </div>
        </div>
      </header>
      <Nav current="/production" />

      <div className="container mx-auto px-8 py-8 max-w-7xl">
        {/* KPI strip */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KPITile
            label="Month Production"
            value={fmtNum(latest.total_gallons)}
            subtitle="gallons produced"
            accent="navy"
          />
          <KPITile
            label="Daily Average"
            value={fmtNum(latest.total_gallons / Math.max(latest.working_days, 1))}
            subtitle={`across ${latest.working_days} working days`}
            accent="navy"
          />
          <KPITile
            label="Utilization vs Target"
            value={fmtPct(utilizationOfMonth, 1, false)}
            subtitle={`vs ${fmtNum(monthCapacityAtTarget)} gal at 80% target`}
            accent={
              utilizationOfMonth !== null && utilizationOfMonth >= 0.7
                ? "red"
                : utilizationOfMonth !== null && utilizationOfMonth >= 0.4
                  ? "success"
                  : "navy"
            }
          />
          <KPITile
            label="Headroom"
            value={fmtNum(headroomGal)}
            subtitle="gallons of monthly slack at 80% target"
            accent="success"
          />
        </div>

        {/* Per-line breakdown */}
        <section className="bg-white border border-gray-200 rounded-sm p-6 mb-6">
          <h2 className="font-heading text-xl font-bold text-navy mb-1">
            By Line — {formatPeriod(latest.period_year, latest.period_month)}
          </h2>
          <div className="text-xs text-gray-500 mb-4">
            Utilization compares actual gallons to (target gallons/day × working days). The
            target is the 80% planning capacity, not the theoretical max.
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                <th className="text-left pb-2 font-medium">Line</th>
                <th className="text-left pb-2 font-medium">Parent</th>
                <th className="text-right pb-2 font-medium">Gallons</th>
                <th className="text-right pb-2 font-medium">Pallets</th>
                <th className="text-right pb-2 font-medium">Avg/day</th>
                <th className="text-right pb-2 font-medium">Peak/day</th>
                <th className="text-right pb-2 font-medium">Target/day</th>
                <th className="text-right pb-2 font-medium">Utilization</th>
              </tr>
            </thead>
            <tbody>
              {byLine.map((row) => {
                const line = lines.find((l) => l.line_key === row.line_key);
                const target = line?.target_gallons_per_day ?? 0;
                const badge = utilizationBadge(row.utilization_vs_target);
                return (
                  <tr
                    key={row.line_key}
                    className="border-b border-gray-100 last:border-b-0"
                  >
                    <td className="py-2 text-navy font-medium">{row.display_name}</td>
                    <td className="py-2 text-gray-500">{row.parent_line}</td>
                    <td className="py-2 text-right">{fmtNum(row.gallons)}</td>
                    <td className="py-2 text-right text-gray-500">
                      {fmtNum(row.pallets, 1)}
                    </td>
                    <td className="py-2 text-right">
                      {fmtNum(row.avg_daily_gallons)}
                    </td>
                    <td className="py-2 text-right text-gray-500">
                      {fmtNum(row.peak_daily_gallons)}
                    </td>
                    <td className="py-2 text-right text-gray-500">
                      {fmtNum(target)}
                    </td>
                    <td className={`py-2 text-right ${badge.cls}`}>
                      {badge.text}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-navy font-bold">
                <td className="py-2 text-navy" colSpan={2}>
                  TOTAL
                </td>
                <td className="py-2 text-right text-navy">
                  {fmtNum(latest.total_gallons)}
                </td>
                <td className="py-2 text-right text-navy"></td>
                <td className="py-2 text-right text-navy">
                  {fmtNum(latest.total_gallons / Math.max(latest.working_days, 1))}
                </td>
                <td className="py-2 text-right text-navy"></td>
                <td className="py-2 text-right text-navy">{fmtNum(totalTargetPerDay)}</td>
                <td className="py-2 text-right text-navy">
                  {fmtPct(utilizationOfMonth, 1, false)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Capacity reference */}
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <h2 className="font-heading text-xl font-bold text-navy mb-1">
            Installed Capacity (Reference)
          </h2>
          <div className="text-xs text-gray-500 mb-4">
            Per-line single-shift capacity. The 80% target is the planning operating
            point that accounts for changeovers and short-stops.
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                <th className="text-left pb-2 font-medium">Line</th>
                <th className="text-left pb-2 font-medium">Parent</th>
                <th className="text-right pb-2 font-medium">Max gal/day</th>
                <th className="text-right pb-2 font-medium">Target gal/day (80%)</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr
                  key={l.line_key}
                  className="border-b border-gray-100 last:border-b-0"
                >
                  <td className="py-2 text-navy font-medium">{l.display_name}</td>
                  <td className="py-2 text-gray-500">{l.parent_line}</td>
                  <td className="py-2 text-right">
                    {fmtNum(l.max_gallons_per_day)}
                  </td>
                  <td className="py-2 text-right text-gray-500">
                    {fmtNum(l.target_gallons_per_day)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-navy font-bold">
                <td className="py-2 text-navy" colSpan={2}>
                  TOTAL
                </td>
                <td className="py-2 text-right text-navy">
                  {fmtNum(totalMaxPerDay)}
                </td>
                <td className="py-2 text-right text-navy">
                  {fmtNum(totalTargetPerDay)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
