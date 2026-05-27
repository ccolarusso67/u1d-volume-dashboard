import { Nav } from "@/components/nav";
import { HeroHeader } from "@/components/layout/hero-header";
import { KPITile } from "@/components/kpi-tile";
import { getReconciliation } from "@/lib/queries/production";
import { formatPeriod, fmtNum, fmtPct } from "@/lib/brand";

export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
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
        eyebrow="U1DYNAMICS MANUFACTURING LLC"
        title="Reconciliation"
        subtitle="Production vs billing per period — surfaces inventory build/burn"
      />
      <Nav current="/reconciliation" />

      <div className="container mx-auto px-8 py-8 max-w-7xl">
        {/* KPI tiles — all navy, +/- carries direction */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KPITile
            label="Total Produced"
            value={fmtNum(totalProduced)}
            subtitle={`across ${matched.length} matched months`}
            accent="navy"
          />
          <KPITile
            label="Total Billed"
            value={fmtNum(totalBilled)}
            subtitle={`same ${matched.length} months`}
            accent="navy"
          />
          <KPITile
            label="Inventory Δ"
            value={(totalDelta >= 0 ? "+" : "") + fmtNum(totalDelta)}
            subtitle={
              totalDelta < 0
                ? "net inventory drawn down"
                : "net inventory built up"
            }
            accent="navy"
          />
          <KPITile
            label="Δ vs Billed"
            value={
              (totalDeltaPct !== null && totalDeltaPct >= 0 ? "+" : "") +
              fmtPct(totalDeltaPct, 1, false)
            }
            subtitle="aggregate (produced − billed) ÷ billed"
            accent="navy"
          />
        </div>

        {/* Extremes callout — neutral framing */}
        <section className="bg-amber-50 border border-amber-200 rounded-sm p-5 mb-6">
          <div className="font-heading text-base font-bold text-navy mb-3">
            Inventory dynamics — extremes
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-semibold text-navy">Largest drawdown:</span>{" "}
              {formatPeriod(biggestBurn.period_year, biggestBurn.period_month)} —
              produced {fmtNum(biggestBurn.produced_gallons ?? 0)} vs billed{" "}
              {fmtNum(biggestBurn.billed_gallons ?? 0)} (
              {fmtNum(biggestBurn.inventory_delta_gallons ?? 0)} gal,{" "}
              {fmtPct(biggestBurn.inventory_delta_pct, 1, false)})
            </div>
            <div>
              <span className="font-semibold text-navy">Largest buildup:</span>{" "}
              {formatPeriod(biggestBuild.period_year, biggestBuild.period_month)} —
              produced {fmtNum(biggestBuild.produced_gallons ?? 0)} vs billed{" "}
              {fmtNum(biggestBuild.billed_gallons ?? 0)} (+
              {fmtNum(biggestBuild.inventory_delta_gallons ?? 0)} gal, +
              {fmtPct(biggestBuild.inventory_delta_pct, 1, false)})
            </div>
          </div>
        </section>

        {/* Full table — neutral colors, +/- sign carries direction */}
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <h2 className="font-heading text-xl font-bold text-navy mb-1">
            Production vs Billing — All Periods
          </h2>
          <div className="text-xs text-gray-500 mb-4">
            Negative Δ = inventory burn (sold more than produced).
            Positive Δ = inventory build (produced more than sold).
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                <th className="text-left pb-2 font-medium">Period</th>
                <th className="text-right pb-2 font-medium">Produced</th>
                <th className="text-right pb-2 font-medium">Billed</th>
                <th className="text-right pb-2 font-medium">Δ Inventory</th>
                <th className="text-right pb-2 font-medium">Δ %</th>
                <th className="text-right pb-2 font-medium">Working Days</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.period_year}-${r.period_month}`}
                  className="border-b border-gray-100 last:border-b-0"
                >
                  <td className="py-2 text-navy">
                    {formatPeriod(r.period_year, r.period_month)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {r.produced_gallons !== null ? fmtNum(r.produced_gallons) : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {r.billed_gallons !== null ? fmtNum(r.billed_gallons) : "—"}
                  </td>
                  <td className="py-2 text-right font-medium text-navy tabular-nums">
                    {r.inventory_delta_gallons !== null
                      ? (r.inventory_delta_gallons >= 0 ? "+" : "") +
                        fmtNum(r.inventory_delta_gallons)
                      : "—"}
                  </td>
                  <td className="py-2 text-right text-navy tabular-nums">
                    {r.inventory_delta_pct !== null
                      ? (r.inventory_delta_pct >= 0 ? "+" : "") +
                        fmtPct(r.inventory_delta_pct, 1, false)
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
          Reconciliation from <code>u1d_ops.mv_volume_reconciliation</code> ·
          Inventory anchor pending — once set, this page will also show running
          stock on hand and months of cover.
        </footer>
      </div>
    </main>
  );
}
