/**
 * scripts/migrate.ts
 *
 * Applies all .sql files in db/migrations/ in alphabetical order.
 * Tracks applied migrations in u1d_ops.schema_migrations.
 *
 * Run with:  npm run db:migrate
 */
import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("✗ DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const migrationsDir = path.join(__dirname, "..", "db", "migrations");

  if (!fs.existsSync(migrationsDir)) {
    console.error(`✗ Path not found: ${migrationsDir}`);
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    // Bootstrap: create the schema and the tracking table (idempotent)
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS u1d_ops;
      CREATE TABLE IF NOT EXISTS u1d_ops.schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      console.log("No migrations to apply.");
      return;
    }

    let applied = 0;
    let skipped = 0;

    for (const filename of files) {
      const { rows } = await client.query(
        "SELECT 1 FROM u1d_ops.schema_migrations WHERE filename = $1",
        [filename]
      );
      if (rows.length > 0) {
        console.log(`  skip   ${filename} (already applied)`);
        skipped++;
        continue;
      }

      const sqlPath = path.join(migrationsDir, filename);
      const sql = fs.readFileSync(sqlPath, "utf8");

      console.log(`  apply  ${filename}`);
      await client.query(sql);
      await client.query(
        "INSERT INTO u1d_ops.schema_migrations (filename) VALUES ($1)",
        [filename]
      );
      applied++;
    }

    console.log(
      `\n✓ Migrations complete. Applied: ${applied}, skipped: ${skipped}.`
    );
  } catch (err) {
    console.error("\n✗ Error applying migrations:");
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
