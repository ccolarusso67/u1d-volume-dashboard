-- ============================================================================
-- u1d-volume-dashboard — production schema (Phase 1.6)
--
-- Adds production tracking alongside the volume domain:
--   - production_lines        catalog of 9 lines with capacity
--   - production_daily        daily gallons + pallets per line
--   - production_files        registry of ingested annual files
--
-- Plus two materialized views:
--   - mv_production_monthly      monthly rollup per line with utilization %
--   - mv_volume_reconciliation   produced vs billed per period (inventory delta)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Production lines catalog
--
-- A "line_key" is a product-line slot. Note that some physical lines run
-- multiple slots:
--   Line 1: QUARTS                              (1 slot)
--   Line 2: DRUMS                               (1 slot)
--   Line 3: 5QT, GAL OIL, GAL COOL              (3 slots — shared physical line)
--   Line 4: PAIL                                (1 slot)
--   Line 5: DEF 1*2.5, DEF 2*2.5                (2 slots — shared physical line)
--   Line 6: TOTES                               (1 slot)
--
-- max_gallons_per_day = installed capacity at single shift
-- target_gallons_per_day = 80% planning target (the operating point that
--   accounts for changeovers, maintenance, and short-stops)
-- ----------------------------------------------------------------------------

CREATE TABLE u1d_ops.production_lines (
  line_key                 TEXT PRIMARY KEY,
  display_name             TEXT NOT NULL,
  parent_line              TEXT NOT NULL,       -- "Line 1" through "Line 6"
  package_category         TEXT NOT NULL,       -- maps loosely to volume package container
  max_pallets_per_day      NUMERIC(8,3) NOT NULL,
  max_gallons_per_day      NUMERIC(10,3) NOT NULL,
  target_pallets_per_day   NUMERIC(8,3) NOT NULL,   -- 80% planning target
  target_gallons_per_day   NUMERIC(10,3) NOT NULL,  -- 80% planning target
  sort_order               INT NOT NULL,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Annual production files registry
--
-- The production source workflow is one file per year (e.g.
-- 2025_MERCHANDISE_PRODUCTION_CONTROL.xlsx), updated continuously as
-- production happens. Each ingest re-parses the entire annual file and
-- upserts production_daily rows by (date, line_key).
-- ----------------------------------------------------------------------------

CREATE TABLE u1d_ops.production_files (
  file_id           BIGSERIAL PRIMARY KEY,
  filename          TEXT NOT NULL,
  file_hash         TEXT NOT NULL,
  file_year         INT NOT NULL,
  rows_loaded       INT NOT NULL,
  working_days      INT NOT NULL,
  total_gallons     NUMERIC(14,3) NOT NULL,
  file_size_bytes   INT,
  ingested_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_by       TEXT NOT NULL,
  notes             TEXT,
  CONSTRAINT production_files_year_uk UNIQUE (file_year),
  CONSTRAINT production_files_year_chk CHECK (file_year BETWEEN 2020 AND 2100)
);

CREATE INDEX production_files_ingested_idx
  ON u1d_ops.production_files (ingested_at DESC);

-- ----------------------------------------------------------------------------
-- Daily production fact table
-- ----------------------------------------------------------------------------

CREATE TABLE u1d_ops.production_daily (
  production_date      DATE NOT NULL,
  line_key             TEXT NOT NULL REFERENCES u1d_ops.production_lines(line_key),
  gallons              NUMERIC(12,3) NOT NULL DEFAULT 0,
  pallets              NUMERIC(8,3) NOT NULL DEFAULT 0,
  file_id              BIGINT NOT NULL REFERENCES u1d_ops.production_files(file_id) ON DELETE CASCADE,
  ingested_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (production_date, line_key),
  CONSTRAINT production_daily_gallons_chk CHECK (gallons >= 0),
  CONSTRAINT production_daily_pallets_chk CHECK (pallets >= 0)
);

CREATE INDEX production_daily_date_idx
  ON u1d_ops.production_daily (production_date DESC);

CREATE INDEX production_daily_line_idx
  ON u1d_ops.production_daily (line_key, production_date DESC);

CREATE INDEX production_daily_month_idx
  ON u1d_ops.production_daily (
    EXTRACT(YEAR FROM production_date),
    EXTRACT(MONTH FROM production_date)
  );

-- ----------------------------------------------------------------------------
-- Materialized view: monthly production rollup per line with utilization
--
-- Utilization is computed against the 80% target (target_gallons_per_day),
-- scaled by working_days in the month. A value > 1.0 means the line ran
-- over its planning target (possible if running multiple shifts or weekends).
-- ----------------------------------------------------------------------------

CREATE MATERIALIZED VIEW u1d_ops.mv_production_monthly AS
SELECT
  EXTRACT(YEAR FROM pd.production_date)::INT AS period_year,
  EXTRACT(MONTH FROM pd.production_date)::INT AS period_month,
  pd.line_key,
  pl.parent_line,
  pl.display_name,
  SUM(pd.gallons)::NUMERIC(14,3) AS gallons,
  SUM(pd.pallets)::NUMERIC(10,3) AS pallets,
  COUNT(DISTINCT pd.production_date)::INT AS working_days,
  CASE WHEN COUNT(DISTINCT pd.production_date) > 0 THEN
    (SUM(pd.gallons) / COUNT(DISTINCT pd.production_date))::NUMERIC(12,3)
  END AS avg_daily_gallons,
  MAX(pd.gallons)::NUMERIC(12,3) AS peak_daily_gallons,
  -- Utilization vs 80% target: 1.0 = at target, 0.5 = half target, etc.
  CASE WHEN pl.target_gallons_per_day > 0 AND COUNT(DISTINCT pd.production_date) > 0 THEN
    (SUM(pd.gallons) / (pl.target_gallons_per_day * COUNT(DISTINCT pd.production_date)))::NUMERIC(6,4)
  END AS utilization_vs_target
FROM u1d_ops.production_daily pd
JOIN u1d_ops.production_lines pl ON pl.line_key = pd.line_key
GROUP BY 1, 2, 3, pl.parent_line, pl.display_name, pl.target_gallons_per_day;

CREATE UNIQUE INDEX mv_production_monthly_uk
  ON u1d_ops.mv_production_monthly (period_year, period_month, line_key);

-- ----------------------------------------------------------------------------
-- Materialized view: produced vs billed reconciliation per period
--
-- Joins the billing side (mv_monthly_totals) with the production side
-- (rolled up from production_daily). The inventory_delta is the canonical
-- "what we made minus what we shipped" number — negative means inventory
-- was burned to meet billing, positive means inventory built up.
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

-- ----------------------------------------------------------------------------
-- Update refresh helper to include the new MVs
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION u1d_ops.refresh_views() RETURNS void AS $$
BEGIN
  -- Order matters: volume rollup feeds the reconciliation MV
  REFRESH MATERIALIZED VIEW CONCURRENTLY u1d_ops.mv_monthly_totals;
  REFRESH MATERIALIZED VIEW CONCURRENTLY u1d_ops.mv_production_monthly;
  REFRESH MATERIALIZED VIEW CONCURRENTLY u1d_ops.mv_volume_reconciliation;
END;
$$ LANGUAGE plpgsql;

COMMIT;
