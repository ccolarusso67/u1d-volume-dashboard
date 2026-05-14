-- ============================================================================
-- u1d-volume-dashboard — initial schema
--
-- Schema: u1d_ops (lives alongside Ultra1Plus pricing-core in the same
-- Postgres instance; isolated by schema name)
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS u1d_ops;

-- ----------------------------------------------------------------------------
-- Catalogs
-- ----------------------------------------------------------------------------

CREATE TABLE u1d_ops.customers (
  customer_key      TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  is_intercompany   BOOLEAN NOT NULL DEFAULT FALSE,
  status            TEXT NOT NULL DEFAULT 'active',
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customers_status_chk CHECK (status IN ('active','dormant','prospect','retired'))
);

CREATE TABLE u1d_ops.packages (
  package_key       TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  family            TEXT NOT NULL,
  container_type    TEXT NOT NULL,
  sort_order        INT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT packages_family_chk CHECK (family IN ('oil','coolant','washer_fluid','def')),
  CONSTRAINT packages_container_chk CHECK (container_type IN
    ('liter','gallon','jug','pail','jerrycan','drum','tote','box','bulk','def'))
);

-- ----------------------------------------------------------------------------
-- Auth: user allowlist (NextAuth signIn callback consults this table)
-- ----------------------------------------------------------------------------

CREATE TABLE u1d_ops.users (
  email             TEXT PRIMARY KEY,
  display_name      TEXT,
  role              TEXT NOT NULL DEFAULT 'viewer',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at     TIMESTAMPTZ,
  CONSTRAINT users_role_chk CHECK (role IN ('viewer','admin'))
);

-- ----------------------------------------------------------------------------
-- Ingested files registry
-- ----------------------------------------------------------------------------

CREATE TABLE u1d_ops.volume_files (
  file_id                   BIGSERIAL PRIMARY KEY,
  filename                  TEXT NOT NULL,
  file_hash                 TEXT NOT NULL,
  period_year               INT NOT NULL,
  period_month              INT NOT NULL,
  source_total_row          NUMERIC(14,3),
  computed_customer_sum     NUMERIC(14,3) NOT NULL,
  has_total_discrepancy     BOOLEAN NOT NULL DEFAULT FALSE,
  discrepancy_amount        NUMERIC(14,3),
  file_size_bytes           INT,
  ingested_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_by               TEXT NOT NULL,
  notes                     TEXT,
  CONSTRAINT volume_files_period_uk UNIQUE (period_year, period_month),
  CONSTRAINT volume_files_month_chk CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT volume_files_year_chk CHECK (period_year BETWEEN 2020 AND 2100)
);

CREATE INDEX volume_files_period_idx
  ON u1d_ops.volume_files (period_year DESC, period_month DESC);

CREATE INDEX volume_files_ingested_at_idx
  ON u1d_ops.volume_files (ingested_at DESC);

CREATE INDEX volume_files_discrepancy_idx
  ON u1d_ops.volume_files (has_total_discrepancy)
  WHERE has_total_discrepancy = TRUE;

-- ----------------------------------------------------------------------------
-- Fact table
-- ----------------------------------------------------------------------------

CREATE TABLE u1d_ops.volume_fact (
  fact_id           BIGSERIAL PRIMARY KEY,
  file_id           BIGINT NOT NULL REFERENCES u1d_ops.volume_files(file_id) ON DELETE CASCADE,
  period_year       INT NOT NULL,
  period_month      INT NOT NULL,
  customer_key      TEXT NOT NULL REFERENCES u1d_ops.customers(customer_key),
  package_key       TEXT NOT NULL REFERENCES u1d_ops.packages(package_key),
  gallons           NUMERIC(14,3) NOT NULL,
  CONSTRAINT volume_fact_uk UNIQUE (period_year, period_month, customer_key, package_key),
  CONSTRAINT volume_fact_gallons_chk CHECK (gallons >= 0),
  CONSTRAINT volume_fact_month_chk CHECK (period_month BETWEEN 1 AND 12)
);

CREATE INDEX volume_fact_period_idx
  ON u1d_ops.volume_fact (period_year DESC, period_month DESC);

CREATE INDEX volume_fact_customer_idx
  ON u1d_ops.volume_fact (customer_key, period_year DESC, period_month DESC);

CREATE INDEX volume_fact_package_idx
  ON u1d_ops.volume_fact (package_key, period_year DESC, period_month DESC);

-- ----------------------------------------------------------------------------
-- Materialized view: monthly totals (feeds the executive dashboard)
-- ----------------------------------------------------------------------------

CREATE MATERIALIZED VIEW u1d_ops.mv_monthly_totals AS
SELECT
  period_year,
  period_month,
  SUM(gallons)::NUMERIC(14,3) AS total_gallons,
  SUM(gallons) FILTER (WHERE customer_key = 'ULTRACHEM')::NUMERIC(14,3) AS ultrachem_gallons,
  SUM(gallons) FILTER (WHERE customer_key <> 'ULTRACHEM')::NUMERIC(14,3) AS external_gallons,
  COUNT(DISTINCT customer_key) FILTER (WHERE gallons > 0)::INT AS active_customers
FROM u1d_ops.volume_fact
GROUP BY period_year, period_month;

CREATE UNIQUE INDEX mv_monthly_totals_uk
  ON u1d_ops.mv_monthly_totals (period_year, period_month);

-- Refresh helper: call after every insert/update of volume_fact
CREATE OR REPLACE FUNCTION u1d_ops.refresh_views() RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY u1d_ops.mv_monthly_totals;
END;
$$ LANGUAGE plpgsql;

COMMIT;
