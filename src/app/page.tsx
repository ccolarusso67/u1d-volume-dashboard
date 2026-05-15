import { KPITile } from "@/components/kpi-tile";
import { Nav } from "@/components/nav";
import {
  getLatestMonth,
  getMonth,
  getRecentMonths,
  getCustomerYoYForMonth,
  getPackageMixForMonth,
  getPackageYoYForMonth,
  getYTDComparison,
} from "@/lib/queries/monthly";
import { formatPeriod, fmtNum, fmtPct } from "@/lib/brand";

export const dynamic = "force-dynamic";

function ytdLabel(month: number): string {
  if (month <= 3) return `YTD Q1`;
  if (month <= 6) return `YTD H1`;
  if (month <= 9) return `YTD Q3`;
  return `YTD FY`;
}

export default async function DashboardPage() {
  const latest = await getLatestMonth();
  if (!latest) {
    return (
      <main>
        <Nav current="/" />
        <div className="container mx-auto px-8 py-16 max-w-3xl">
          <h1 className="font-heading text-3xl font-bold text-navy mb-4">
            U1Dynamics — Volume Dashboard
          </h1>
          <p className="text-gray-600">No data loaded yet.</p>
        </div>
      </main>
    );
  }

  const prevMonth = latest.period_month === 1
    ? { year: latest.period_year - 1, month: 12 }
    : { year: latest.period_year, month: latest.period_month - 1 };
  const yearAgo = { year: latest.period_year - 1, month: latest.period_month };

  const [prevMonthData, yearAgoData, customers, packages, drivers, ytd, trend6m] =
    await Promise.all([
      getMonth(prevMonth.year, prevMonth.month),
      getMonth(yearAgo.year, yearAgo.month),
      getCustomerYoYForMonth(latest.period_year, latest.period_month),
      getPackageMixForMonth(latest.period_year, latest.period_month),
      getPackageYoYForMonth(latest.period_year, latest.period_month),
      getYTDComparison(latest.period_year, latest.period_month),
      getRecentMonths(6),
    ]);

  const momPct = prevMonthData
    ? (latest.total_gallons - prevMonthData.total_gallons) / prevMonthData.total_gallons
    : null;
  const yoyPct = yearAgoData
    ? (latest.total_gallons - yearAgoData.total_gallons) / yearAgoData.total_gallons
    : null;
  const ultrachemShare = latest.total_gallons > 0
    ? latest.ultrachem_gallons / latest.total_gallons : 0;

  // Top 5 positive + top 3 negative YoY drivers (by delta gallons)
  const positiveDrivers = drivers
    .filter(d => d.delta_gallons > 0)
    .slice(0, 5);
  const negativeDrivers = drivers
    .filter(d => d.delta_gallons < 0)
    .sort((a, b) => a.delta_gallons - b.delta_gallons)
    .slice(0, 3);

  return (
    <main>
      <header className="bg-navy text-white">
        <div className="container mx-auto px-8 py-6 max-w-7xl">
          <div className="text-[11px] tracking-[0.2em] opacity-80 mb-1">
            U1DYNAMICS MANUFACTURING LLC
          </div>
          <h1 className="font-heading text-3xl font-bold">Volume Dashboard</h1>
          <div className="text-sm opacity-80 mt-2 italic">
            Latest period: {formatPeriod(latest.period_year, latest.period_month)} ·{" "}
            {fmtNum(latest.total_gallons)} gallons
          </div>
        </div>
      </header>
      <Nav current="/" />

      <div className="container mx-auto px-8 py-8 max-w-7xl">
        {/* 5 KPI tiles */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <KPITile
            label="Month Volume"
            value={fmtNum(latest.total_gallons)}
            subtitle="gallons billed"
            accent="navy"
          />
          <KPITile
            label="MoM Change"
            value={fmtPct(momPct)}
            subtitle={prevMonthData
              ? `vs ${fmtNum(prevMonthData.total_gallons)} gal`
              : "no prior month"}
            accent={momPct !== null && momPct >= 0 ? "success" : "red"}
          />
          <KPITile
            label="YoY Change"
            value={fmtPct(yoyPct)}
            subtitle={yearAgoData
              ? `vs ${fmtNum(yearAgoData.total_gallons)} gal`
              : "no prior year"}
            accent={yoyPct !== null && yoyPct >= 0 ? "success" : "red"}
          />
          <KPITile
            label="ULTRACHEM Share"
            value={fmtPct(ultrachemShare, 1, false)}
            subtitle="intercompany customer"
            accent="navy"
          />
          <KPITile
            label={ytdLabel(latest.period_month)}
            value={fmtNum(ytd.current_ytd)}
            subtitle={ytd.delta_pct !== null
              ? `${fmtPct(ytd.delta_pct)} vs ${fmtNum(ytd.prior_ytd)} prior`
              : "no prior year data"}
            accent={ytd.delta_pct !== null && ytd.delta_pct >= 0 ? "success" : "red"}
          />
        </div>

        {/* Customer Detail with YoY */}
        <section className="bg-white border border-gray-200 rounded-sm p-6 mb-6">
          <h2 className="font-heading text-xl font-bold text-navy mb-1">
            Customer Detail — {formatPeriod(latest.period_year, latest.period_month)} vs {formatPeriod(yearAgo.year, yearAgo.month)}
          </h2>
          <table className="w-full text-sm mt-4">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                <th className="text-left pb-2 font-medium">Customer</th>
                <th className="text-right pb-2 font-medium">{formatPeriod(yearAgo.year, yearAgo.month)}</th>
                <th className="text-right pb-2 font-medium">{formatPeriod(latest.period_year, latest.period_month)}</th>
                <th className="text-right pb-2 font-medium">Δ gal</th>
                <th className="text-right pb-2 font-medium">Δ %</th>
                <th className="text-right pb-2 font-medium">% of Month</th>
              </tr>
            </thead>
            <tbody>
              {customers.map(c => {
                const pctOfMonth = latest.total_gallons > 0
                  ? c.current_gallons / latest.total_gallons : 0;
                const deltaCls = c.delta_gallons >= 0
                  ? "text-emerald-700" : "text-[#E1261C]";
                return (
                  <tr key={c.customer_key} className="border-b border-gray-100 last:border-b-0">
                    <td className="py-2 text-navy">
                      {c.display_name}
                      {c.is_intercompany && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-gray-500">
                          intercomp.
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right text-gray-500">{fmtNum(c.prior_gallons)}</td>
                    <td className="py-2 text-right font-medium">{fmtNum(c.current_gallons)}</td>
                    <td className={`py-2 text-right ${deltaCls}`}>
                      {c.delta_gallons >= 0 ? "+" : ""}{fmtNum(c.delta_gallons)}
                    </td>
                    <td className={`py-2 text-right ${deltaCls}`}>{fmtPct(c.delta_pct)}</td>
                    <td className="py-2 text-right text-gray-500">{fmtPct(pctOfMonth, 1, false)}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-navy font-bold">
                <td className="py-2 text-navy">TOTAL</td>
                <td className="py-2 text-right text-navy">{fmtNum(yearAgoData?.total_gallons ?? 0)}</td>
                <td className="py-2 text-right text-navy">{fmtNum(latest.total_gallons)}</td>
                <td className="py-2 text-right text-navy">
                  +{fmtNum(latest.total_gallons - (yearAgoData?.total_gallons ?? 0))}
                </td>
                <td className="py-2 text-right text-navy">{fmtPct(yoyPct)}</td>
                <td className="py-2 text-right text-navy">100.0%</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Package Mix + YoY Drivers side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <section className="bg-white border border-gray-200 rounded-sm p-6">
            <h2 className="font-heading text-xl font-bold text-navy mb-1">Package Mix</h2>
            <div className="text-xs text-gray-500 mb-4">
              {formatPeriod(latest.period_year, latest.period_month)} · top categories
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                  <th className="text-left pb-2 font-medium">#</th>
                  <th className="text-left pb-2 font-medium">Category</th>
                  <th className="text-right pb-2 font-medium">Gallons</th>
                  <th className="text-right pb-2 font-medium">% of Month</th>
                </tr>
              </thead>
              <tbody>
                {packages.slice(0, 10).map((p, i) => (
                  <tr key={p.package_key} className="border-b border-gray-100 last:border-b-0">
                    <td className="py-2 text-gray-400">{i + 1}</td>
                    <td className="py-2 text-navy">{p.display_name}</td>
                    <td className="py-2 text-right">{fmtNum(p.gallons)}</td>
                    <td className="py-2 text-right text-gray-500">
                      {fmtPct(p.pct_of_month, 1, false)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="bg-white border border-gray-200 rounded-sm p-6">
            <h2 className="font-heading text-xl font-bold text-navy mb-1">YoY Drivers</h2>
            <div className="text-xs text-gray-500 mb-4">
              {formatPeriod(latest.period_year, latest.period_month)} vs {formatPeriod(yearAgo.year, yearAgo.month)} · by package
            </div>

            <div className="text-[11px] uppercase tracking-wider text-emerald-700 font-semibold mb-2">
              Top Positive Drivers
            </div>
            <table className="w-full text-sm mb-5">
              <tbody>
                {positiveDrivers.map(d => (
                  <tr key={d.package_key} className="border-b border-gray-100 last:border-b-0">
                    <td className="py-2 text-navy">{d.display_name}</td>
                    <td className="py-2 text-right font-medium text-emerald-700">
                      +{fmtNum(d.delta_gallons)}
                    </td>
                    <td className="py-2 text-right text-emerald-700 w-20">
                      {fmtPct(d.delta_pct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {negativeDrivers.length > 0 && (
              <>
                <div className="text-[11px] uppercase tracking-wider text-[#E1261C] font-semibold mb-2">
                  Watchlist (Negative)
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {negativeDrivers.map(d => (
                      <tr key={d.package_key} className="border-b border-gray-100 last:border-b-0">
                        <td className="py-2 text-navy">{d.display_name}</td>
                        <td className="py-2 text-right font-medium text-[#E1261C]">
                          {fmtNum(d.delta_gallons)}
                        </td>
                        <td className="py-2 text-right text-[#E1261C] w-20">
                          {fmtPct(d.delta_pct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>
        </div>

        {/* 6-month trend */}
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <h2 className="font-heading text-xl font-bold text-navy mb-1">6-Month Trend</h2>
          <div className="text-xs text-gray-500 mb-4">last 6 loaded months</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                <th className="text-left pb-2 font-medium">Period</th>
                <th className="text-right pb-2 font-medium">Total</th>
                <th className="text-right pb-2 font-medium">ULTRACHEM</th>
                <th className="text-right pb-2 font-medium">External</th>
              </tr>
            </thead>
            <tbody>
              {trend6m.slice().reverse().map(m => (
                <tr key={`${m.period_year}-${m.period_month}`}
                    className="border-b border-gray-100 last:border-b-0">
                  <td className="py-2 text-navy">{formatPeriod(m.period_year, m.period_month)}</td>
                  <td className="py-2 text-right font-medium">{fmtNum(m.total_gallons)}</td>
                  <td className="py-2 text-right text-gray-500">{fmtNum(m.ultrachem_gallons)}</td>
                  <td className="py-2 text-right text-gray-500">{fmtNum(m.external_gallons)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <footer className="mt-12 text-xs text-gray-500 italic">
          Server-rendered on each request · Postgres schema <code>u1d_ops</code>
        </footer>
      </div>
    </main>
  );
}
