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
import { getLocale } from "@/lib/i18n/server";
import { getDict } from "@/lib/i18n/dictionaries";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const locale = await getLocale();
  const d = getDict(locale);
  const t = d.products;
  const latest = await getLatestMonth();
  if (!latest) {
    return (
      <main>
        <Nav current="/products" />
        <div className="container mx-auto px-8 py-16 max-w-3xl">
          <h1 className="font-heading text-3xl font-bold text-navy mb-4">{t.title}</h1>
          <p className="text-gray-600">{d.common.noData}</p>
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
  const donutColors = donutData.map(
    (d, i) => CATEGORY_COLORS[d.name] ?? ["#15385D", "#ED8B00", "#1C6FB8", "#8A95A3", "#C7CFD9"][i % 5]
  );

  const topPkg = packages[0];
  const catLeader = donutData[0];
  const concRows = packages.slice(0, 15);
  const concMax = topPkg ? topPkg.gallons : 1;
  const sortedYoY = packagesYoY.slice().sort((a, b) => b.current_gallons - a.current_gallons);
  const periodLabel = formatPeriod(latest.period_year, latest.period_month, locale);
  const catLabel = (name: string) => d.common.categories[name] ?? name;

  return (
    <main>
      <HeroHeader
        eyebrow={d.common.company}
        title={t.title}
        subtitle={t.subtitle(periodLabel, packages.length)}
      />
      <Nav current="/products" />

      <div className="container mx-auto px-8 py-8 max-w-7xl">
        {/* KPI tiles */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KPITile label={t.kpiPackageTypes} value={fmtNum(packages.length, 0, locale)} subtitle={t.kpiPackageTypesSub} accent="navy" />
          <KPITile
            label={t.kpiTopPackage}
            value={topPkg ? fmtPct(topPkg.pct_of_month, 1, false, locale) : "—"}
            subtitle={topPkg ? topPkg.display_name : "—"}
            accent="navy"
          />
          <KPITile
            label={t.kpiCategoryLeader}
            value={catLeader ? fmtPct(catLeader.value / total, 1, false, locale) : "—"}
            subtitle={catLeader ? catLabel(catLeader.name) : "—"}
            accent="navy"
          />
          <KPITile label={t.kpiCategories} value={fmtNum(donutData.length, 0, locale)} subtitle={t.kpiCategoriesSub} accent="navy" />
        </div>

        {/* Category mix + package concentration */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <section className="bg-white border border-line rounded-xl p-6">
            <h2 className="font-heading text-xl font-bold text-navy">{t.catMixTitle}</h2>
            <div className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-semibold mt-1 mb-3">
              {t.catMixNote(periodLabel)}
            </div>
            {donutData.length > 0 ? (
              <>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-2">
                  {donutData.map((item, i) => (
                    <span key={item.name} className="flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: donutColors[i] }} />
                      {catLabel(item.name)} {fmtPct(item.value / total, 1, false, locale)}
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
            <h2 className="font-heading text-xl font-bold text-navy">{t.concTitle}</h2>
            <div className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-semibold mt-1 mb-4">
              {t.concNote(periodLabel)}
            </div>
            {concRows.map((p) => {
              const w = concMax > 0 ? (p.gallons / concMax) * 100 : 0;
              return (
                <div key={p.package_key} className="flex items-center gap-3 my-2 text-sm">
                  <div className="w-44 truncate text-navy">{p.display_name}</div>
                  <div className="flex-1 h-2.5 bg-gray-100 rounded overflow-hidden">
                    <div className="h-full rounded bg-navy" style={{ width: `${w}%` }} />
                  </div>
                  <div className="w-12 text-right font-bold text-navy tabular-nums">{fmtPct(p.pct_of_month, 1, false, locale)}</div>
                </div>
              );
            })}
          </section>
        </div>

        {/* Full package book with YoY */}
        <section className="bg-white border border-line rounded-xl p-6">
          <h2 className="font-heading text-xl font-bold text-navy mb-1">
            {t.bookTitle(periodLabel, latest.period_year - 1)}
          </h2>
          <table className="w-full text-sm mt-4">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-line">
                <th className="text-left pb-2 font-medium">{t.thPackage}</th>
                <th className="text-right pb-2 font-medium">{d.common.priorYear}</th>
                <th className="text-right pb-2 font-medium">{d.common.thisMonth}</th>
                <th className="text-right pb-2 font-medium">{d.common.deltaGal}</th>
                <th className="text-right pb-2 font-medium">{d.common.deltaPct}</th>
              </tr>
            </thead>
            <tbody>
              {sortedYoY.map((p) => {
                const neg = p.delta_gallons < 0;
                return (
                  <tr key={p.package_key} className="border-b border-gray-100 last:border-b-0">
                    <td className="py-2 text-navy">{p.display_name}</td>
                    <td className="py-2 text-right text-gray-500 tabular-nums">{fmtNum(p.prior_gallons, 0, locale)}</td>
                    <td className="py-2 text-right font-medium tabular-nums">{fmtNum(p.current_gallons, 0, locale)}</td>
                    <td className={`py-2 text-right tabular-nums ${neg ? "text-red-600" : ""}`}>
                      {p.delta_gallons >= 0 ? "+" : "−"}{fmtNum(Math.abs(p.delta_gallons), 0, locale)}
                    </td>
                    <td className={`py-2 text-right tabular-nums ${p.delta_pct !== null && p.delta_pct < 0 ? "text-red-600" : ""}`}>
                      {p.delta_pct !== null ? (p.delta_pct >= 0 ? "+" : "") + fmtPct(p.delta_pct, 1, false, locale) : "—"}
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
