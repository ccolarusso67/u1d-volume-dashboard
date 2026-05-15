import { query, queryOne } from "../db";

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
      FROM u1d_ops.volume_fact WHERE period_year = $1 AND period_month = $2
      GROUP BY customer_key) curr USING (customer_key)
    LEFT JOIN (SELECT customer_key, SUM(gallons) AS gallons
      FROM u1d_ops.volume_fact WHERE period_year = $1 - 1 AND period_month = $2
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
      FROM u1d_ops.volume_fact
      WHERE period_year = $1 AND period_month = $2
    )
    SELECT
      p.package_key, p.display_name, p.family,
      SUM(vf.gallons)::float8 AS gallons,
      (SUM(vf.gallons) / (SELECT total FROM month_total))::float8 AS pct_of_month
    FROM u1d_ops.volume_fact vf
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
      FROM u1d_ops.volume_fact WHERE period_year = $1 AND period_month = $2
      GROUP BY package_key) curr USING (package_key)
    LEFT JOIN (SELECT package_key, SUM(gallons) AS gallons
      FROM u1d_ops.volume_fact WHERE period_year = $1 - 1 AND period_month = $2
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
      COALESCE((SELECT SUM(gallons) FROM u1d_ops.volume_fact
        WHERE period_year = $1 AND period_month <= $2), 0)::float8 AS current_ytd,
      COALESCE((SELECT SUM(gallons) FROM u1d_ops.volume_fact
        WHERE period_year = $1 - 1 AND period_month <= $2), 0)::float8 AS prior_ytd,
      CASE WHEN COALESCE((SELECT SUM(gallons) FROM u1d_ops.volume_fact
        WHERE period_year = $1 - 1 AND period_month <= $2), 0) > 0
      THEN (
        (COALESCE((SELECT SUM(gallons) FROM u1d_ops.volume_fact
          WHERE period_year = $1 AND period_month <= $2), 0) -
         COALESCE((SELECT SUM(gallons) FROM u1d_ops.volume_fact
          WHERE period_year = $1 - 1 AND period_month <= $2), 0)) /
        COALESCE((SELECT SUM(gallons) FROM u1d_ops.volume_fact
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
  category: string;
  gallons: number;
};

export async function getMonthlyCategoryTrend(n: number): Promise<CategoryTrendRow[]> {
  return query<CategoryTrendRow>(
    `
    SELECT
      vf.period_year::int  AS period_year,
      vf.period_month::int AS period_month,
      CASE
        WHEN p.package_key IN ('PAIL OIL', 'DRUM OIL', 'TOTE OIL', 'BULK OIL') THEN 'Heavy Oil'
        WHEN p.package_key IN ('LITER OIL', 'GAL OIL', 'JUG OIL', 'JERRYCAN OIL', 'BOX OIL') THEN 'Light Oil'
        WHEN p.family = 'COOL' THEN 'Coolant'
        WHEN p.family = 'WW'   THEN 'WW'
        WHEN p.family = 'DEF'  THEN 'DEF'
        ELSE 'Other'
      END AS category,
      SUM(vf.gallons)::float8 AS gallons
    FROM u1d_ops.volume_fact vf
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
