-- ============================================================================
-- u1d-volume-dashboard — production line catalog seed
--
-- Capacities sourced from the CAPACIDAD MAX sheet of the annual production
-- workbooks. The 80% target (target_*) is the planned operating point that
-- accounts for changeovers, maintenance, and short-stops between runs.
-- ============================================================================

BEGIN;

INSERT INTO u1d_ops.production_lines
  (line_key, display_name, parent_line, package_category,
   max_pallets_per_day, max_gallons_per_day,
   target_pallets_per_day, target_gallons_per_day, sort_order, notes)
VALUES
  ('QUARTS',     'Quarts (Line 1)',         'Line 1',      'quart',
   10,    2520,    8,    2016,    1, 'Dedicated quart-bottle filling line.'),

  ('DRUMS',      'Drums (Line 2)',          'Line 2',      'drum',
   103,   22660,   82,   18040,   2, 'Dedicated drum filling line (largest single line by capacity).'),

  ('5QT',        '5QT (Line 3 — Oil)',      'Line 3',      '5qt',
   9,     2025,    7,    1680,    3, 'Shared physical line with GAL OIL and GAL COOL — changeovers reduce effective availability.'),

  ('GAL OIL',    'Gallon Oil (Line 3 — Oil)','Line 3',      'gallon',
   9,     2160,    7,    1680,    4, 'Shared physical line with 5QT and GAL COOL.'),

  ('GAL COOL',   'Gallon Coolant (Line 3 — Cool)','Line 3', 'gallon',
   29,    6264,    23,   5011,    5, 'Shared physical line with 5QT and GAL OIL.'),

  ('PAIL',       'Pail (Line 4)',           'Line 4',      'pail',
   22.5,  6300,    18,   5040,    6, 'Dedicated pail filling line.'),

  ('DEF 1*2.5',  'DEF 1x2.5gal (Line 5)',   'Line 5',      'def',
   18,    3960,    14,   3360,    7, 'Shared physical line with DEF 2*2.5 — DEF only.'),

  ('DEF 2*2.5',  'DEF 2x2.5gal (Line 5)',   'Line 5',      'def',
   19.091, 4200,   15,   3360,    8, 'Shared physical line with DEF 1*2.5 — DEF only.'),

  ('TOTES',      'Totes (Line 6)',          'Line 6',      'tote',
   90,    22500,   72,   18040,   9, 'Dedicated tote filling line.')

ON CONFLICT (line_key) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      parent_line = EXCLUDED.parent_line,
      package_category = EXCLUDED.package_category,
      max_pallets_per_day = EXCLUDED.max_pallets_per_day,
      max_gallons_per_day = EXCLUDED.max_gallons_per_day,
      target_pallets_per_day = EXCLUDED.target_pallets_per_day,
      target_gallons_per_day = EXCLUDED.target_gallons_per_day,
      sort_order = EXCLUDED.sort_order,
      notes = EXCLUDED.notes,
      updated_at = NOW();

COMMIT;
