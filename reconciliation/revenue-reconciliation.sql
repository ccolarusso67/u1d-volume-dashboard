-- ============================================================================
-- Revenue reconciliation: customer-file / invoice gross (~$19.7M) vs P&L (~$9.5M)
-- ============================================================================
-- RUN AGAINST THE FINANCE WAREHOUSE (u1p_finance), not the u1d_ops volume DB.
--   railway connect Postgres   (in the u1p_finance_mcp project)   OR psql "<finance URL>"
--
-- Goal: explain the ~2x gap and decide which number is board-grade per-customer.
-- Run each block, paste the results back, and we interpret + close the gap.
-- TTM window used below: 2025-05-01 .. 2026-04-30 (trailing 12 months to Apr 2026).
-- Adjust the dates if you want a different window.
-- ============================================================================

-- Q0. Orient: which company_ids and months exist? (Confirm the U1Dynamics id.)
SELECT DISTINCT company_id FROM invoices ORDER BY 1;
SELECT MIN(month), MAX(month) FROM monthly_pnl;
SELECT DISTINCT company_id FROM monthly_pnl ORDER BY 1;

-- ----------------------------------------------------------------------------
-- Q1. The authoritative number — P&L income TTM (the ~$9.5M).
--     If monthly_pnl.company_id is NULL for U1Dynamics rows, drop the filter.
-- ----------------------------------------------------------------------------
SELECT COALESCE(company_id,'(null)') AS company_id,
       SUM(income)      AS pnl_income_ttm,
       SUM(gross_profit) AS pnl_gross_profit_ttm,
       SUM(net_income)  AS pnl_net_income_ttm
  FROM monthly_pnl
 WHERE report_basis = 'accrual'
   AND month >= DATE '2025-05-01' AND month <= DATE '2026-04-01'
 GROUP BY company_id
 ORDER BY 2 DESC;

-- ----------------------------------------------------------------------------
-- Q2. Candidate "$19.7M": gross invoice-line revenue TTM, BY COMPANY.
--     If one row ~= 19.7M this is single-company; if the SUM across rows ~=19.7M
--     then the 19.7M was summing all 5 companies (root cause = no company filter).
-- ----------------------------------------------------------------------------
SELECT il.company_id,
       SUM(il.line_total) AS invoice_line_revenue_ttm,
       COUNT(DISTINCT i.txn_id) AS invoices
  FROM invoice_lines il
  JOIN invoices i ON i.txn_id = il.invoice_txn_id
 WHERE i.txn_date >= DATE '2025-05-01' AND i.txn_date <= DATE '2026-04-30'
 GROUP BY il.company_id
 ORDER BY 2 DESC;

-- ----------------------------------------------------------------------------
-- Q3. Intercompany driver: invoice revenue by customer (U1Dynamics company).
--     U1Dynamics Mfg / Maxilub / Italchacao / Timspirit names = intercompany.
--     Sum those vs external to size the elimination.
-- ----------------------------------------------------------------------------
SELECT c.full_name AS customer,
       SUM(il.line_total) AS invoice_revenue_ttm
  FROM invoice_lines il
  JOIN invoices i  ON i.txn_id = il.invoice_txn_id
  JOIN customers c ON c.customer_id = i.customer_id
 WHERE il.company_id = 'u1dynamics'                     -- adjust per Q0
   AND i.txn_date >= DATE '2025-05-01' AND i.txn_date <= DATE '2026-04-30'
 GROUP BY c.full_name
 ORDER BY 2 DESC
 LIMIT 20;

-- ----------------------------------------------------------------------------
-- Q4. Non-revenue lines: line_total by class (freight, tax, discounts, deposits
--     inflate gross vs P&L income). Large non-product classes explain part of the gap.
-- ----------------------------------------------------------------------------
SELECT COALESCE(il.class_name,'(none)') AS class_name,
       SUM(il.line_total) AS line_total_ttm,
       COUNT(*) AS lines
  FROM invoice_lines il
  JOIN invoices i ON i.txn_id = il.invoice_txn_id
 WHERE il.company_id = 'u1dynamics'                     -- adjust per Q0
   AND i.txn_date >= DATE '2025-05-01' AND i.txn_date <= DATE '2026-04-30'
 GROUP BY il.class_name
 ORDER BY 2 DESC;

-- ----------------------------------------------------------------------------
-- Q5. Cross-check sales_by_customer (QB's own per-customer sales report).
--     This is QB's customer revenue rollup — compare its total to Q2/Q3.
-- ----------------------------------------------------------------------------
SELECT SUM(sales_amount) AS sales_by_customer_ttm
  FROM sales_by_customer
 WHERE company_id = 'u1dynamics'                         -- adjust per Q0
   AND period_start >= DATE '2025-05-01' AND period_end <= DATE '2026-04-30';

-- ----------------------------------------------------------------------------
-- Q6. The reconciliation bridge (fill once Q1–Q5 are known):
--     Gross invoice revenue (U1Dynamics only)        =  ___
--      − intercompany customer revenue (Q3)          = (___)
--      − non-revenue classes: freight/tax/disc (Q4)  = (___)
--      − cash/accrual & period timing                = (___)
--      = expected ≈ P&L income (Q1)                  =  ___
-- ============================================================================
