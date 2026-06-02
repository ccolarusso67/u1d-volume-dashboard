import { query, queryOne } from "../db";
import { CATEGORY_MAP, type PackageFamily, type CategoryLabel } from "./category";

// ---------------------------------------------------------------------------
// Active-version facts (BUG-REGISTER HIGH-2).
//
// After migration 005, volume_fact retains EVERY uploaded version's rows per
// period. Aggregating volume_fact directly double-counts superseded versions
// the moment a period has > 1 version. This subselect keeps only the active
// version per period — mirroring the filter the board path already uses.
// Drop-in replacement for `u1d_ops.volume_fact`; exposes the same columns, so
// downstream column references (gallons, customer_key, package_key,
// period_year, period_month) are unchanged. Switch to `f.locked_at IS NOT
// NULL` if a surface must be board-grade rather than operational.
// ---------------------------------------------------------------------------
const ACTIVE_VOLUME_FACT = `(
    SELECT vf.fact_id, vf.file_id, vf.period_year, vf.period_month,
           vf.customer_key, vf.package_key, vf.gallons
      FROM u1d_ops.volume_fact vf
      JOIN u1d_ops.volume_files f ON f.file_id = vf.file_id
     WHERE f.is_active = TRUE
  )`;

// Build the family -> category CASE from CATEGORY_MAP (BUG-REGISTER MEDIUM-2)
// so the SQL trend query and the TS categorizeFamily() helper share ONE
// definition and can never drift. Keys/values are hardcoded catalog enum
// tokens, never user input, so direct interpolation is safe.
function familyCategoryCaseSql(familyCol: string): string {
  const whens = (Object.keys(CATEGORY_MAP) as PackageFamily[])
    .map((fam) => `WHEN '${fam}' THEN '${CATEGORY_MAP[fam]}'`)
    .join("\n        ");
  return `CASE ${familyCol}\n        ${whens}\n        ELSE 'Other'\n      END`;
}

export type MonthlyKPI = {
  period_year: number;
  period_month: number;
  total_gallons: number;
  ultrachem_gallons: number;
  external_gallons: number;
  active_customers: number;
};

const KPI_SELECT = `
  period_year::int           AS period_year,
  period_month::int          AS period_month,
  total_gallons::float8      AS total_gallons,
  ultrachem_gallons::float8  AS ultrachem_gallons,
  external_gallons::float8   AS external_gallons,
  active_customers::int      AS active_customers
`;

export async function getLatestMonth(): Promise<MonthlyKPI | null> {
  return queryOne<MonthlyKPI>(`
    SELECT ${KPI_SELECT}
    FROM u1d_ops.mv_monthly_totals
    ORDER BY period_year DESC, period_month DESC
    LIMIT 1
  `);
}

export async function getMonth(year: number, month: number): Promise<MonthlyKPI | null> {
  return queryOne<MonthlyKPI>(
    `SELECT ${KPI_SELECT} FROM u1d_ops.mv_monthly_totals
     WHERE period_year = $1 AND period_month = $2`,
    [year, month]
  );
}

export async function getRecentMonths(n: number): Promise<MonthlyKPI[]> {
  return query<MonthlyKPI>(
    `SELECT ${KPI_SELECT} FROM u1d_ops.mv_monthly_totals
     ORDER BY period_year DESC, period_month DESC LIMIT $1`,
    [n]
  );
}

export type CustomerYoYRow = {
  customer_key: string;
  display_name: string;
  is_intercompany: boolean;
  current_gallons: number;
  prior_gallons: number;
  delta_gallons: number;
  delta_pct: number | null;
};

export async function getCustomerYoYForMonth(
  year: number,
  month: number
): Promise<CustomerYoYRow[]> {
  return query<CustomerYoYRow>(
    `
    SELECT
      c.customer_key, c.display_name, c.is_intercompany,
      COALESCE(curr.gallons, 0)::float8 AS current_gallons,
      COALESCE(prior.gallons, 0)::float8 AS prior_gallons,
      (COALESCE(curr.gallons, 0) - COALESCE(prior.gallons, 0))::float8 AS delta_gallons,
      CASE WHEN COALESCE(prior.gallons, 0) > 0
        THEN ((COALESCE(curr.gallons, 0) - prior.gallons) / prior.gallons)::float8
        ELSE NULL END AS delta_pct
    FROM u1d_ops.customers c
    LEFT JOIN (SELECT customer_key, SUM(gallons) AS gallons
      FROM ${ACTIVE_VOLUME_FACT} v WHERE period_year = $1 AND period_month = $2
      GROUP BY customer_key) curr USING (customer_key)
    LEFT JOIN (SELECT customer_key, SUM(gallons) AS gallons
      FROM ${ACTIVE_VOLUME_FACT} v WHERE period_year = $1 - 1 AND period_month = $2
      GROUP BY customer_key) prior USING (customer_key)
    WHERE COALESCE(curr.gallons, 0) > 0 OR COALESCE(prior.gallons, 0) > 0
    ORDER BY COALESCE(curr.gallons, 0) DESC
  `,
    [year, month]
  );
}

export type PackageMixRow = {
  package_key: string;
  display_name: string;
  family: string;
  gallons: number;
  pct_of_month: number;
};

export async function getPackageMixForMonth(
  year: number,
  month: number
): Promise<PackageMixRow[]> {
  return query<PackageMixRow>(
    `
    WITH month_total AS (
      SELECT NULLIF(SUM(gallons), 0)::float8 AS total
      FROM ${ACTIVE_VOLUME_FACT} v
      WHERE period_year = $1 AND period_month = $2
    )
    SELECT
      p.package_key, p.display_name, p.family,
      SUM(vf.gallons)::float8 AS gallons,
      (SUM(vf.gallons) / (SELECT total FROM month_total))::float8 AS pct_of_month
    FROM ${ACTIVE_VOLUME_FACT} vf
    JOIN u1d_ops.packages p USING (package_key)
    WHERE vf.period_year = $1 AND vf.period_month = $2
    GROUP BY p.package_key, p.display_name, p.family
    ORDER BY gallons DESC
  `,
    [year, month]
  );
}

export type PackageYoYRow = {
  package_key: string;
  display_name: string;
  current_gallons: number;
  prior_gallons: number;
  delta_gallons: number;
  delta_pct: number | null;
};

export async function getPackageYoYForMonth(
  year: number,
  month: number
): Promise<PackageYoYRow[]> {
  return query<PackageYoYRow>(
    `
    SELECT
      p.package_key, p.display_name,
      COALESCE(curr.gallons, 0)::float8 AS current_gallons,
      COALESCE(prior.gallons, 0)::float8 AS prior_gallons,
      (COALESCE(curr.gallons, 0) - COALESCE(prior.gallons, 0))::float8 AS delta_gallons,
      CASE WHEN COALESCE(prior.gallons, 0) > 0
        THEN ((COALESCE(curr.gallons, 0) - prior.gallons) / prior.gallons)::float8
        ELSE NULL END AS delta_pct
    FROM u1d_ops.packages p
    LEFT JOIN (SELECT package_key, SUM(gallons) AS gallons
      FROM ${ACTIVE_VOLUME_FACT} v WHERE period_year = $1 AND period_month = $2
      GROUP BY package_key) curr USING (package_key)
    LEFT JOIN (SELECT package_key, SUM(gallons) AS gallons
      FROM ${ACTIVE_VOLUME_FACT} v WHERE period_year = $1 - 1 AND period_month = $2
      GROUP BY package_key) prior USING (package_key)
    WHERE COALESCE(curr.gallons, 0) > 0 OR COALESCE(prior.gallons, 0) > 0
    ORDER BY delta_gallons DESC
  `,
    [year, month]
  );
}

export type YTDComparison = {
  current_ytd: number;
  prior_ytd: number;
  delta_pct: number | null;
};

export async function getYTDComparison(
  year: number,
  throughMonth: number
): Promise<YTDComparison> {
  const row = await queryOne<YTDComparison>(
    `
    SELECT
      COALESCE((SELECT SUM(gallons) FROM ${ACTIVE_VOLUME_FACT} v
        WHERE period_year = $1 AND period_month <= $2), 0)::float8 AS current_ytd,
      COALESCE((SELECT SUM(gallons) FROM ${ACTIVE_VOLUME_FACT} v
        WHERE period_year = $1 - 1 AND period_month <= $2), 0)::float8 AS prior_ytd,
      CASE WHEN COALESCE((SELECT SUM(gallons) FROM ${ACTIVE_VOLUME_FACT} v
        WHERE period_year = $1 - 1 AND period_month <= $2), 0) > 0
      THEN (
        (COALESCE((SELECT SUM(gallons) FROM ${ACTIVE_VOLUME_FACT} v
          WHERE period_year = $1 AND period_month <= $2), 0) -
         COALESCE((SELECT SUM(gallons) FROM ${ACTIVE_VOLUME_FACT} v
          WHERE period_year = $1 - 1 AND period_month <= $2), 0)) /
        COALESCE((SELECT SUM(gallons) FROM ${ACTIVE_VOLUME_FACT} v
          WHERE period_year = $1 - 1 AND period_month <= $2), 0)
      )::float8 ELSE NULL END AS delta_pct
  `,
    [year, throughMonth]
  );
  return row ?? { current_ytd: 0, prior_ytd: 0, delta_pct: null };
}

// ---------------------------------------------------------------------------
// 6-month category trend for the stacked bar chart
// ---------------------------------------------------------------------------

export type CategoryTrendRow = {
  period_year: number;
  period_month: number;
  category: CategoryLabel;
  gallons: number;
};

export async function getMonthlyCategoryTrend(n: number): Promise<CategoryTrendRow[]> {
  return query<CategoryTrendRow>(
    `
    SELECT
      vf.period_year::int  AS period_year,
      vf.period_month::int AS period_month,
      -- Generated from CATEGORY_MAP (single source of truth) via
      -- familyCategoryCaseSql() above, so SQL and TS cannot drift.
      ${familyCategoryCaseSql("p.family")} AS category,
      SUM(vf.gallons)::float8 AS gallons
    FROM ${ACTIVE_VOLUME_FACT} vf
    JOIN u1d_ops.packages p USING (package_key)
    WHERE (vf.period_year, vf.period_month) IN (
      SELECT period_year, period_month
      FROM u1d_ops.mv_monthly_totals
      ORDER BY period_year DESC, period_month DESC
      LIMIT $1
    )
    GROUP BY vf.period_year, vf.period_month, category
    ORDER BY vf.period_year, vf.period_month
    `,
    [n]
  );
}
