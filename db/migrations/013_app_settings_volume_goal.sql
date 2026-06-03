-- ============================================================================
-- 013_app_settings_volume_goal.sql
-- ----------------------------------------------------------------------------
-- Generic key/value settings table + the editable daily volume target used to
-- compute the monthly volume goal (working_days * daily_target).
-- Seeded with 7000 gal/day; an admin can change it in /admin/users → Settings.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS u1d_ops.app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT
);

INSERT INTO u1d_ops.app_settings (key, value)
VALUES ('volume_daily_target_gallons', '7000')
ON CONFLICT (key) DO NOTHING;

COMMIT;
