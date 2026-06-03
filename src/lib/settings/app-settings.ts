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
