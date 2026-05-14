import { Nav } from "@/components/nav";
import { KPITile } from "@/components/kpi-tile";
import { getReconciliation } from "@/lib/queries/production";
import { formatPeriod, fmtNum, fmtPct } from "@/lib/brand";

export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  const rows = await getReconciliation();
  // Only consider rows where both sides exist for headline KPIs
  const matched = rows.filter(
    (r) => r.produced_gallons !== null && r.billed_gallons !== null
  );

  const totalProduced = matched.reduce(
    (a, r) => a + (r.produced_gallons ?? 0),
    0
  );
  const totalBilled = matched.reduce(
    (a, r) => a + (r.billed_gallons ?? 0),
    0
  );
  const totalDelta = totalProduced - totalBilled;
  const totalDeltaPct = totalBilled > 0 ? totalDelta / totalBilled : null;

  // Identify the most extreme inventory burn / build months
  const sorted = [...matched].sort(
    (a, b) => (a.inventory_delta_gallons ?? 0) - (b.inventory_delta_gallons ?? 0)
  );
  const biggestBurn = sorted[0]; // most negative
  const biggestBuild = sorted[sorted.length - 1]; // most positive

  return (
    <main>
      <header className="bg-navy text-white">
        <div className="container mx-auto px-8 py-6 max-w-7xl">
          <div className="text-[11px] tracking-[0.2em] opacity-80 mb-1">
            U1DYNAMICS MANUFACTURING LLC
          </div>
          <h1 className="font-heading text-3xl font-bold">Reconciliation</h1>
          <div className="text-sm opacity-80 mt-2 italic">
            Production vs billing per period — surfaces inventory build/burn
          </div>
        </div>
      </header>
      <Nav current="/reconciliation" />

      <div className="container mx-auto px-8 py-8 max-w-7xl">
        {matched.length === 0 ? (
          <p className="text-gray-600">
            No overlapping periods with both production and billing data yet.
          </p>
        ) : (
          <>
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
                label="Inventory Delta"
                value={(totalDelta >= 0 ? "+" : "") + fmtNum(totalDelta)}
                subtitle={
                  totalDelta < 0
                    ? "net inventory burned over period"
                    : "net inventory built over period"
                }
                accent={totalDelta < 0 ? "red" : "success"}
              />
              <KPITile
                label="Delta vs Billed"
                value={fmtPct(totalDeltaPct)}
                subtitle="aggregate (produced − billed) ÷ billed"
                accent={
                  totalDeltaPct !== null && totalDeltaPct < 0 ? "red" : "success"
                }
              />
            </div>

            {biggestBurn && biggestBuild && (
              <section className="bg-amber-50 border border-amber-200 rounded-sm p-5 mb-6">
                <h2 className="font-heading text-base font-bold text-navy mb-2">
                  Inventory dynamics — extremes
                </h2>
                <div className="text-sm text-gray-700 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <span className="font-semibold text-[#E1261C]">
                      Biggest burn:
                    </span>{" "}
                    {biggestBurn.period_year &&
                      formatPeriod(
                        biggestBurn.period_year,
                        biggestBurn.period_month
                      )}
                    {" — "}
                    produced {fmtNum(biggestBurn.produced_gallons)} vs billed{" "}
                    {fmtNum(biggestBurn.billed_gallons)} (
                    {fmtNum(biggestBurn.inventory_delta_gallons)} gal,{" "}
                    {fmtPct(biggestBurn.inventory_delta_pct)})
                  </div>
                  <div>
                    <span className="font-semibold text-emerald-700">
                      Biggest build:
                    </span>{" "}
                    {biggestBuild.period_year &&
                      formatPeriod(
                        biggestBuild.period_year,
                        biggestBuild.period_month
                      )}
                    {" — "}
                    produced {fmtNum(biggestBuild.produced_gallons)} vs billed{" "}
                    {fmtNum(biggestBuild.billed_gallons)} (
                    {(biggestBuild.inventory_delta_gallons ?? 0) >= 0 ? "+" : ""}
                    {fmtNum(biggestBuild.inventory_delta_gallons)} gal,{" "}
                    {fmtPct(biggestBuild.inventory_delta_pct)})
                  </div>
                </div>
              </section>
            )}

            <section className="bg-white border border-gray-200 rounded-sm p-6">
              <h2 className="font-heading text-xl font-bold text-navy mb-1">
                Production vs Billing — All Periods
              </h2>
              <div className="text-xs text-gray-500 mb-4">
                Negative delta = inventory burn (sold more than produced).
                Positive delta = inventory build (produced more than sold).
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
                  {rows.map((r) => {
                    const deltaColor =
                      r.inventory_delta_gallons === null
                        ? "text-gray-400"
                        : r.inventory_delta_gallons < 0
                          ? "text-[#E1261C]"
                          : "text-emerald-700";
                    return (
                      <tr
                        key={`${r.period_year}-${r.period_month}`}
                        className="border-b border-gray-100 last:border-b-0"
                      >
                        <td className="py-2 text-navy font-medium">
                          {formatPeriod(r.period_year, r.period_month)}
                        </td>
                        <td className="py-2 text-right">
                          {fmtNum(r.produced_gallons)}
                        </td>
                        <td className="py-2 text-right">
                          {fmtNum(r.billed_gallons)}
                        </td>
                        <td className={`py-2 text-right font-semibold ${deltaColor}`}>
                          {r.inventory_delta_gallons === null
                            ? "—"
                            : (r.inventory_delta_gallons >= 0 ? "+" : "") +
                              fmtNum(r.inventory_delta_gallons)}
                        </td>
                        <td className={`py-2 text-right ${deltaColor}`}>
                          {fmtPct(r.inventory_delta_pct)}
                        </td>
                        <td className="py-2 text-right text-gray-500">
                          {r.working_days ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </>
        )}

        <footer className="mt-12 text-xs text-gray-500 italic">
          Production rolled up from <code>u1d_ops.production_daily</code>;
          billing from <code>u1d_ops.volume_fact</code>. Reconciliation
          view: <code>u1d_ops.mv_volume_reconciliation</code>.
        </footer>
      </div>
    </main>
  );
}
