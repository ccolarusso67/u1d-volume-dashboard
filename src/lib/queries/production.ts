import { query, queryOne } from "../db";

// ----------------------------------------------------------------------------
// Production lines catalog
// ----------------------------------------------------------------------------

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
      max_gallons_per_day::float8 AS max_gallons_per_day,
      target_gallons_per_day::float8 AS target_gallons_per_day,
      sort_order
    FROM u1d_ops.production_lines
    WHERE is_active = TRUE
    ORDER BY sort_order
  `);
}

// ----------------------------------------------------------------------------
// Monthly production rollup per line
// ----------------------------------------------------------------------------

export type ProductionMonthlyByLine = {
  period_year: number;
  period_month: number;
  line_key: string;
  display_name: string;
  parent_line: string;
  gallons: number;
  pallets: number;
  working_days: number;
  avg_daily_gallons: number;
  peak_daily_gallons: number;
  utilization_vs_target: number | null;
};

export async function getProductionByLineForMonth(
  year: number,
  month: number
): Promise<ProductionMonthlyByLine[]> {
  return query<ProductionMonthlyByLine>(
    `
    SELECT
      period_year::int            AS period_year,
      period_month::int           AS period_month,
      line_key,
      display_name,
      parent_line,
      gallons::float8             AS gallons,
      pallets::float8             AS pallets,
      working_days::int           AS working_days,
      avg_daily_gallons::float8   AS avg_daily_gallons,
      peak_daily_gallons::float8  AS peak_daily_gallons,
      utilization_vs_target::float8 AS utilization_vs_target
    FROM u1d_ops.mv_production_monthly mv
    JOIN u1d_ops.production_lines pl USING (line_key)
    WHERE period_year = $1 AND period_month = $2
    ORDER BY pl.sort_order
  `,
    [year, month]
  );
}

// ----------------------------------------------------------------------------
// Latest month with production data
// ----------------------------------------------------------------------------

export type LatestProductionMonth = {
  period_year: number;
  period_month: number;
  total_gallons: number;
  working_days: number;
};

export async function getLatestProductionMonth(): Promise<LatestProductionMonth | null> {
  return queryOne<LatestProductionMonth>(`
    SELECT
      period_year::int    AS period_year,
      period_month::int   AS period_month,
      SUM(gallons)::float8 AS total_gallons,
      MAX(working_days)::int AS working_days
    FROM u1d_ops.mv_production_monthly
    GROUP BY period_year, period_month
    ORDER BY period_year DESC, period_month DESC
    LIMIT 1
  `);
}

// ----------------------------------------------------------------------------
// Reconciliation (produced vs billed) — all periods
// ----------------------------------------------------------------------------

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
      period_year::int                          AS period_year,
      period_month::int                         AS period_month,
      produced_gallons::float8                  AS produced_gallons,
      billed_gallons::float8                    AS billed_gallons,
      inventory_delta_gallons::float8           AS inventory_delta_gallons,
      inventory_delta_pct::float8               AS inventory_delta_pct,
      working_days::int                         AS working_days
    FROM u1d_ops.mv_volume_reconciliation
    ORDER BY period_year DESC, period_month DESC
  `);
}
