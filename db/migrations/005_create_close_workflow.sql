-- ============================================================================
-- u1d-volume-dashboard — Phase 1.7 monthly close workflow
--
-- Adds the close-workflow schema:
--   - volume_files versioning + Railway Volume storage columns
--   - volume_fact uniqueness re-anchored on (file_id, customer, package)
--     so multiple file versions per period can coexist (lead-engineer
--     correction 1)
--   - board_periods table for period lifecycle (correction 2)
--   - package_alerts / customer_alerts / data_quality_alerts
--   - monthly_operator_notes for the deck's operator-narrative slides
--   - customer_aliases for label canonicalization (audit gap)
--
-- The migration is idempotent in the sense that running its DDL twice
-- against an already-migrated database would fail loudly, which is the
-- correct behavior; idempotency is enforced by scripts/migrate.ts via
-- u1d_ops.schema_migrations.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Generic updated_at trigger function (reused by board_periods and
--    monthly_operator_notes). Idempotent via CREATE OR REPLACE.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION u1d_ops.set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 2. Extend u1d_ops.volume_files with versioning + Railway Volume storage
-- ----------------------------------------------------------------------------

ALTER TABLE u1d_ops.volume_files
  ADD COLUMN version_no            INT NOT NULL DEFAULT 1,
  ADD COLUMN is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN is_superseded         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN superseded_by_file_id BIGINT REFERENCES u1d_ops.volume_files(file_id),
  ADD COLUMN original_file_path    TEXT,
  ADD COLUMN original_blob_url     TEXT,
  ADD COLUMN storage_provider      TEXT NOT NULL DEFAULT 'railway-volume',
  ADD COLUMN uploaded_by           TEXT,
  ADD COLUMN uploaded_at           TIMESTAMPTZ,
  ADD COLUMN staged_at             TIMESTAMPTZ,
  ADD COLUMN reviewed_at           TIMESTAMPTZ,
  ADD COLUMN locked_at             TIMESTAMPTZ;

-- Backfill uploaded_by / uploaded_at from the legacy ingested_by / ingested_at
-- so the NOT NULL constraint below succeeds. The 32 seed rows all have these.
UPDATE u1d_ops.volume_files
   SET uploaded_by = COALESCE(ingested_by, 'legacy'),
       uploaded_at = ingested_at
 WHERE uploaded_by IS NULL;

ALTER TABLE u1d_ops.volume_files
  ALTER COLUMN uploaded_by SET NOT NULL,
  ALTER COLUMN uploaded_at SET NOT NULL,
  ALTER COLUMN uploaded_at SET DEFAULT NOW();

ALTER TABLE u1d_ops.volume_files
  ADD CONSTRAINT volume_files_storage_provider_chk
    CHECK (storage_provider IN ('railway-volume','s3','r2'));

-- Drop legacy per-period uniqueness; replace with versioned uniqueness so
-- multiple versions of the same period can coexist (rules 4, 6).
ALTER TABLE u1d_ops.volume_files
  DROP CONSTRAINT volume_files_period_uk;

ALTER TABLE u1d_ops.volume_files
  ADD CONSTRAINT volume_files_period_version_uk
    UNIQUE (period_year, period_month, version_no);

-- Enforce: exactly one active file per period (storage rule 5).
CREATE UNIQUE INDEX volume_files_active_period_uk
  ON u1d_ops.volume_files (period_year, period_month)
  WHERE is_active = TRUE;

-- Hash uniqueness — reject duplicate uploads regardless of period (rule 3).
-- Seed rows use synthetic 'seed:YYYY-MM' hashes, all unique by construction.
CREATE UNIQUE INDEX volume_files_hash_uk
  ON u1d_ops.volume_files (file_hash);

-- Coherence: a row cannot be simultaneously active and superseded.
ALTER TABLE u1d_ops.volume_files
  ADD CONSTRAINT volume_files_active_coherence_chk
    CHECK (NOT (is_active = TRUE AND is_superseded = TRUE));

-- Convenience index for "show me every version of period X, newest first".
CREATE INDEX volume_files_period_version_idx
  ON u1d_ops.volume_files (period_year DESC, period_month DESC, version_no DESC);

-- ----------------------------------------------------------------------------
-- 3. Make volume_fact version-aware (CORRECTION 1)
--
-- Before: UNIQUE (period_year, period_month, customer_key, package_key)
--   → only one row per period, prevents multi-version coexistence.
--
-- After: UNIQUE (file_id, customer_key, package_key)
--   → each file version owns its own fact rows. Re-uploads do NOT overwrite
--   prior facts. Board queries must join through volume_files and filter on
--   is_active = TRUE (operational view) or locked_at IS NOT NULL (board view).
--
-- period_year / period_month columns are RETAINED for query convenience and
-- existing indexes still point to them.
-- ----------------------------------------------------------------------------

ALTER TABLE u1d_ops.volume_fact
  DROP CONSTRAINT volume_fact_uk;

ALTER TABLE u1d_ops.volume_fact
  ADD CONSTRAINT volume_fact_file_uk
    UNIQUE (file_id, customer_key, package_key);

-- Supporting index for "current active version per period" query pattern.
CREATE INDEX volume_fact_file_period_idx
  ON u1d_ops.volume_fact (file_id, period_year, period_month);

-- ----------------------------------------------------------------------------
-- 4. board_periods — period lifecycle (CORRECTION 2)
--
-- Replaces the period_status table from the prior plan. One row per period,
-- pointing at the currently active file_id. Status transitions are governed
-- by application code, not enforced in SQL (deliberate — review tooling
-- and reopen flows need flexibility).
-- ----------------------------------------------------------------------------

CREATE TABLE u1d_ops.board_periods (
  board_period_id   BIGSERIAL PRIMARY KEY,
  period_year       INT NOT NULL,
  period_month      INT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open',
  active_file_id    BIGINT REFERENCES u1d_ops.volume_files(file_id),
  reviewed_at       TIMESTAMPTZ,
  reviewed_by       TEXT,
  locked_at         TIMESTAMPTZ,
  locked_by         TEXT,
  reopened_at       TIMESTAMPTZ,
  reopened_by       TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT board_periods_period_uk UNIQUE (period_year, period_month),
  CONSTRAINT board_periods_month_chk CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT board_periods_year_chk  CHECK (period_year BETWEEN 2020 AND 2100),
  CONSTRAINT board_periods_status_chk CHECK (status IN
    ('open','staged','in_review','locked','superseded','reopened'))
);

CREATE INDEX board_periods_status_idx
  ON u1d_ops.board_periods (status, period_year DESC, period_month DESC);

CREATE TRIGGER board_periods_updated_at
  BEFORE UPDATE ON u1d_ops.board_periods
  FOR EACH ROW EXECUTE FUNCTION u1d_ops.set_updated_at();

-- Backfill: every period with an active file gets a board_periods row in
-- 'open' status pointing at it. Status remains 'open' rather than 'locked'
-- because the legacy seed predates the review/lock workflow — locking is a
-- deliberate admin action.
INSERT INTO u1d_ops.board_periods
  (period_year, period_month, status, active_file_id, created_at, updated_at)
SELECT vf.period_year, vf.period_month, 'open', vf.file_id, vf.uploaded_at, vf.uploaded_at
FROM u1d_ops.volume_files vf
WHERE vf.is_active = TRUE
ON CONFLICT (period_year, period_month) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. package_alerts — unknown packages observed during parse
-- ----------------------------------------------------------------------------

CREATE TABLE u1d_ops.package_alerts (
  alert_id              BIGSERIAL PRIMARY KEY,
  file_id               BIGINT NOT NULL REFERENCES u1d_ops.volume_files(file_id) ON DELETE CASCADE,
  raw_label             TEXT NOT NULL,
  gallons_observed      NUMERIC(14,3) NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'pending',
  mapped_to_package_key TEXT REFERENCES u1d_ops.packages(package_key),
  resolved_by           TEXT,
  resolved_at           TIMESTAMPTZ,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT package_alerts_status_chk CHECK (status IN ('pending','mapped','ignored'))
);

CREATE INDEX package_alerts_file_idx ON u1d_ops.package_alerts (file_id);
CREATE INDEX package_alerts_pending_idx
  ON u1d_ops.package_alerts (file_id) WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- 6. customer_alerts — unknown customers observed during parse
-- ----------------------------------------------------------------------------

CREATE TABLE u1d_ops.customer_alerts (
  alert_id               BIGSERIAL PRIMARY KEY,
  file_id                BIGINT NOT NULL REFERENCES u1d_ops.volume_files(file_id) ON DELETE CASCADE,
  raw_label              TEXT NOT NULL,
  gallons_observed       NUMERIC(14,3) NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL DEFAULT 'pending',
  mapped_to_customer_key TEXT REFERENCES u1d_ops.customers(customer_key),
  resolved_by            TEXT,
  resolved_at            TIMESTAMPTZ,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_alerts_status_chk CHECK (status IN ('pending','mapped','ignored'))
);

CREATE INDEX customer_alerts_file_idx ON u1d_ops.customer_alerts (file_id);
CREATE INDEX customer_alerts_pending_idx
  ON u1d_ops.customer_alerts (file_id) WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- 7. data_quality_alerts — generic data-integrity flags surfaced by the parser
--   (TOTAL row mismatch, negative values, missing customers, etc.)
-- ----------------------------------------------------------------------------

CREATE TABLE u1d_ops.data_quality_alerts (
  alert_id     BIGSERIAL PRIMARY KEY,
  file_id      BIGINT NOT NULL REFERENCES u1d_ops.volume_files(file_id) ON DELETE CASCADE,
  alert_kind   TEXT NOT NULL,
  severity     TEXT NOT NULL DEFAULT 'warn',
  message      TEXT NOT NULL,
  payload      JSONB,
  status       TEXT NOT NULL DEFAULT 'pending',
  resolved_by  TEXT,
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT data_quality_alerts_severity_chk CHECK (severity IN ('info','warn','error')),
  CONSTRAINT data_quality_alerts_status_chk   CHECK (status IN ('pending','acknowledged','ignored'))
);

CREATE INDEX data_quality_alerts_file_idx ON u1d_ops.data_quality_alerts (file_id);
CREATE INDEX data_quality_alerts_pending_idx
  ON u1d_ops.data_quality_alerts (file_id) WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- 8. monthly_operator_notes — board deck operator-narrative slides (13-16)
--
-- Markdown text fields; one row per period. Lock is independent of the
-- volume file lock — operations sign off on narrative separately from data.
-- ----------------------------------------------------------------------------

CREATE TABLE u1d_ops.monthly_operator_notes (
  notes_id         BIGSERIAL PRIMARY KEY,
  period_year      INT NOT NULL,
  period_month     INT NOT NULL,
  capacity_md      TEXT,
  supply_chain_md  TEXT,
  quality_md       TEXT,
  initiatives_md   TEXT,
  risks_md         TEXT,
  completed_by     TEXT,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT monthly_operator_notes_period_uk UNIQUE (period_year, period_month),
  CONSTRAINT monthly_operator_notes_month_chk CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT monthly_operator_notes_year_chk  CHECK (period_year BETWEEN 2020 AND 2100)
);

CREATE TRIGGER monthly_operator_notes_updated_at
  BEFORE UPDATE ON u1d_ops.monthly_operator_notes
  FOR EACH ROW EXECUTE FUNCTION u1d_ops.set_updated_at();

-- ----------------------------------------------------------------------------
-- 9. customer_aliases — canonicalize raw labels from SUMMARY / detail tabs
--
-- The parser currently uses startsWith() against fixed CUSTOMER_KEYS — fragile
-- when labels drift ("SUNCOAST" vs "SUN COAST RESOURCES"). This alias table
-- lets the parser (and the review UI) canonicalize before matching, with new
-- aliases routed through customer_alerts → review → INSERT alias.
--
-- raw_label is stored UPPERCASE; parser must uppercase before lookup.
-- ----------------------------------------------------------------------------

CREATE TABLE u1d_ops.customer_aliases (
  alias_id      BIGSERIAL PRIMARY KEY,
  raw_label     TEXT NOT NULL UNIQUE,
  customer_key  TEXT NOT NULL REFERENCES u1d_ops.customers(customer_key),
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_aliases_raw_upper_chk CHECK (raw_label = UPPER(raw_label))
);

CREATE INDEX customer_aliases_customer_idx
  ON u1d_ops.customer_aliases (customer_key);

-- Seed the variants observed in the existing source files.
INSERT INTO u1d_ops.customer_aliases (raw_label, customer_key, created_by) VALUES
  ('SUNCOAST',            'SUN COAST RESOURCES', 'migration-005'),
  ('SUN COAST',           'SUN COAST RESOURCES', 'migration-005'),
  ('SUN COAST RESOURCES', 'SUN COAST RESOURCES', 'migration-005'),
  ('KEYPERFOR',           'KEY PERFORMANCE',     'migration-005'),
  ('KEY PERFORMANCE',     'KEY PERFORMANCE',     'migration-005'),
  ('TERRA',               'TERRA DISTRIBUTORS',  'migration-005'),
  ('TERRA DISTRIBUTORS',  'TERRA DISTRIBUTORS',  'migration-005'),
  ('ULTRACHEM',           'ULTRACHEM',           'migration-005'),
  ('LUBRIMAR',            'LUBRIMAR',            'migration-005')
ON CONFLICT (raw_label) DO NOTHING;

COMMIT;
