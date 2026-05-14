import { query, queryOne } from "../db";

export type MonthlyKPI = {
  period_year: number;
  period_month: number;
  total_gallons: number;
  ultrachem_gallons: number;
  external_gallons: number;
  active_customers: number;
};

export type CustomerMonth = {
  customer_key: string;
  display_name: string;
  gallons: number;
};

const KPI_SELECT = `
  period_year::int            AS period_year,
  period_month::int           AS period_month,
  total_gallons::float8       AS total_gallons,
  ultrachem_gallons::float8   AS ultrachem_gallons,
  external_gallons::float8    AS external_gallons,
  active_customers::int       AS active_customers
`;

export async function getLatestMonth(): Promise<MonthlyKPI | null> {
  return queryOne<MonthlyKPI>(`
    SELECT ${KPI_SELECT}
    FROM u1d_ops.mv_monthly_totals
    ORDER BY period_year DESC, period_month DESC
    LIMIT 1
  `);
}

export async function getMonth(
  year: number,
  month: number
): Promise<MonthlyKPI | null> {
  return queryOne<MonthlyKPI>(
    `
    SELECT ${KPI_SELECT}
    FROM u1d_ops.mv_monthly_totals
    WHERE period_year = $1 AND period_month = $2
  `,
    [year, month]
  );
}

export async function getRecentMonths(n: number): Promise<MonthlyKPI[]> {
  return query<MonthlyKPI>(
    `
    SELECT ${KPI_SELECT}
    FROM u1d_ops.mv_monthly_totals
    ORDER BY period_year DESC, period_month DESC
    LIMIT $1
  `,
    [n]
  );
}

export async function getMonthByCustomer(
  year: number,
  month: number
): Promise<CustomerMonth[]> {
  return query<CustomerMonth>(
    `
    SELECT
      vf.customer_key,
      c.display_name,
      SUM(vf.gallons)::float8 AS gallons
    FROM u1d_ops.volume_fact vf
    JOIN u1d_ops.customers c ON c.customer_key = vf.customer_key
    WHERE vf.period_year = $1 AND vf.period_month = $2
    GROUP BY vf.customer_key, c.display_name
    ORDER BY gallons DESC
  `,
    [year, month]
  );
}
