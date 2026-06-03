/**
 * src/app/customers/page.tsx
 *
 * Customer detail — concentration, YoY movement, and the full customer book
 * for the latest period. Public (read-only), built on existing queries
 * (getLatestMonth + getCustomerYoYForMonth) so it adds no new SQL surface.
 */
import { KPITile } from "@/components/kpi-tile";
import { Nav } from "@/components/nav";
import { HeroHeader } from "@/components/layout/hero-header";
import { getLatestMonth, getCustomerYoYForMonth } from "@/lib/queries/monthly";
import { formatPeriod, fmtNum, fmtPct } from "@/lib/brand";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const latest = await getLatestMonth();
  if (!latest) {
    return (
      <main>
        <Nav current="/customers" />
        <div className="container mx-auto px-8 py-16 max-w-3xl">
          <h1 className="font-heading text-3xl font-bold text-navy mb-4">Customers</h1>
          <p className="text-gray-600">No data loaded yet.</p>
        </div>
      </main>
    );
  }

  const customers = await getCustomerYoYForMonth(latest.period_year, latest.period_month);
  const total = latest.total_gallons || 1;
  const sorted = customers.slice().sort((a, b) => b.current_gallons - a.current_gallons);
  const top = sorted[0];
  const top5 = sorted.slice(0, 5).reduce((s, c) => s + c.current_gallons, 0);
  const interco = customers.filter((c) => c.is_intercompany).reduce((s, c) => s + c.current_gallons, 0);
  const concMax = top ? top.current_gallons : 1;
  const concRows = sorted.slice(0, 15);

  return (
    <main>
      <HeroHeader
        eyebrow="U1DYNAMICS MANUFACTURING LLC"
        title="Customers"
        subtitle={<>Latest period: {formatPeriod(latest.period_year, latest.period_month)} · {customers.length} active accounts</>}
      />
      <Nav current="/customers" />

      <div className="container mx-auto px-8 py-8 max-w-7xl">
        {/* KPI tiles */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KPITile label="Active customers" value={fmtNum(customers.length)} subtitle="this period" accent="navy" />
          <KPITile
            label="Top customer"
            value={top ? fmtPct(top.current_gallons / total, 1, false) : "—"}
            subtitle={top ? top.display_name : "—"}
            accent="navy"
          />
          <KPITile
            label="Top-5 share"
            value={fmtPct(top5 / total, 1, false)}
            subtitle="combined concentration"
            accent={top5 / total >= 0.6 ? "red" : "navy"}
          />
          <KPITile
            label="Intercompany share"
            value={fmtPct(interco / total, 1, false)}
            subtitle="of total gallons"
            accent="navy"
          />
        </div>

        {/* Concentration */}
        <section className="bg-white border border-line rounded-xl p-6 mb-6">
          <h2 className="font-heading text-xl font-bold text-navy">Customer concentration</h2>
          <div className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-semibold mt-1 mb-4">
            {formatPeriod(latest.period_year, latest.period_month)} · top accounts by gallons
          </div>
          {concRows.map((c) => {
            const share = c.current_gallons / total;
            const w = concMax > 0 ? (c.current_gallons / concMax) * 100 : 0;
            return (
              <div key={c.customer_key} className="flex items-center gap-3 my-2.5 text-sm">
                <div className="w-52 truncate text-navy">
                  {c.display_name}
                  {c.is_intercompany && <span className="text-[#1C6FB8] text-[11px]"> · intercompany</span>}
                </div>
                <div className="flex-1 h-2.5 bg-gray-100 rounded overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${w}%`, background: c.is_intercompany ? "#1C6FB8" : "#15385D" }} />
                </div>
                <div className="w-20 text-right text-gray-500 tabular-nums">{fmtNum(c.current_gallons)}</div>
                <div className="w-12 text-right font-bold text-navy tabular-nums">{fmtPct(share, 1, false)}</div>
              </div>
            );
          })}
        </section>

        {/* Full book with YoY */}
        <section className="bg-white border border-line rounded-xl p-6">
          <h2 className="font-heading text-xl font-bold text-navy mb-1">
            Customer book — {formatPeriod(latest.period_year, latest.period_month)} vs {latest.period_year - 1}
          </h2>
          <table className="w-full text-sm mt-4">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-line">
                <th className="text-left pb-2 font-medium">Customer</th>
                <th className="text-right pb-2 font-medium">Prior year</th>
                <th className="text-right pb-2 font-medium">This month</th>
                <th className="text-right pb-2 font-medium">Δ gal</th>
                <th className="text-right pb-2 font-medium">Δ %</th>
                <th className="text-right pb-2 font-medium">% of month</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const share = c.current_gallons / total;
                const neg = c.delta_gallons < 0;
                return (
                  <tr key={c.customer_key} className="border-b border-gray-100 last:border-b-0">
                    <td className="py-2 text-navy">
                      {c.display_name}
                      {c.is_intercompany && <span className="ml-2 text-[10px] uppercase tracking-wider text-gray-500">intercomp.</span>}
                    </td>
                    <td className="py-2 text-right text-gray-500 tabular-nums">{fmtNum(c.prior_gallons)}</td>
                    <td className="py-2 text-right font-medium tabular-nums">{fmtNum(c.current_gallons)}</td>
                    <td className={`py-2 text-right tabular-nums ${neg ? "text-red-600" : ""}`}>
                      {c.delta_gallons >= 0 ? "+" : "−"}{fmtNum(Math.abs(c.delta_gallons))}
                    </td>
                    <td className={`py-2 text-right tabular-nums ${c.delta_pct !== null && c.delta_pct < 0 ? "text-red-600" : ""}`}>
                      {c.delta_pct !== null ? (c.delta_pct >= 0 ? "+" : "") + fmtPct(c.delta_pct, 1, false) : "—"}
                    </td>
                    <td className="py-2 text-right text-gray-500 tabular-nums">{fmtPct(share, 1, false)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
