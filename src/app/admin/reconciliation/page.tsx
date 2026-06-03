/**
 * src/app/admin/reconciliation/page.tsx
 *
 * Admin-only revenue reconciliation — runs the gross-invoice vs P&L diagnostics
 * against the finance warehouse (via the existing finance pool) and renders the
 * bridge in the browser. No psql, no credentials handled client-side.
 */
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Nav } from "@/components/nav";
import { HeroHeader } from "@/components/layout/hero-header";
import { getRevenueReconciliation } from "@/lib/finance/reconcile-revenue";

export const dynamic = "force-dynamic";

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const moneyM = (n: number) => "$" + (n / 1_000_000).toFixed(2) + "M";

export default async function ReconciliationAdminPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login?callbackUrl=/admin/reconciliation");
  if (session.user.isAdmin !== true) redirect("/admin");

  const r = await getRevenueReconciliation();

  const ratio = r.pnlIncomeTtm > 0 ? r.u1dInvoiceGross / r.pnlIncomeTtm : null;
  const allRatio = r.pnlIncomeTtm > 0 ? r.allCompaniesInvoiceGross / r.pnlIncomeTtm : null;

  return (
    <main>
      <HeroHeader
        eyebrow="U1DYNAMICS MANUFACTURING LLC"
        title="Revenue reconciliation"
        subtitle={
          r.configured
            ? <>Gross invoice revenue vs P&amp;L income · trailing 12 months ending {r.windowEnd}</>
            : <>Finance warehouse not connected (U1D_FINANCE_DATABASE_URL unset).</>
        }
      />
      <Nav current="/admin" />

      <div className="container mx-auto px-8 py-8 max-w-6xl">
        {!r.configured ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-5 py-4 text-sm">
            The finance database isn&apos;t configured for this deployment, so the reconciliation can&apos;t run here.
          </div>
        ) : (
          <>
            {/* Headline comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <Card label="P&L income (TTM)" value={moneyM(r.pnlIncomeTtm)} sub="QuickBooks P&L · u1dynamics · accrual" tone="navy" />
              <Card label="Invoice gross — U1Dynamics" value={moneyM(r.u1dInvoiceGross)} sub={ratio ? `${ratio.toFixed(2)}× the P&L` : "—"} tone={ratio && ratio > 1.3 ? "red" : "navy"} />
              <Card label="Invoice gross — Ultrachem + U1D" value={moneyM(r.allCompaniesInvoiceGross)} sub={allRatio ? `${allRatio.toFixed(2)}× the P&L` : "—"} tone={allRatio && allRatio > 1.7 ? "red" : "navy"} />
              <Card label="QB sales-by-customer (TTM)" value={moneyM(r.salesByCustomerTtm)} sub="u1dynamics rollup" tone="navy" />
            </div>

            {/* Auto diagnosis */}
            <div className="bg-white border border-line rounded-xl p-6 mb-6">
              <h2 className="font-heading text-lg font-bold text-navy mb-2">Reading</h2>
              <p className="text-sm text-gray-700 leading-relaxed">
                {diagnose(r)}
              </p>
            </div>

            {/* Invoice gross by company */}
            <Panel title="Gross invoice revenue by company (TTM)" note="Scoped to Ultrachem + U1Dynamics. The ~$19.7M/$24M figure was these two summed, not U1Dynamics alone.">
              <table className="w-full text-sm">
                <thead><tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-line">
                  <th className="text-left pb-2">Company</th><th className="text-right pb-2">Gross invoice revenue</th><th className="text-right pb-2">Invoices</th>
                </tr></thead>
                <tbody>
                  {r.invoiceGrossByCompany.map((c) => (
                    <tr key={c.company_id ?? "null"} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 text-navy">{c.company_id ?? "(null)"}</td>
                      <td className="py-2 text-right tabular-nums">{money(c.revenue)}</td>
                      <td className="py-2 text-right tabular-nums text-gray-500">{c.invoices.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Panel title="U1Dynamics invoice revenue by customer (TTM)" note="Intercompany accounts (U1Dynamics Mfg, Maxilub, etc.) are eliminated in the P&L but appear here.">
                <table className="w-full text-sm">
                  <thead><tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-line">
                    <th className="text-left pb-2">Customer</th><th className="text-right pb-2">Invoice revenue</th>
                  </tr></thead>
                  <tbody>
                    {r.byCustomer.map((x, i) => (
                      <tr key={i} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 text-navy">{x.name}</td>
                        <td className="py-2 text-right tabular-nums">{money(x.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>

              <Panel title="U1Dynamics invoice lines by class (TTM)" note="Freight, tax, discounts, and deposits inflate gross vs P&L income.">
                <table className="w-full text-sm">
                  <thead><tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-line">
                    <th className="text-left pb-2">Class</th><th className="text-right pb-2">Line total</th>
                  </tr></thead>
                  <tbody>
                    {r.byClass.map((x, i) => (
                      <tr key={i} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 text-navy">{x.name}</td>
                        <td className="py-2 text-right tabular-nums">{money(x.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function diagnose(r: Awaited<ReturnType<typeof getRevenueReconciliation>>): string {
  if (r.pnlIncomeTtm <= 0) return "No P&L income found for the window — confirm the finance sync has run for U1Dynamics.";
  const u = r.u1dInvoiceGross / r.pnlIncomeTtm;
  const a = r.allCompaniesInvoiceGross / r.pnlIncomeTtm;
  if (u <= 1.15) {
    return `U1Dynamics gross invoice revenue (${moneyM(r.u1dInvoiceGross)}) is close to P&L income (${moneyM(r.pnlIncomeTtm)}). The ~$19.7M figure was Ultrachem and U1Dynamics combined (${moneyM(r.allCompaniesInvoiceGross)}, ${a.toFixed(1)}× the P&L), a missing company filter, not a real discrepancy. Per-customer dollars are board-grade once scoped to U1Dynamics.`;
  }
  return `U1Dynamics gross invoice revenue (${moneyM(r.u1dInvoiceGross)}) is ${u.toFixed(2)}× the P&L income (${moneyM(r.pnlIncomeTtm)}) — so the gap is within U1Dynamics. Check the by-customer table for intercompany accounts and the by-class table for freight/tax/discount lines; those two should account for most of the difference between gross invoices and net P&L income.`;
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "navy" | "red" }) {
  return (
    <div className={`bg-white border border-line border-t-4 ${tone === "red" ? "border-t-red-600" : "border-t-navy"} rounded-lg shadow-sm px-5 py-4`}>
      <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">{label}</div>
      <div className={`font-heading text-3xl font-bold leading-tight ${tone === "red" ? "text-red-600" : "text-navy"}`}>{value}</div>
      <div className="text-xs text-gray-500 italic mt-2">{sub}</div>
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-line rounded-xl p-6 mb-6">
      <h2 className="font-heading text-lg font-bold text-navy">{title}</h2>
      <div className="text-[11px] text-gray-400 mb-3 mt-1">{note}</div>
      {children}
    </section>
  );
}
