/**
 * scripts/seed-production.ts
 *
 * Loads daily production data from db/seed/production_daily.csv into
 * u1d_ops.production_daily + u1d_ops.production_files.
 *
 * Uses a single UNNEST batch insert for all rows — one network round-trip
 * instead of one per row, ~60x faster over the public proxy.
 */
import { Pool, PoolClient } from "pg";
import { parse } from "csv-parse/sync";
import * as fs from "fs";
import * as path from "path";

interface CsvRow {
  production_date: string;
  line_key: string;
  gallons: string;
  pallets: string;
}

async function ensureFileRecord(
  client: PoolClient,
  year: number,
  rowCount: number,
  workingDays: number,
  totalGallons: number
): Promise<number> {
  const filename = `${year}_MERCHANDISE_PRODUCTION_CONTROL.xlsx`;
  const res = await client.query<{ file_id: number }>(
    `INSERT INTO u1d_ops.production_files
       (filename, file_hash, file_year, rows_loaded, working_days,
        total_gallons, ingested_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (file_year) DO UPDATE
       SET filename = EXCLUDED.filename,
           rows_loaded = EXCLUDED.rows_loaded,
           working_days = EXCLUDED.working_days,
           total_gallons = EXCLUDED.total_gallons,
           ingested_at = NOW(),
           notes = EXCLUDED.notes
     RETURNING file_id`,
    [
      filename,
      `seed:${year}`,
      year,
      rowCount,
      workingDays,
      totalGallons,
      "seed-script",
      "Initial migration from PRODUCCION DIARIA sheet of the annual workbook.",
    ]
  );
  return res.rows[0].file_id;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("✗ DATABASE_URL is not set");
    process.exit(1);
  }

  const csvPath = path.join(__dirname, "..", "db", "seed", "production_daily.csv");
  if (!fs.existsSync(csvPath)) {
    console.error(`✗ Path not found: ${csvPath}`);
    process.exit(1);
  }

  const csvText = fs.readFileSync(csvPath, "utf8");
  const rows = parse(csvText, {
    columns: true,
    trim: true,
    skip_empty_lines: true,
  }) as CsvRow[];

  console.log(`Loaded ${rows.length} rows from production_daily.csv`);

  const byYear = new Map<number, CsvRow[]>();
  for (const r of rows) {
    const year = parseInt(r.production_date.slice(0, 4), 10);
    let list = byYear.get(year);
    if (!list) {
      list = [];
      byYear.set(year, list);
    }
    list.push(r);
  }

  const useSsl = /rlwy\.net|railway\.app|[?&]sslmode=/.test(databaseUrl);
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const yearFileIds = new Map<number, number>();
    for (const [year, yearRows] of Array.from(byYear.entries()).sort(
      (a, b) => a[0] - b[0]
    )) {
      const workingDays = new Set(yearRows.map((r) => r.production_date)).size;
      const totalGallons = yearRows.reduce(
        (acc, r) => acc + parseFloat(r.gallons),
        0
      );
      const fileId = await ensureFileRecord(
        client,
        year,
        yearRows.length,
        workingDays,
        totalGallons
      );
      yearFileIds.set(year, fileId);
      console.log(
        `  ${year}: ${yearRows.length.toString().padStart(4)} rows, ` +
          `${workingDays.toString().padStart(3)} working days, ` +
          `${totalGallons.toFixed(0).padStart(12)} gal (file_id=${fileId})`
      );
    }

    // TRUNCATE + batch INSERT via UNNEST — one network round-trip for all rows
    await client.query(`TRUNCATE u1d_ops.production_daily`);

    const dates: string[] = [];
    const lineKeys: string[] = [];
    const gallonsArr: number[] = [];
    const palletsArr: number[] = [];
    const fileIdsArr: number[] = [];

    for (const r of rows) {
      const year = parseInt(r.production_date.slice(0, 4), 10);
      dates.push(r.production_date);
      lineKeys.push(r.line_key);
      gallonsArr.push(parseFloat(r.gallons));
      palletsArr.push(parseFloat(r.pallets));
      fileIdsArr.push(yearFileIds.get(year)!);
    }

    const insertRes = await client.query(
      `INSERT INTO u1d_ops.production_daily
         (production_date, line_key, gallons, pallets, file_id)
       SELECT * FROM UNNEST(
         $1::date[],
         $2::text[],
         $3::numeric[],
         $4::numeric[],
         $5::bigint[]
       )`,
      [dates, lineKeys, gallonsArr, palletsArr, fileIdsArr]
    );
    console.log(
      `\nInserted ${insertRes.rowCount} daily fact rows in a single batch`
    );

    console.log("\nRefreshing materialized views...");
    await client.query(`REFRESH MATERIALIZED VIEW u1d_ops.mv_monthly_totals`);
    await client.query(`REFRESH MATERIALIZED VIEW u1d_ops.mv_production_monthly`);
    await client.query(`REFRESH MATERIALIZED VIEW u1d_ops.mv_volume_reconciliation`);

    await client.query("COMMIT");
    console.log(`\n✓ Seed complete. ${byYear.size} years loaded.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n✗ Seed error (rollback applied):");
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
