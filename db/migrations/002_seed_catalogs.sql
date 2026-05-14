-- ============================================================================
-- u1d-volume-dashboard — catalog seeds
--
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Customers (5)
-- ----------------------------------------------------------------------------

INSERT INTO u1d_ops.customers (customer_key, display_name, is_intercompany, status, notes) VALUES
  ('ULTRACHEM',           'ULTRACHEM',           TRUE,  'active',  'Intercompany customer (Ultra1Plus brand entity). Volume anchor.'),
  ('LUBRIMAR',            'LUBRIMAR',            FALSE, 'dormant', 'Dormant since Mar 2025 (last order: 7,500 gal). Commercial decision pending.'),
  ('SUN COAST RESOURCES', 'Sun Coast Resources', FALSE, 'active',  'Cyclical pattern: near-monthly orders of ~4,752 gal.'),
  ('KEY PERFORMANCE',     'Key Performance',     FALSE, 'active',  'Recurring external customer; accelerating in Q1 2026 (+68% YoY).'),
  ('TERRA DISTRIBUTORS',  'Terra Distributors',  FALSE, 'active',  'Stable 450 gal/month pattern. Omitted from TOTAL row in Sep/Nov/Dec 2024 source files (-450 gal).')
ON CONFLICT (customer_key) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      is_intercompany = EXCLUDED.is_intercompany,
      status = EXCLUDED.status,
      notes = EXCLUDED.notes,
      updated_at = NOW();

-- ----------------------------------------------------------------------------
-- Packages (21 categories)
-- ----------------------------------------------------------------------------

INSERT INTO u1d_ops.packages (package_key, display_name, family, container_type, sort_order) VALUES
  ('LITER OIL',     'Liter Oil',       'oil',          'liter',     1),
  ('LITER COOL',    'Liter Coolant',   'coolant',      'liter',     2),
  ('GAL OIL',       'Gallon Oil',      'oil',          'gallon',    3),
  ('GAL COOL',      'Gallon Coolant',  'coolant',      'gallon',    4),
  ('GAL WW',        'Gallon WW',       'washer_fluid', 'gallon',    5),
  ('JUG OIL',       'Jug Oil',         'oil',          'jug',       6),
  ('JUG COOL',      'Jug Coolant',     'coolant',      'jug',       7),
  ('PAIL OIL',      'Pail Oil',        'oil',          'pail',      8),
  ('PAIL COOL',     'Pail Coolant',    'coolant',      'pail',      9),
  ('JERRYCAN OIL',  'Jerrycan Oil',    'oil',          'jerrycan', 10),
  ('JERRYCAN COOL', 'Jerrycan Coolant','coolant',      'jerrycan', 11),
  ('DRUM OIL',      'Drum Oil',        'oil',          'drum',     12),
  ('DRUM COOL',     'Drum Coolant',    'coolant',      'drum',     13),
  ('TOTE OIL',      'Tote Oil',        'oil',          'tote',     14),
  ('TOTE COOL',     'Tote Coolant',    'coolant',      'tote',     15),
  ('BOX OIL',       'Box Oil',         'oil',          'box',      16),
  ('BOX COOL',      'Box Coolant',     'coolant',      'box',      17),
  ('BOX WW',        'Box WW',          'washer_fluid', 'box',      18),
  ('BULK OIL',      'Bulk Oil',        'oil',          'bulk',     19),
  ('BULK COOL',     'Bulk Coolant',    'coolant',      'bulk',     20),
  ('DEF',           'DEF',             'def',          'def',      21)
ON CONFLICT (package_key) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      family = EXCLUDED.family,
      container_type = EXCLUDED.container_type,
      sort_order = EXCLUDED.sort_order;

-- ----------------------------------------------------------------------------
-- User allowlist
-- TODO: confirm exact email addresses with Carmine before first deploy
-- ----------------------------------------------------------------------------

INSERT INTO u1d_ops.users (email, display_name, role) VALUES
  ('carmine.colarusso@ultra1plus.com', 'Carmine Colarusso', 'admin'),
  ('eugenio.piratelli@ultra1plus.com', 'Eugenio Piratelli', 'admin')
ON CONFLICT (email) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      role = EXCLUDED.role,
      is_active = TRUE;

COMMIT;
