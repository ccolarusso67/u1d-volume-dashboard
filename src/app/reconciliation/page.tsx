import { Nav } from "@/components/nav";
import { HeroHeader } from "@/components/layout/hero-header";
import { KPITile } from "@/components/kpi-tile";
import { getReconciliation } from "@/lib/queries/production";
import { formatPeriod, fmtNum, fmtPct } from "@/lib/brand";
import { getLocale } from "@/lib/i18n/server";
import { getDict } from "@/lib/i18n/dictionaries";

export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  const locale = await getLocale();
  const d = getDict(locale);
  const t = d.reconciliation;
  const rows = await getReconciliation();

  // Aggregate only over months that have BOTH produced AND billed
  const matched = rows.filter(
    (r) => r.produced_gallons !== null && r.billed_gallons !== null
  );
  const totalProduced = matched.reduce((a, r) => a + (r.produced_gallons ?? 0), 0);
  const totalBilled = matched.reduce((a, r) => a + (r.billed_gallons ?? 0), 0);
  const totalDelta = totalProduced - totalBilled;
  const totalDeltaPct = totalBilled > 0 ? totalDelta / totalBilled : null;

  // Find extremes
  let biggestBurn = matched[0];
  let biggestBuild = matched[0];
  for (const r of matched) {
    if (r.inventory_delta_gallons !== null) {
      if (r.inventory_delta_gallons < (biggestBurn.inventory_delta_gallons ?? 0)) {
        biggestBurn = r;
      }
      if (r.inventory_delta_gallons > (biggestBuild.inventory_delta_gallons ?? 0)) {
        biggestBuild = r;
      }
    }
  }

  return (
    <main>
      <HeroHeader
        eyebrow={d.common.company}
        title={t.title}
        subtitle={t.subtitle}
      />
      <Nav current="/reconciliation" />

      <div className="container mx-auto px-8 py-8 max-w-7xl">
        {/* KPI tiles — all navy, +/- carries direction */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KPITile
            label={t.kpiProduced}
            value={fmtNum(totalProduced, 0, locale)}
            subtitle={t.kpiProducedSub(matched.length)}
            accent="navy"
          />
          <KPITile
            label={t.kpiBilled}
            value={fmtNum(totalBilled, 0, locale)}
            subtitle={t.kpiBilledSub(matched.length)}
            accent="navy"
          />
          <KPITile
            label={t.kpiInvDelta}
            value={(totalDelta >= 0 ? "+" : "") + fmtNum(totalDelta, 0, locale)}
            subtitle={totalDelta < 0 ? t.invDeltaDrawn : t.invDeltaBuilt}
            accent="navy"
          />
          <KPITile
            label={t.kpiDeltaVsBilled}
            value={
              (totalDeltaPct !== null && totalDeltaPct >= 0 ? "+" : "") +
              fmtPct(totalDeltaPct, 1, false, locale)
            }
            subtitle={t.deltaVsBilledSub}
            accent="navy"
          />
        </div>

        {/* Extremes callout — neutral framing */}
        <section className="bg-amber-50 border border-amber-200 rounded-sm p-5 mb-6">
          <div className="font-heading text-base font-bold text-navy mb-3">
            {t.extremesTitle}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-semibold text-navy">{t.largestDrawdown}</span>{" "}
              {formatPeriod(biggestBurn.period_year, biggestBurn.period_month, locale)} —{" "}
              {t.extremeDetail(
                fmtNum(biggestBurn.produced_gallons ?? 0, 0, locale),
                fmtNum(biggestBurn.billed_gallons ?? 0, 0, locale),
                fmtNum(biggestBurn.inventory_delta_gallons ?? 0, 0, locale),
                fmtPct(biggestBurn.inventory_delta_pct, 1, false, locale)
              )}
            </div>
            <div>
              <span className="font-semibold text-navy">{t.largestBuildup}</span>{" "}
              {formatPeriod(biggestBuild.period_year, biggestBuild.period_month, locale)} —{" "}
              {t.extremeDetail(
                fmtNum(biggestBuild.produced_gallons ?? 0, 0, locale),
                fmtNum(biggestBuild.billed_gallons ?? 0, 0, locale),
                "+" + fmtNum(biggestBuild.inventory_delta_gallons ?? 0, 0, locale),
                "+" + fmtPct(biggestBuild.inventory_delta_pct, 1, false, locale)
              )}
            </div>
          </div>
        </section>

        {/* Full table — neutral colors, +/- sign carries direction */}
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <h2 className="font-heading text-xl font-bold text-navy mb-1">
            {t.tableTitle}
          </h2>
          <div className="text-xs text-gray-500 mb-4">
            {t.tableNote}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                <th className="text-left pb-2 font-medium">{t.thPeriod}</th>
                <th className="text-right pb-2 font-medium">{t.thProduced}</th>
                <th className="text-right pb-2 font-medium">{t.thBilled}</th>
                <th className="text-right pb-2 font-medium">{t.thDeltaInv}</th>
                <th className="text-right pb-2 font-medium">{d.common.deltaPct}</th>
                <th className="text-right pb-2 font-medium">{t.thWorkingDays}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.period_year}-${r.period_month}`}
                  className="border-b border-gray-100 last:border-b-0"
                >
                  <td className="py-2 text-navy">
                    {formatPeriod(r.period_year, r.period_month, locale)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {r.produced_gallons !== null ? fmtNum(r.produced_gallons, 0, locale) : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {r.billed_gallons !== null ? fmtNum(r.billed_gallons, 0, locale) : "—"}
                  </td>
                  <td className="py-2 text-right font-medium text-navy tabular-nums">
                    {r.inventory_delta_gallons !== null
                      ? (r.inventory_delta_gallons >= 0 ? "+" : "") +
                        fmtNum(r.inventory_delta_gallons, 0, locale)
                      : "—"}
                  </td>
                  <td className="py-2 text-right text-navy tabular-nums">
                    {r.inventory_delta_pct !== null
                      ? (r.inventory_delta_pct >= 0 ? "+" : "") +
                        fmtPct(r.inventory_delta_pct, 1, false, locale)
                      : "—"}
                  </td>
                  <td className="py-2 text-right text-gray-500">
                    {r.working_days ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <footer className="mt-12 text-xs text-gray-500 italic">
          {t.footer}
        </footer>
      </div>
    </main>
  );
}
