-- ============================================================================
-- 011_seed_board_users.sql
-- ----------------------------------------------------------------------------
-- Persist the real U1Dynamics board/operating roster into the NextAuth
-- allowlist (u1d_ops.users). Prior to this migration the only committed users
-- were two PLACEHOLDER rows in 002_seed_catalogs.sql using long-form emails
-- (carmine.colarusso@, eugenio.piratelli@). The real team was added by ad-hoc
-- SQL against the live DB and existed only there -- not in version control.
-- This migration makes the roster permanent and rebuild-safe.
--
-- Roles (CHECK constraint allows 'viewer' | 'admin'):
--   admin  -> can upload monthly volume files and lock the close
--   viewer -> read-only (board / auditor visibility)
--
-- Idempotent: re-running re-asserts emails, names, roles, and is_active.
-- ============================================================================

BEGIN;

-- Real roster ---------------------------------------------------------------
INSERT INTO u1d_ops.users (email, display_name, role, is_active) VALUES
  ('ccolarusso@ultra1plus.com', 'Carmine Colarusso', 'admin',  TRUE),  -- CEO
  ('ep@ultra1plus.com',         'Eugenio Piratelli', 'admin',  TRUE),  -- General Manager
  ('dc@ultra1plus.com',         'Diego Castro',      'admin',  TRUE),  -- COO
  ('rchang@ultragroup.com',     'Ramon Chang',       'admin',  TRUE),  -- CMO
  ('amc@mln-mln.com',           'Antonio Melone',    'viewer', TRUE),  -- Board / auditor
  ('gmc@melone-melone.com',     'Giuseppe Melone',   'viewer', TRUE)   -- Board / auditor
ON CONFLICT (email) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      role         = EXCLUDED.role,
      is_active    = TRUE;

-- Remove superseded placeholder accounts and a stray bootstrap login --------
-- Hard-deleted per CEO instruction. uploaded_by is TEXT (no FK), so deleting
-- these user rows is safe; any historical uploaded_by values stay intact.
-- The first two were seeded by 002_seed_catalogs.sql; deleting them here keeps
-- a rebuilt database from resurrecting the wrong long-form addresses.
DELETE FROM u1d_ops.users
 WHERE email IN (
   'carmine.colarusso@ultra1plus.com',
   'eugenio.piratelli@ultra1plus.com',
   'eu@ultra1plus.com',
   'ultrachemllcmiami@gmail.com'
 );

COMMIT;
