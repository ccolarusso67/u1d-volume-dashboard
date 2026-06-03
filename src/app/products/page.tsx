/**
 * src/app/products/page.tsx
 *
 * Product detail — category mix, package concentration, and the full package
 * book with YoY for the latest period. Public, built on existing queries
 * (getPackageMixForMonth + getPackageYoYForMonth) — no new SQL surface.
 */
import { KPITile } from "@/components/kpi-tile";
import { Nav } from "@/components/nav";
import { HeroHeader } from "@/components/layout/hero-header";
import { getLatestMonth, getPackageMixForMonth, getPackageYoYForMonth } from "@/lib/queries/monthly";
import { categorizeFamily } from "@/lib/queries/category";
import { formatPeriod, fmtNum, fmtPct } from "@/lib/brand";
import { MixDonut } from "@/components/charts/MixDonut";
import { CATEGORY_COLORS } from "@/components/charts/StackedTrendChart";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const latest = await getLatestMonth();
  if (!latest) {
    return (
      <main>
        <Nav current="/products" />
        <div className="container mx-auto px-8 py-16 max-w-3xl">
          <h1 className="font-heading text-3xl font-bold text-navy mb-4">Products</h1>
          <p className="text-gray-600">No data loaded yet.</p>
        </div>
      </main>
    );
  }

  const [packages, packagesYoY] = await Promise.all([
    getPackageMixForMonth(latest.period_year, latest.period_month),
    getPackageYoYForMonth(latest.period_year, latest.period_month),
  ]);
  const total = latest.total_gallons || 1;

  // Category mix donut (group packages by category).
  const catMap = new Map<string, number>();
  for (const p of packages) {
    const cat = categorizeFamily(p.family);
    catMap.set(cat, (catMap.get(cat) ?? 0) + p.gallons);
  }
  const donutData = Array.from(catMap.entries())
    .map(([name, value]) => ({ name, value }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);
  const donutColors = donutData.map((d) => CATEGORY_COLORS[d.name] ?? "#8A95A3");

  const topPkg = packages[0];
  const catLeader = donutData[0];
  const concRows = packages.slice(0, 15);
  const concMax = topPkg ? topPkg.gallons : 1;
  const sortedYoY = packagesYoY.slice().sort((a, b) => b.current_gallons - a.current_gallons);

  return (
    <main>
      <HeroHeader
        eyebrow="U1DYNAMICS MANUFACTURING LLC"
        title="Products"
        subtitle={<>Latest period: {formatPeriod(latest.period_year, latest.period_month)} · {packages.length} packages</>}
      />
      <Nav current="/products" />

      <div className="container mx-auto px-8 py-8 max-w-7xl">
        {/* KPI tiles */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KPITile label="Package types" value={fmtNum(packages.length)} subtitle="active this period" accent="navy" />
          <KPITile
            label="Top package"
            value={topPkg ? fmtPct(topPkg.pct_of_month, 1, false) : "—"}
            subtitle={topPkg ? topPkg.display_name : "—"}
            accent="navy"
          />
          <KPITile
            label="Category leader"
            value={catLeader ? fmtPct(catLeader.value / total, 1, false) : "—"}
            subtitle={catLeader ? catLeader.name : "—"}
            accent="navy"
          />
          <KPITile label="Categories" value={fmtNum(donutData.length)} subtitle="with volume" accent="navy" />
        </div>

        {/* Category mix + package concentration */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <section className="bg-white border border-line rounded-xl p-6">
            <h2 className="font-heading text-xl font-bold text-navy">Category mix</h2>
            <div className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-semibold mt-1 mb-3">
              {formatPeriod(latest.period_year, latest.period_month)} · share of gallons
            </div>
            {donutData.length > 0 ? (
              <>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-2">
                  {donutData.map((d, i) => (
                    <span key={d.name} className="flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: donutColors[i] }} />
                      {d.name} {fmtPct(d.value / total, 1, false)}
                    </span>
                  ))}
                </div>
                <MixDonut data={donutData} colors={donutColors} />
              </>
            ) : (
              <div className="text-sm italic text-gray-400 py-8 text-center">No category data.</div>
            )}
          </section>

          <section className="bg-white border border-line rounded-xl p-6">
            <h2 className="font-heading text-xl font-bold text-navy">Package concentration</h2>
            <div className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-semibold mt-1 mb-4">
              {formatPeriod(latest.period_year, latest.period_month)} · top packages by gallons
            </div>
            {concRows.map((p) => {
              const w = concMax > 0 ? (p.gallons / concMax) * 100 : 0;
              return (
                <div key={p.package_key} className="flex items-center gap-3 my-2 text-sm">
                  <div className="w-44 truncate text-navy">{p.display_name}</div>
                  <div className="flex-1 h-2.5 bg-gray-100 rounded overflow-hidden">
                    <div className="h-full rounded bg-navy" style={{ width: `${w}%` }} />
                  </div>
                  <div className="w-12 text-right font-bold text-navy tabular-nums">{fmtPct(p.pct_of_month, 1, false)}</div>
                </div>
              );
            })}
          </section>
        </div>

        {/* Full package book with YoY */}
        <section className="bg-white border border-line rounded-xl p-6">
          <h2 className="font-heading text-xl font-bold text-navy mb-1">
            Package book — {formatPeriod(latest.period_year, latest.period_month)} vs {latest.period_year - 1}
          </h2>
          <table className="w-full text-sm mt-4">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-line">
                <th className="text-left pb-2 font-medium">Package</th>
                <th className="text-right pb-2 font-medium">Prior year</th>
                <th className="text-right pb-2 font-medium">This month</th>
                <th className="text-right pb-2 font-medium">Δ gal</th>
                <th className="text-right pb-2 font-medium">Δ %</th>
              </tr>
            </thead>
            <tbody>
              {sortedYoY.map((p) => {
                const neg = p.delta_gallons < 0;
                return (
                  <tr key={p.package_key} className="border-b border-gray-100 last:border-b-0">
                    <td className="py-2 text-navy">{p.display_name}</td>
                    <td className="py-2 text-right text-gray-500 tabular-nums">{fmtNum(p.prior_gallons)}</td>
                    <td className="py-2 text-right font-medium tabular-nums">{fmtNum(p.current_gallons)}</td>
                    <td className={`py-2 text-right tabular-nums ${neg ? "text-red-600" : ""}`}>
                      {p.delta_gallons >= 0 ? "+" : "−"}{fmtNum(Math.abs(p.delta_gallons))}
                    </td>
                    <td className={`py-2 text-right tabular-nums ${p.delta_pct !== null && p.delta_pct < 0 ? "text-red-600" : ""}`}>
                      {p.delta_pct !== null ? (p.delta_pct >= 0 ? "+" : "") + fmtPct(p.delta_pct, 1, false) : "—"}
                    </td>
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
