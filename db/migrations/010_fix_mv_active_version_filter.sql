-- ============================================================================
-- 010_fix_mv_active_version_filter.sql
--
-- BUG FIX (BUG-REGISTER HIGH-1): mv_monthly_totals double-counts after any
-- re-upload.
--
-- Migration 005 changed volume_fact uniqueness to (file_id, customer_key,
-- package_key), so every uploaded VERSION's fact rows now coexist for a
-- period (re-uploads no longer overwrite). 005's own comment states board
-- queries "must join through volume_files and filter on is_active = TRUE
-- (operational view) or locked_at IS NOT NULL (board view)."
--
-- mv_monthly_totals (migration 001) still sums volume_fact with NO file
-- join and NO is_active filter. It was never updated. The moment a period
-- has >= 2 versions, this MV — and everything downstream of it — silently
-- double-counts:
--   * public landing page "/"  (getLatestMonth / getMonth / getRecentMonths)
--   * mv_volume_reconciliation (migration 003) reads billed_gallons FROM
--     mv_monthly_totals, so "/reconciliation" and its inventory-delta math
--     inherit the inflation.
-- The board page is NOT affected (getBoardExecutiveDashboard already filters
-- is_active = TRUE AND locked_at IS NOT NULL).
--
-- FIX: redefine mv_monthly_totals to join volume_files and keep only the
-- ACTIVE version per period. We use is_active = TRUE (operational view) to
-- preserve the pre-005 behavior of the public dashboard, which showed the
-- latest uploaded version (including in_review) — not locked-only. If the
-- public surface should be board-grade instead, change the predicate to
-- f.locked_at IS NOT NULL.
--
-- Postgres cannot CREATE OR REPLACE a materialized view, and
-- mv_volume_reconciliation depends on mv_monthly_totals, so both are dropped
-- and recreated in dependency order. CREATE MATERIALIZED VIEW populates WITH
-- DATA by default, so no REFRESH is needed inside this migration. The
-- refresh_views() helper is unchanged (it references the MVs by name).
--
-- NOTE: each migration file owns its own transaction; the runner does not
-- wrap. DROP/CREATE MATERIALIZED VIEW ... WITH DATA and plain CREATE INDEX
-- are all transactional, so the whole change is atomic.
-- ============================================================================

BEGIN;

-- Drop dependent first, then the base rollup.
DROP MATERIALIZED VIEW IF EXISTS u1d_ops.mv_volume_reconciliation;
DROP MATERIALIZED VIEW IF EXISTS u1d_ops.mv_monthly_totals;

-- ----------------------------------------------------------------------------
-- Recreate mv_monthly_totals — ACTIVE version only (the fix).
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW u1d_ops.mv_monthly_totals AS
SELECT
  vf.period_year,
  vf.period_month,
  SUM(vf.gallons)::NUMERIC(14,3) AS total_gallons,
  SUM(vf.gallons) FILTER (WHERE vf.customer_key = 'ULTRACHEM')::NUMERIC(14,3) AS ultrachem_gallons,
  SUM(vf.gallons) FILTER (WHERE vf.customer_key <> 'ULTRACHEM')::NUMERIC(14,3) AS external_gallons,
  COUNT(DISTINCT vf.customer_key) FILTER (WHERE vf.gallons > 0)::INT AS active_customers
FROM u1d_ops.volume_fact vf
JOIN u1d_ops.volume_files f ON f.file_id = vf.file_id
WHERE f.is_active = TRUE
GROUP BY vf.period_year, vf.period_month;

CREATE UNIQUE INDEX mv_monthly_totals_uk
  ON u1d_ops.mv_monthly_totals (period_year, period_month);

-- ----------------------------------------------------------------------------
-- Recreate mv_volume_reconciliation — body identical to migration 003.
-- It reads billed_gallons FROM mv_monthly_totals, which is now correct.
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW u1d_ops.mv_volume_reconciliation AS
WITH prod AS (
  SELECT
    EXTRACT(YEAR FROM production_date)::INT  AS period_year,
    EXTRACT(MONTH FROM production_date)::INT AS period_month,
    SUM(gallons)::NUMERIC(14,3)              AS produced_gallons,
    COUNT(DISTINCT production_date)::INT     AS working_days
  FROM u1d_ops.production_daily
  GROUP BY 1, 2
),
billed AS (
  SELECT
    period_year,
    period_month,
    total_gallons AS billed_gallons
  FROM u1d_ops.mv_monthly_totals
)
SELECT
  COALESCE(p.period_year, b.period_year)   AS period_year,
  COALESCE(p.period_month, b.period_month) AS period_month,
  p.produced_gallons,
  b.billed_gallons,
  (COALESCE(p.produced_gallons, 0) - COALESCE(b.billed_gallons, 0))::NUMERIC(14,3) AS inventory_delta_gallons,
  CASE WHEN b.billed_gallons > 0 THEN
    ((p.produced_gallons - b.billed_gallons) / b.billed_gallons)::NUMERIC(8,4)
  END AS inventory_delta_pct,
  p.working_days
FROM prod p
FULL OUTER JOIN billed b
  ON p.period_year = b.period_year AND p.period_month = b.period_month
WHERE COALESCE(p.produced_gallons, 0) > 0
   OR COALESCE(b.billed_gallons, 0) > 0;

CREATE UNIQUE INDEX mv_volume_reconciliation_uk
  ON u1d_ops.mv_volume_reconciliation (period_year, period_month);

COMMIT;

-- ============================================================================
-- MANUAL VERIFICATION (run after db:migrate; not part of the transaction).
--
-- 1) Totals should be unchanged for all single-version periods (sanity):
--      SELECT period_year, period_month, total_gallons
--        FROM u1d_ops.mv_monthly_totals ORDER BY 1,2;
--
-- 2) Prove the fix on a multi-version period. Pick a locked period, note its
--    total, re-upload a DIFFERENT-hash file for the same period (creates v2,
--    supersedes v1), then:
--      SELECT u1d_ops.refresh_views();
--      SELECT total_gallons FROM u1d_ops.mv_monthly_totals
--       WHERE period_year = :yyyy AND period_month = :mm;
--    The total must equal the ACTIVE version's sum, NOT the sum of both
--    versions. Before this migration it would have been the sum of both.
--
-- 3) Cross-check against the board path (which was always correct):
--      -- compare mv_monthly_totals.total_gallons to the active+locked sum
--      SELECT vf.period_year, vf.period_month, SUM(vf.gallons)
--        FROM u1d_ops.volume_fact vf
--        JOIN u1d_ops.volume_files f ON f.file_id = vf.file_id
--       WHERE f.is_active = TRUE
--       GROUP BY 1,2 ORDER BY 1,2;
-- ============================================================================
