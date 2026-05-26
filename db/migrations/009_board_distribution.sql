-- ============================================================================
-- u1d-volume-dashboard — PR 004D Board Deck Distribution + Send Audit
--
-- Three new tables in the u1d_ops schema:
--
--   board_distribution_lists
--     Named groups (e.g. "Board Distribution", "Internal Operating Review").
--     Soft-deactivated via is_active rather than DELETE.
--
--   board_distribution_recipients
--     One row per email per list per recipient_type (to/cc/bcc).
--     UNIQUE (list_id, LOWER(email), recipient_type) — same address can sit
--     on the To list AND the BCC list of the same distribution, but not
--     duplicated within one role. Case-insensitive uniqueness handles the
--     common "Jane@x.com" vs "jane@x.com" mistake.
--
--   board_deck_sends
--     Append-only audit. Records every send attempt — both 'sent' and
--     'failed' — including who, when, which file/version, which list,
--     and recipient counts/arrays.
--
-- Privacy decision: we store the FULL to_emails and cc_emails arrays
-- (board members and ops admins should see who got the deck), but for BCC
-- we only store bcc_count. BCC by definition should not leak in audit
-- reads. Operators who need full BCC for compliance can flip this in a
-- future migration.
--
-- file_id is BIGINT to match u1d_ops.volume_files.file_id (BIGSERIAL).
-- No FK on file_id for the same reason as period_lock_events: this is an
-- audit table and must survive any future volume_files maintenance.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. board_distribution_lists
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS u1d_ops.board_distribution_lists (
  list_id      BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  description  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   TEXT,
  CONSTRAINT board_distribution_lists_name_chk CHECK (length(name) > 0)
);

CREATE TRIGGER board_distribution_lists_updated_at
  BEFORE UPDATE ON u1d_ops.board_distribution_lists
  FOR EACH ROW EXECUTE FUNCTION u1d_ops.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. board_distribution_recipients
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS u1d_ops.board_distribution_recipients (
  recipient_id    BIGSERIAL PRIMARY KEY,
  list_id         BIGINT NOT NULL REFERENCES u1d_ops.board_distribution_lists(list_id)
                                  ON DELETE CASCADE,
  email           TEXT NOT NULL,
  display_name    TEXT,
  recipient_type  TEXT NOT NULL DEFAULT 'to',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      TEXT,
  CONSTRAINT recipients_email_chk CHECK (length(email) > 0),
  CONSTRAINT recipients_type_chk CHECK (recipient_type IN ('to', 'cc', 'bcc'))
);

-- Case-insensitive per-role uniqueness (same email can appear in to + bcc
-- of same list, but not twice in the same role).
CREATE UNIQUE INDEX IF NOT EXISTS board_distribution_recipients_unique_idx
  ON u1d_ops.board_distribution_recipients (list_id, LOWER(email), recipient_type);

CREATE INDEX IF NOT EXISTS board_distribution_recipients_active_idx
  ON u1d_ops.board_distribution_recipients (list_id, recipient_type)
  WHERE is_active = TRUE;

CREATE TRIGGER board_distribution_recipients_updated_at
  BEFORE UPDATE ON u1d_ops.board_distribution_recipients
  FOR EACH ROW EXECUTE FUNCTION u1d_ops.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. board_deck_sends — append-only send audit
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS u1d_ops.board_deck_sends (
  send_id              BIGSERIAL PRIMARY KEY,
  period_year          INTEGER NOT NULL,
  period_month         INTEGER NOT NULL,
  file_id              BIGINT,
  version_no           INTEGER,
  deck_filename        TEXT NOT NULL,
  distribution_list_id BIGINT REFERENCES u1d_ops.board_distribution_lists(list_id),
  sent_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_by              TEXT NOT NULL,
  provider             TEXT NOT NULL,
  provider_message_id  TEXT,
  subject              TEXT NOT NULL,
  to_emails            TEXT[] NOT NULL DEFAULT '{}',
  cc_emails            TEXT[] NOT NULL DEFAULT '{}',
  bcc_count            INTEGER NOT NULL DEFAULT 0,
  status               TEXT NOT NULL,
  error_message        TEXT,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT board_deck_sends_status_chk CHECK (status IN ('sent', 'failed')),
  CONSTRAINT board_deck_sends_month_chk CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT board_deck_sends_year_chk CHECK (period_year BETWEEN 2020 AND 2100),
  CONSTRAINT board_deck_sends_sent_by_chk CHECK (length(sent_by) > 0),
  CONSTRAINT board_deck_sends_provider_chk CHECK (length(provider) > 0),
  CONSTRAINT board_deck_sends_bcc_count_chk CHECK (bcc_count >= 0)
);

CREATE INDEX IF NOT EXISTS board_deck_sends_period_idx
  ON u1d_ops.board_deck_sends (period_year DESC, period_month DESC, sent_at DESC);

CREATE INDEX IF NOT EXISTS board_deck_sends_sent_at_idx
  ON u1d_ops.board_deck_sends (sent_at DESC);

-- Optional dev seed: a default "Board Distribution" list, no recipients yet.
-- Idempotent via ON CONFLICT.
INSERT INTO u1d_ops.board_distribution_lists (name, description, is_active, created_by)
VALUES (
  'Board Distribution',
  'Default board-of-directors distribution list. Add recipients before the first send.',
  TRUE,
  'migration-009'
)
ON CONFLICT (name) DO NOTHING;

COMMIT;
