-- ============================================================================
-- u1d-volume-dashboard — PR 003G
--
-- Creates u1d_ops.period_lock_events, the append-only audit trail for
-- lock and reopen lifecycle transitions on a board period.
--
-- Design notes:
--   - file_id is BIGINT NULL to match volume_files.file_id (BIGSERIAL = BIGINT).
--   - No foreign key on file_id. Reasons:
--       1. The audit table is append-only and must survive any future
--          volume_files cleanup. An FK with ON DELETE CASCADE would
--          erase audit history; an FK with RESTRICT would block
--          legitimate maintenance. Neither is acceptable for an
--          audit trail.
--       2. listPeriodEvents() LEFT JOINs by file_id, so missing rows
--          surface as null filename/version without throwing.
--   - metadata is JSONB so callers can attach contextual info
--     (e.g. previous_locked_by) without schema churn.
--
-- Idempotent: every CREATE uses IF NOT EXISTS.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS u1d_ops.period_lock_events (
  event_id       BIGSERIAL PRIMARY KEY,
  period_year    INTEGER NOT NULL,
  period_month   INTEGER NOT NULL,
  file_id        BIGINT,
  event_type     TEXT NOT NULL,
  event_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_by       TEXT NOT NULL,
  prior_status   TEXT,
  new_status     TEXT NOT NULL,
  reason         TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT period_lock_events_type_chk
    CHECK (event_type IN ('locked', 'reopened')),
  CONSTRAINT period_lock_events_month_chk
    CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT period_lock_events_year_chk
    CHECK (period_year BETWEEN 2020 AND 2100),
  CONSTRAINT period_lock_events_event_by_chk
    CHECK (length(event_by) > 0),
  CONSTRAINT period_lock_events_new_status_chk
    CHECK (length(new_status) > 0)
);

CREATE INDEX IF NOT EXISTS period_lock_events_period_idx
  ON u1d_ops.period_lock_events (
    period_year DESC,
    period_month DESC,
    event_at DESC
  );

CREATE INDEX IF NOT EXISTS period_lock_events_file_idx
  ON u1d_ops.period_lock_events (file_id);

COMMIT;
