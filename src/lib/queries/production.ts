import { query, queryOne } from "../db";

export type ProductionLine = {
  line_key: string;
  display_name: string;
  parent_line: string;
  package_category: string;
  max_gallons_per_day: number;
  target_gallons_per_day: number;
  sort_order: number;
};

export async function getProductionLines(): Promise<ProductionLine[]> {
  return query<ProductionLine>(`
    SELECT
      line_key,
      display_name,
      parent_line,
      package_category,
      max_gallons_per_day::float8    AS max_gallons_per_day,
      target_gallons_per_day::float8 AS target_gallons_per_day,
      sort_order
    FROM u1d_ops.production_lines
    WHERE is_active = TRUE
    ORDER BY sort_order
  `);
}

/**
 * One row per production line for the given month — including lines that
 * had zero production that month (LEFT JOIN). Lets the UI show idle lines.
 */
export type LineMonthRow = {
  line_key: string;
  display_name: string;
  parent_line: string;
  max_gallons_per_day: number;
  target_gallons_per_day: number;
  sort_order: number;
  working_days: number;
  gallons: number;
  pallets: number;
  avg_daily_gallons: number | null;
  peak_daily_gallons: number | null;
  utilization_vs_target: number | null;
};

export async function getAllLinesForMonth(
  year: number,
  month: number
): Promise<LineMonthRow[]> {
  return query<LineMonthRow>(
    `
    SELECT
      pl.line_key,
      pl.display_name,
      pl.parent_line,
      pl.max_gallons_per_day::float8    AS max_gallons_per_day,
      pl.target_gallons_per_day::float8 AS target_gallons_per_day,
      pl.sort_order,
      COALESCE(mv.working_days, 0)::int      AS working_days,
      COALESCE(mv.gallons, 0)::float8        AS gallons,
      COALESCE(mv.pallets, 0)::float8        AS pallets,
      mv.avg_daily_gallons::float8           AS avg_daily_gallons,
      mv.peak_daily_gallons::float8          AS peak_daily_gallons,
      mv.utilization_vs_target::float8       AS utilization_vs_target
    FROM u1d_ops.production_lines pl
    LEFT JOIN u1d_ops.mv_production_monthly mv
      ON mv.line_key = pl.line_key
     AND mv.period_year = $1
     AND mv.period_month = $2
    WHERE pl.is_active = TRUE
    ORDER BY pl.sort_order
  `,
    [year, month]
  );
}

export type LatestProductionMonth = {
  period_year: number;
  period_month: number;
  total_gallons: number;
  working_days: number;
};

export async function getLatestProductionMonth(): Promise<LatestProductionMonth | null> {
  return queryOne<LatestProductionMonth>(`
    SELECT
      period_year::int       AS period_year,
      period_month::int      AS period_month,
      SUM(gallons)::float8   AS total_gallons,
      MAX(working_days)::int AS working_days
    FROM u1d_ops.mv_production_monthly
    GROUP BY period_year, period_month
    ORDER BY period_year DESC, period_month DESC
    LIMIT 1
  `);
}

export type ReconciliationRow = {
  period_year: number;
  period_month: number;
  produced_gallons: number | null;
  billed_gallons: number | null;
  inventory_delta_gallons: number | null;
  inventory_delta_pct: number | null;
  working_days: number | null;
};

export async function getReconciliation(): Promise<ReconciliationRow[]> {
  return query<ReconciliationRow>(`
    SELECT
      period_year::int                AS period_year,
      period_month::int               AS period_month,
      produced_gallons::float8        AS produced_gallons,
      billed_gallons::float8          AS billed_gallons,
      inventory_delta_gallons::float8 AS inventory_delta_gallons,
      inventory_delta_pct::float8     AS inventory_delta_pct,
      working_days::int               AS working_days
    FROM u1d_ops.mv_volume_reconciliation
    ORDER BY period_year DESC, period_month DESC
  `);
}
