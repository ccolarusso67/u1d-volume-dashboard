import { KPITile } from "@/components/kpi-tile";
import { Nav } from "@/components/nav";
import {
  getLatestMonth,
  getMonth,
  getRecentMonths,
  getMonthByCustomer,
} from "@/lib/queries/monthly";
import { formatPeriod, fmtNum, fmtPct } from "@/lib/brand";

// Server-rendered on each request: the dashboard always reflects the latest ingest
export const dynamic = "force-dynamic";

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
          <p className="text-gray-600 leading-relaxed">
            No data loaded yet. Apply the migrations and run the seed:
          </p>
          <pre className="mt-4 bg-gray-900 text-gray-100 p-4 rounded text-sm overflow-x-auto">
            npm run db:setup
          </pre>
        </div>
      </main>
    );
  }

  // Compute MoM and YoY against relative periods
  const prevMonth =
    latest.period_month === 1
      ? { year: latest.period_year - 1, month: 12 }
      : { year: latest.period_year, month: latest.period_month - 1 };
  const yearAgo = {
    year: latest.period_year - 1,
    month: latest.period_month,
  };

  const [prevMonthData, yearAgoData, customers, trend6m] = await Promise.all([
    getMonth(prevMonth.year, prevMonth.month),
    getMonth(yearAgo.year, yearAgo.month),
    getMonthByCustomer(latest.period_year, latest.period_month),
    getRecentMonths(6),
  ]);

  const momPct = prevMonthData
    ? (latest.total_gallons - prevMonthData.total_gallons) /
      prevMonthData.total_gallons
    : null;
  const yoyPct = yearAgoData
    ? (latest.total_gallons - yearAgoData.total_gallons) /
      yearAgoData.total_gallons
    : null;

  const ultrachemShare =
    latest.total_gallons > 0
      ? latest.ultrachem_gallons / latest.total_gallons
      : 0;

  return (
    <main>
      {/* Navy header band */}
      <header className="bg-navy text-white">
        <div className="container mx-auto px-8 py-6 max-w-7xl">
          <div className="text-[11px] tracking-[0.2em] opacity-80 mb-1">
            U1DYNAMICS MANUFACTURING LLC
          </div>
          <h1 className="font-heading text-3xl font-bold">Volume Dashboard</h1>
          <div className="text-sm opacity-80 mt-2 italic">
            Latest period:{" "}
            {formatPeriod(latest.period_year, latest.period_month)} ·{" "}
            {fmtNum(latest.total_gallons)} gallons
          </div>
        </div>
      </header>
      <Nav current="/" />

      <div className="container mx-auto px-8 py-8 max-w-7xl">
        {/* 4-tile KPI strip */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KPITile
            label="Month Volume"
            value={fmtNum(latest.total_gallons)}
            subtitle="gallons billed"
            accent="navy"
          />
          <KPITile
            label="MoM Change"
            value={fmtPct(momPct)}
            subtitle={
              prevMonthData
                ? `vs ${fmtNum(prevMonthData.total_gallons)} gal (${formatPeriod(prevMonth.year, prevMonth.month)})`
                : "no prior month"
            }
            accent={momPct !== null && momPct >= 0 ? "success" : "red"}
          />
          <KPITile
            label="YoY Change"
            value={fmtPct(yoyPct)}
            subtitle={
              yearAgoData
                ? `vs ${fmtNum(yearAgoData.total_gallons)} gal (${formatPeriod(yearAgo.year, yearAgo.month)})`
                : "no prior year"
            }
            accent={yoyPct !== null && yoyPct >= 0 ? "success" : "red"}
          />
          <KPITile
            label="ULTRACHEM Share"
            value={fmtPct(ultrachemShare, 1, false)}
            subtitle="intercompany customer"
            accent="navy"
          />
        </div>

        {/* Two side-by-side detail tables */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-white border border-gray-200 rounded-sm p-6">
            <h2 className="font-heading text-xl font-bold text-navy mb-1">
              Customer Detail
            </h2>
            <div className="text-xs text-gray-500 mb-4">
              {formatPeriod(latest.period_year, latest.period_month)}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                  <th className="text-left pb-2 font-medium">Customer</th>
                  <th className="text-right pb-2 font-medium">Gallons</th>
                  <th className="text-right pb-2 font-medium">% of Month</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr
                    key={c.customer_key}
                    className="border-b border-gray-100 last:border-b-0"
                  >
                    <td className="py-2 text-navy">{c.display_name}</td>
                    <td className="py-2 text-right">{fmtNum(c.gallons)}</td>
                    <td className="py-2 text-right text-gray-500">
                      {fmtPct(c.gallons / latest.total_gallons, 1, false)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-navy font-bold">
                  <td className="py-2 text-navy">TOTAL</td>
                  <td className="py-2 text-right text-navy">
                    {fmtNum(latest.total_gallons)}
                  </td>
                  <td className="py-2 text-right text-navy">100.0%</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="bg-white border border-gray-200 rounded-sm p-6">
            <h2 className="font-heading text-xl font-bold text-navy mb-1">
              6-Month Trend
            </h2>
            <div className="text-xs text-gray-500 mb-4">
              last 6 loaded months
            </div>
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
                {trend6m
                  .slice()
                  .reverse()
                  .map((m) => (
                    <tr
                      key={`${m.period_year}-${m.period_month}`}
                      className="border-b border-gray-100 last:border-b-0"
                    >
                      <td className="py-2 text-navy">
                        {formatPeriod(m.period_year, m.period_month)}
                      </td>
                      <td className="py-2 text-right font-medium">
                        {fmtNum(m.total_gallons)}
                      </td>
                      <td className="py-2 text-right text-gray-500">
                        {fmtNum(m.ultrachem_gallons)}
                      </td>
                      <td className="py-2 text-right text-gray-500">
                        {fmtNum(m.external_gallons)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        </div>

        <footer className="mt-12 text-xs text-gray-500 italic">
          Server-rendered on each request · Postgres schema{" "}
          <code className="text-gray-700">u1d_ops</code> · Phase 1 MVP
        </footer>
      </div>
    </main>
  );
}
