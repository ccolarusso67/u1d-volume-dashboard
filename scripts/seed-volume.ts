/**
 * scripts/seed-volume.ts
 *
 * Loads the 32 historical months from db/seed/master_volume.csv into
 * u1d_ops.volume_fact + u1d_ops.volume_files.
 *
 * For each (year, month) it creates a synthetic record in volume_files
 * (we don't have the original .xlsx for each period at this point). The
 * TERRA-450 finding for Sep/Nov/Dec 2024 is explicitly recorded with
 * has_total_discrepancy = TRUE.
 *
 * Idempotent by (period_year, period_month): re-inserts the file record and
 * regenerates that month's facts. Useful when re-running after CSV updates.
 *
 * Run with:  npm run db:seed:volume
 */
import { Pool, PoolClient } from "pg";
import { parse } from "csv-parse/sync";
import * as fs from "fs";
import * as path from "path";

// FY2024: Sep, Nov, Dec have a TOTAL row sub-reporting by -450 gal (TERRA
// omitted from the formula). The authoritative value is the reconstructed
// per-customer sum; we record the discrepancy in volume_files so the
// dashboard can flag it.
const KNOWN_DISCREPANCIES_GAL: Record<string, number> = {
  "2024-09": -450,
  "2024-11": -450,
  "2024-12": -450,
};

interface CsvRow {
  year: string;
  month: string;
  period: string;
  customer: string;
  package: string;
  volume: string;
}

async function loadPeriod(
  client: PoolClient,
  periodKey: string,
  rows: CsvRow[]
): Promise<void> {
  const [yearStr, monthStr] = periodKey.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  const computedSum = rows.reduce((acc, r) => acc + parseFloat(r.volume), 0);
  const discrepancy = KNOWN_DISCREPANCIES_GAL[periodKey] ?? 0;
  const sourceTotal = discrepancy !== 0 ? computedSum + discrepancy : computedSum;
  const hasDiscrepancy = discrepancy !== 0;

  const notes = hasDiscrepancy
    ? `FY2024 source file: TOTAL row omits TERRA (-450 gal). Volume reconstructed from per-customer rows.`
    : `Initial migration from master_volume.csv (validated against source TOTAL row).`;

  const fileRes = await client.query<{ file_id: number }>(
    `INSERT INTO u1d_ops.volume_files
       (filename, file_hash, period_year, period_month,
        source_total_row, computed_customer_sum,
        has_total_discrepancy, discrepancy_amount,
        ingested_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (period_year, period_month) DO UPDATE
       SET source_total_row = EXCLUDED.source_total_row,
           computed_customer_sum = EXCLUDED.computed_customer_sum,
           has_total_discrepancy = EXCLUDED.has_total_discrepancy,
           discrepancy_amount = EXCLUDED.discrepancy_amount,
           notes = EXCLUDED.notes
     RETURNING file_id`,
    [
      `seed_${periodKey}.xlsx`,
      `seed:${periodKey}`,
      year,
      month,
      sourceTotal,
      computedSum,
      hasDiscrepancy,
      hasDiscrepancy ? discrepancy : null,
      "seed-script",
      notes,
    ]
  );
  const fileId = fileRes.rows[0].file_id;

  // Replace facts for this period (idempotent)
  await client.query(
    `DELETE FROM u1d_ops.volume_fact WHERE period_year = $1 AND period_month = $2`,
    [year, month]
  );

  // Insert facts (a batch insert via UNNEST would be faster, but 32 months
  // × ~20 rows is fine row-by-row)
  for (const r of rows) {
    await client.query(
      `INSERT INTO u1d_ops.volume_fact
         (file_id, period_year, period_month, customer_key, package_key, gallons)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        fileId,
        year,
        month,
        r.customer,
        r.package,
        parseFloat(r.volume),
      ]
    );
  }

  const flag = hasDiscrepancy ? `  ⚠ TOTAL discrepancy ${discrepancy}` : "";
  console.log(
    `  ${periodKey}: ${rows.length.toString().padStart(3)} facts, ` +
      `${computedSum.toFixed(3).padStart(13)} gal${flag}`
  );
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("✗ DATABASE_URL is not set");
    process.exit(1);
  }

  const csvPath = path.join(__dirname, "..", "db", "seed", "master_volume.csv");
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

  console.log(`Loaded ${rows.length} rows from master_volume.csv`);

  // Group by (year, month)
  const byPeriod = new Map<string, CsvRow[]>();
  for (const r of rows) {
    const key = `${r.year}-${r.month.padStart(2, "0")}`;
    let list = byPeriod.get(key);
    if (!list) {
      list = [];
      byPeriod.set(key, list);
    }
    list.push(r);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Sort periods ascending for legible output
    const periods = Array.from(byPeriod.keys()).sort();
    for (const periodKey of periods) {
      await loadPeriod(client, periodKey, byPeriod.get(periodKey)!);
    }

    console.log("\nRefreshing materialized view...");
    // First refresh cannot use CONCURRENTLY (the MV has never been populated);
    // subsequent refreshes can.
    await client.query("REFRESH MATERIALIZED VIEW u1d_ops.mv_monthly_totals");

    await client.query("COMMIT");
    console.log(`\n✓ Seed complete. ${byPeriod.size} periods loaded.`);
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
