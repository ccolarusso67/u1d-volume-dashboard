/**
 * src/lib/finance/reconcile-revenue.ts
 *
 * Revenue reconciliation: QuickBooks gross invoice revenue (the ~$19.7M
 * "customer-file" figure) vs the canonical P&L income (~$9.5M).
 *
 * Reads the finance warehouse via the existing finance pool + safeQuery
 * (never throws). Scopes to U1D_COMPANY_ID for the apples-to-apples
 * comparison, and also reports an all-companies breakdown so we can tell
 * whether the $19.7M was simply summing all five companies.
 *
 * Trailing-12-month window ends at the latest synced P&L month.
 */
import { getFinancePool, U1D_COMPANY_ID } from "./db-pool";
import { safeQuery, safeQueryOne } from "./safe-query";

export type CompanyRevenueRow = { company_id: string | null; revenue: number; invoices: number };
export type PnlCompanyRow = { company_id: string | null; income: number };
export type NamedAmountRow = { name: string; amount: number };

export type RevenueReconciliation = {
  configured: boolean;
  windowEnd: string | null; // first day of the latest P&L month
  pnlIncomeTtm: number; // U1Dynamics, accrual
  u1dInvoiceGross: number; // U1Dynamics gross invoice line revenue
  allCompaniesInvoiceGross: number; // every company combined
  salesByCustomerTtm: number; // QB sales_by_customer rollup (U1Dynamics)
  invoiceGrossByCompany: CompanyRevenueRow[];
  pnlByCompany: PnlCompanyRow[];
  byCustomer: NamedAmountRow[]; // U1Dynamics, top 20
  byClass: NamedAmountRow[]; // U1Dynamics
};

const EMPTY: RevenueReconciliation = {
  configured: false, windowEnd: null, pnlIncomeTtm: 0, u1dInvoiceGross: 0,
  allCompaniesInvoiceGross: 0, salesByCustomerTtm: 0,
  invoiceGrossByCompany: [], pnlByCompany: [], byCustomer: [], byClass: [],
};

export async function getRevenueReconciliation(): Promise<RevenueReconciliation> {
  let pool;
  try {
    pool = getFinancePool();
  } catch {
    return EMPTY; // U1D_FINANCE_DATABASE_URL not set
  }

  const maxRow = await safeQueryOne<{ m: string | null }>(
    pool,
    `SELECT TO_CHAR(MAX(month),'YYYY-MM-DD') AS m FROM monthly_pnl WHERE company_id = $1`,
    [U1D_COMPANY_ID]
  );
  const end = maxRow?.m ?? null;
  if (!end) return { ...EMPTY, configured: true };

  const C = [U1D_COMPANY_ID, end] as const;

  const [pnl, invByCo, pnlByCo, byCust, byClass, sbc] = await Promise.all([
    safeQueryOne<{ v: number }>(pool,
      `SELECT COALESCE(SUM(income),0)::float8 AS v FROM monthly_pnl
        WHERE company_id=$1 AND report_basis='accrual'
          AND month >= ($2::date - INTERVAL '11 months') AND month <= $2::date`, [...C]),
    safeQuery<CompanyRevenueRow>(pool,
      `SELECT il.company_id, COALESCE(SUM(il.line_total),0)::float8 AS revenue,
              COUNT(DISTINCT i.txn_id)::int AS invoices
         FROM invoice_lines il JOIN invoices i ON i.txn_id = il.invoice_txn_id
        WHERE il.company_id = ANY(ARRAY['u1p_ultrachem','u1dynamics'])
          AND i.txn_date >= ($1::date - INTERVAL '11 months') AND i.txn_date < ($1::date + INTERVAL '1 month')
        GROUP BY il.company_id ORDER BY 2 DESC`, [end]),
    safeQuery<PnlCompanyRow>(pool,
      `SELECT company_id, COALESCE(SUM(income),0)::float8 AS income FROM monthly_pnl
        WHERE report_basis='accrual' AND month >= ($1::date - INTERVAL '11 months') AND month <= $1::date
        GROUP BY company_id ORDER BY 2 DESC`, [end]),
    safeQuery<NamedAmountRow>(pool,
      `SELECT COALESCE(c.full_name,'(unknown)') AS name, COALESCE(SUM(il.line_total),0)::float8 AS amount
         FROM invoice_lines il JOIN invoices i ON i.txn_id = il.invoice_txn_id
         LEFT JOIN customers c ON c.customer_id = i.customer_id
        WHERE il.company_id=$1 AND i.txn_date >= ($2::date - INTERVAL '11 months') AND i.txn_date < ($2::date + INTERVAL '1 month')
        GROUP BY c.full_name ORDER BY 2 DESC LIMIT 20`, [...C]),
    safeQuery<NamedAmountRow>(pool,
      `SELECT COALESCE(il.class_name,'(none)') AS name, COALESCE(SUM(il.line_total),0)::float8 AS amount
         FROM invoice_lines il JOIN invoices i ON i.txn_id = il.invoice_txn_id
        WHERE il.company_id=$1 AND i.txn_date >= ($2::date - INTERVAL '11 months') AND i.txn_date < ($2::date + INTERVAL '1 month')
        GROUP BY il.class_name ORDER BY 2 DESC`, [...C]),
    safeQueryOne<{ v: number }>(pool,
      `SELECT COALESCE(SUM(sales_amount),0)::float8 AS v FROM sales_by_customer
        WHERE company_id=$1 AND period_start >= ($2::date - INTERVAL '11 months') AND period_end <= ($2::date + INTERVAL '1 month')`, [...C]),
  ]);

  const u1dInvoiceGross = invByCo.find((r) => r.company_id === U1D_COMPANY_ID)?.revenue ?? 0;
  const allCompaniesInvoiceGross = invByCo.reduce((s, r) => s + (r.revenue ?? 0), 0);

  return {
    configured: true,
    windowEnd: end,
    pnlIncomeTtm: pnl?.v ?? 0,
    u1dInvoiceGross,
    allCompaniesInvoiceGross,
    salesByCustomerTtm: sbc?.v ?? 0,
    invoiceGrossByCompany: invByCo,
    pnlByCompany: pnlByCo,
    byCustomer: byCust,
    byClass,
  };
}
