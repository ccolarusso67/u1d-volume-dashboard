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
import { getLocale } from "@/lib/i18n/server";
import { getDict } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locale";

export const dynamic = "force-dynamic";

const lc = (locale: Locale) => (locale === "es" ? "es-ES" : "en-US");
const money = (n: number, locale: Locale) => "$" + Math.round(n).toLocaleString(lc(locale));
const moneyM = (n: number) => "$" + (n / 1_000_000).toFixed(2) + "M";

export default async function ReconciliationAdminPage() {
  const locale = await getLocale();
  const dict = getDict(locale);
  const t = dict.adminRecon;
  const session = await auth();
  if (!session?.user?.email) redirect("/login?callbackUrl=/admin/reconciliation");
  if (session.user.isAdmin !== true) redirect("/admin");

  const r = await getRevenueReconciliation();

  const ratio = r.pnlIncomeTtm > 0 ? r.u1dInvoiceGross / r.pnlIncomeTtm : null;
  const allRatio = r.pnlIncomeTtm > 0 ? r.allCompaniesInvoiceGross / r.pnlIncomeTtm : null;

  return (
    <main>
      <HeroHeader
        eyebrow={dict.common.company}
        title={t.title}
        subtitle={r.configured ? t.subtitleOk(r.windowEnd ?? "—") : t.subtitleOff}
      />
      <Nav current="/admin" />

      <div className="container mx-auto px-8 py-8 max-w-6xl">
        {!r.configured ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-5 py-4 text-sm">
            {t.notConfigured}
          </div>
        ) : (
          <>
            {/* Headline comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <Card label={t.cardPnl} value={moneyM(r.pnlIncomeTtm)} sub={t.cardPnlSub} tone="navy" />
              <Card label={t.cardU1d} value={moneyM(r.u1dInvoiceGross)} sub={ratio ? t.timesPnl(ratio.toFixed(2)) : "—"} tone={ratio && ratio > 1.3 ? "red" : "navy"} />
              <Card label={t.cardUltraU1d} value={moneyM(r.allCompaniesInvoiceGross)} sub={allRatio ? t.timesPnl(allRatio.toFixed(2)) : "—"} tone={allRatio && allRatio > 1.7 ? "red" : "navy"} />
              <Card label={t.cardSbc} value={moneyM(r.salesByCustomerTtm)} sub={t.cardSbcSub} tone="navy" />
            </div>

            {/* Auto diagnosis */}
            <div className="bg-white border border-line rounded-xl p-6 mb-6">
              <h2 className="font-heading text-lg font-bold text-navy mb-2">{t.reading}</h2>
              <p className="text-sm text-gray-700 leading-relaxed">
                {diagnose(r, t)}
              </p>
            </div>

            {/* Invoice gross by company */}
            <Panel title={t.byCompanyTitle} note={t.byCompanyNote}>
              <table className="w-full text-sm">
                <thead><tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-line">
                  <th className="text-left pb-2">{t.thCompany}</th><th className="text-right pb-2">{t.thGrossRev}</th><th className="text-right pb-2">{t.thInvoices}</th>
                </tr></thead>
                <tbody>
                  {r.invoiceGrossByCompany.map((c) => (
                    <tr key={c.company_id ?? "null"} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 text-navy">{c.company_id ?? "(null)"}</td>
                      <td className="py-2 text-right tabular-nums">{money(c.revenue, locale)}</td>
                      <td className="py-2 text-right tabular-nums text-gray-500">{c.invoices.toLocaleString(lc(locale))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Panel title={t.byCustomerTitle} note={t.byCustomerNote}>
                <table className="w-full text-sm">
                  <thead><tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-line">
                    <th className="text-left pb-2">{t.thCustomer}</th><th className="text-right pb-2">{t.thInvoiceRevenue}</th>
                  </tr></thead>
                  <tbody>
                    {r.byCustomer.map((x, i) => (
                      <tr key={i} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 text-navy">{x.name}</td>
                        <td className="py-2 text-right tabular-nums">{money(x.amount, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>

              <Panel title={t.byClassTitle} note={t.byClassNote}>
                <table className="w-full text-sm">
                  <thead><tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-line">
                    <th className="text-left pb-2">{t.thClass}</th><th className="text-right pb-2">{t.thLineTotal}</th>
                  </tr></thead>
                  <tbody>
                    {r.byClass.map((x, i) => (
                      <tr key={i} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 text-navy">{x.name}</td>
                        <td className="py-2 text-right tabular-nums">{money(x.amount, locale)}</td>
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

function diagnose(
  r: Awaited<ReturnType<typeof getRevenueReconciliation>>,
  t: ReturnType<typeof getDict>["adminRecon"]
): string {
  if (r.pnlIncomeTtm <= 0) return t.diagNoPnl;
  const u = r.u1dInvoiceGross / r.pnlIncomeTtm;
  const a = r.allCompaniesInvoiceGross / r.pnlIncomeTtm;
  if (u <= 1.15) {
    return t.diagReconciled(moneyM(r.u1dInvoiceGross), moneyM(r.pnlIncomeTtm), moneyM(r.allCompaniesInvoiceGross), a.toFixed(1));
  }
  return t.diagWithinU1d(moneyM(r.u1dInvoiceGross), u.toFixed(2), moneyM(r.pnlIncomeTtm));
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
