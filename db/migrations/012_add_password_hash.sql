-- ============================================================================
-- 012_add_password_hash.sql
-- ----------------------------------------------------------------------------
-- Adds password-based sign-in to the allowlist. Google OAuth remains available
-- as a fallback provider; this column powers the Credentials provider so admins
-- and board members can sign in with email + password (no Google account or
-- SMTP required).
--
-- password_hash format (see src/lib/auth/password.ts):
--   scrypt$<saltHex>$<keyHex>
-- NULL means the user has no password set yet (cannot sign in via credentials;
-- may still use Google if that provider is configured).
-- ============================================================================

BEGIN;

ALTER TABLE u1d_ops.users
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

COMMIT;
