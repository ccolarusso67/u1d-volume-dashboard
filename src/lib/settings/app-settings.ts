/**
 * src/lib/settings/app-settings.ts
 *
 * Key/value app settings (u1d_ops.app_settings). Currently powers the
 * editable daily volume target used by the monthly volume goal.
 */
import { query, queryOne } from "@/lib/db";

const DAILY_TARGET_KEY = "volume_daily_target_gallons";
export const DEFAULT_DAILY_TARGET = 7000;

export async function getDailyTargetGallons(): Promise<number> {
  const row = await queryOne<{ value: string }>(
    `SELECT value FROM u1d_ops.app_settings WHERE key = $1`,
    [DAILY_TARGET_KEY]
  );
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_TARGET;
}

export async function setDailyTargetGallons(n: number, updatedBy?: string): Promise<void> {
  if (!Number.isFinite(n) || n <= 0) throw new Error("daily target must be a positive number");
  await query(
    `INSERT INTO u1d_ops.app_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [DAILY_TARGET_KEY, String(Math.round(n)), updatedBy ?? null]
  );
}

// ---------------------------------------------------------------------------
// Per-line conversion cost ($/gallon) — powers the fully-loaded (Version B)
// filling-line margin. Stored as one JSON blob keyed by parent line so adding
// a line never needs a migration. A missing/zero rate means "not set" and the
// line shows contribution-only margin until a rate is entered.
// ---------------------------------------------------------------------------

const LINE_CONV_KEY = "line_conversion_cost_per_gal";

/** Parent lines that can carry a conversion rate. Mirrors production_lines.parent_line. */
export const CONVERSION_LINE_KEYS = ["Line 1", "Line 2", "Line 3", "Line 4", "Line 5", "Line 6"] as const;

export async function getLineConversionRates(): Promise<Record<string, number>> {
  const row = await queryOne<{ value: string }>(
    `SELECT value FROM u1d_ops.app_settings WHERE key = $1`,
    [LINE_CONV_KEY]
  );
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.value) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const k of CONVERSION_LINE_KEYS) {
      const v = Number(parsed?.[k]);
      if (Number.isFinite(v) && v > 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export async function setLineConversionRates(
  rates: Record<string, number | string | null | undefined>,
  updatedBy?: string
): Promise<void> {
  const clean: Record<string, number> = {};
  for (const k of CONVERSION_LINE_KEYS) {
    const v = Number(rates?.[k]);
    if (Number.isFinite(v) && v > 0) clean[k] = v;
  }
  await query(
    `INSERT INTO u1d_ops.app_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [LINE_CONV_KEY, JSON.stringify(clean), updatedBy ?? null]
  );
}
