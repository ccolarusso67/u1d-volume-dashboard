-- ============================================================================
-- u1d-volume-dashboard — PR 002: Board Accuracy Hotfix
--
-- Data fixes that must land before the upload route ships:
--   1. TOTE WW exists in u1d_ops.packages
--      Without this row, any future month with TOTE WW volume would be
--      silently dropped by the parser (which validates each detected
--      package against the catalog before INSERTing into volume_fact).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. TOTE WW package
--
-- Conventions:
--   - package_key:    'TOTE WW'           (matches the SUMMARY column header)
--   - family:         'washer_fluid'      (consistent with GAL WW, BOX WW)
--   - container_type: 'tote'              (consistent with TOTE OIL, TOTE COOL)
--   - sort_order:     22                  (append after the existing 21 rows)
--
-- Idempotent via ON CONFLICT — safe to re-run.
-- ----------------------------------------------------------------------------

INSERT INTO u1d_ops.packages
  (package_key, display_name, family, container_type, sort_order)
VALUES
  ('TOTE WW', 'Tote WW', 'washer_fluid', 'tote', 22)
ON CONFLICT (package_key) DO NOTHING;

COMMIT;
