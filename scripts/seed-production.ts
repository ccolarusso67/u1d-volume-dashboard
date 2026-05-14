/**
 * scripts/seed-production.ts
 *
 * Loads daily production data from db/seed/production_daily.csv into
 * u1d_ops.production_daily + u1d_ops.production_files.
 *
 * The source CSV was extracted from the 2025 and 2026 annual production
 * control workbooks (the PRODUCCION DIARIA sheet). For each (file_year)
 * a single row is created in production_files; all daily facts under it
 * get a foreign key to that file.
 *
 * Idempotent by (production_date, line_key): re-running this script
 * upserts all rows.
 *
 * Run with:  npm run db:seed:production
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

  // Group by year for file registry + summary
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

  const pool = new Pool({ connectionString: databaseUrl });
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

    // Clear and re-insert all production_daily (idempotent path)
    await client.query(`TRUNCATE u1d_ops.production_daily`);

    let inserted = 0;
    for (const r of rows) {
      const year = parseInt(r.production_date.slice(0, 4), 10);
      const fileId = yearFileIds.get(year)!;
      await client.query(
        `INSERT INTO u1d_ops.production_daily
           (production_date, line_key, gallons, pallets, file_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          r.production_date,
          r.line_key,
          parseFloat(r.gallons),
          parseFloat(r.pallets),
          fileId,
        ]
      );
      inserted++;
    }
    console.log(`\nInserted ${inserted} daily fact rows`);

    console.log("\nRefreshing materialized views...");
    // First refresh — not CONCURRENTLY (views may be empty)
    await client.query(
      `REFRESH MATERIALIZED VIEW u1d_ops.mv_monthly_totals`
    );
    await client.query(
      `REFRESH MATERIALIZED VIEW u1d_ops.mv_production_monthly`
    );
    await client.query(
      `REFRESH MATERIALIZED VIEW u1d_ops.mv_volume_reconciliation`
    );

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
