/**
 * src/lib/queries/volume-goal.ts
 *
 * Monthly volume goal = working_days * daily_target (editable; default 7000).
 * Delta is measured against billed volume (the headline volume number).
 * Shared by the board page, the main dashboard, and the deck so all three agree.
 */
import { query } from "@/lib/db";
import { getDailyTargetGallons } from "@/lib/settings/app-settings";

export type VolumeGoal = {
  period_year: number;
  period_month: number;
  working_days: number | null;
  daily_target: number;
  goal_gallons: number | null; // working_days * daily_target
  billed_gallons: number | null; // actual volume compared to the goal
  produced_gallons: number | null;
  delta_gallons: number | null; // billed - goal  (negative = below goal)
  delta_pct: number | null; // delta / goal
  met: boolean | null; // billed >= goal
};

type Row = {
  working_days: number | null;
  billed_gallons: number | null;
  produced_gallons: number | null;
};

function compute(year: number, month: number, daily: number, r: Row | undefined): VolumeGoal {
  const wd = r?.working_days ?? null;
  const billed = r?.billed_gallons ?? null;
  const produced = r?.produced_gallons ?? null;
  const goal = wd !== null ? wd * daily : null;
  const delta = goal !== null && billed !== null ? billed - goal : null;
  const deltaPct = delta !== null && goal && goal > 0 ? delta / goal : null;
  const met = goal !== null && billed !== null ? billed >= goal : null;
  return {
    period_year: year,
    period_month: month,
    working_days: wd,
    daily_target: daily,
    goal_gallons: goal,
    billed_gallons: billed,
    produced_gallons: produced,
    delta_gallons: delta,
    delta_pct: deltaPct,
    met,
  };
}

/** Goal for a single period. */
export async function getVolumeGoal(year: number, month: number): Promise<VolumeGoal> {
  const daily = await getDailyTargetGallons();
  const rows = await query<Row>(
    `SELECT working_days::int AS working_days,
            billed_gallons::float8 AS billed_gallons,
            produced_gallons::float8 AS produced_gallons
       FROM u1d_ops.mv_volume_reconciliation
      WHERE period_year = $1 AND period_month = $2
      LIMIT 1`,
    [year, month]
  );
  return compute(year, month, daily, rows[0]);
}
