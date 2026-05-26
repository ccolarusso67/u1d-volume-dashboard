-- ============================================================================
-- u1d-volume-dashboard — PR 003E
--
-- Adds updated_by audit column to monthly_operator_notes.
--
-- The existing table from migration 005 tracks completed_by/completed_at
-- (who marked the operator notes complete) and updated_at (the row's last
-- change time) but does NOT capture which admin made the most recent
-- change. updated_by closes that audit gap.
--
-- Idempotent via the IF NOT EXISTS clause on ALTER TABLE ADD COLUMN
-- (PostgreSQL 9.6+). No data migration is required; the column is
-- nullable, and the save helper backfills it on every UPSERT.
-- ============================================================================

BEGIN;

ALTER TABLE u1d_ops.monthly_operator_notes
  ADD COLUMN IF NOT EXISTS updated_by TEXT;

COMMIT;
