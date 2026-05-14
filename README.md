# u1d-volume-dashboard

Monthly operations dashboard for U1Dynamics Manufacturing LLC.

Phases 1 and 1.6 delivered:

- **Volume domain**: 32 validated months of billed volume (Jan 2023 → Mar 2026) by customer × package, with the TERRA-450 quality flag captured for Sep/Nov/Dec 2024.
- **Production domain**: 1,595 daily line-rows across 303 working days (Mar 2025 → May 2026) covering 9 production lines, joined to installed and 80% planning capacity per line.
- **Three pages**: `/` overview, `/production` per-line utilization, `/reconciliation` produced-vs-billed per period (surfaces inventory build/burn dynamics).

## Stack

- **Next.js 15** (App Router, Server Components, TypeScript)
- **PostgreSQL** — schema `u1d_ops` inside the Railway instance shared with `ultra1plus-pricing-core`
- **Tailwind CSS** with navy/red branding and Georgia/Calibri typography (matches the board deck)
- **ExcelJS** for parsing monthly `U1DYNAMICS_VOLUME_*.xlsx` files

## Local setup

```bash
# 1. Clone and install
git clone git@github.com:ccolarusso67/u1d-volume-dashboard.git
cd u1d-volume-dashboard
npm install

# 2. Configure env
cp .env.example .env
# Edit .env and set DATABASE_URL (Railway, or a local Postgres with the
# u1d_ops schema available)

# 3. Apply schema + load the 32 seed months
npm run db:setup

# 4. Run the dev server
npm run dev
# → http://localhost:3000
```

The first `db:setup` runs the migrations and then loads all 32 periods, flagging the three FY2024 files (Sep, Nov, Dec) where the source TOTAL row sub-reports by exactly 450 gal (TERRA omitted from the source spreadsheet's TOTAL formula).

## Deploy to Railway

```bash
git remote add origin git@github.com:ccolarusso67/u1d-volume-dashboard.git
git push -u origin main
```

In Railway:

1. New Service → Deploy from GitHub repo → select `u1d-volume-dashboard`.
2. Set `DATABASE_URL` env var pointing to the same Postgres instance that hosts `ultra1plus-pricing-core`.
3. After the first deploy, run once in the Railway shell:
   ```bash
   npm run db:setup
   ```
4. Point `dashboard.u1dynamics.com` (CNAME) at the service's public URL.

## Repo layout

```
db/
  migrations/
    001_create_schema.sql              u1d_ops schema, volume tables/indexes, mv_monthly_totals
    002_seed_catalogs.sql              5 customers, 21 packages, 2 admin users
    003_create_production_schema.sql   production_lines / production_daily / production_files,
                                       mv_production_monthly, mv_volume_reconciliation
    004_seed_production_lines.sql      9 production lines with installed and 80% capacity
  seed/
    master_volume.csv                  32 validated billing months (Jan 2023 → Mar 2026)
    production_daily.csv               1,595 daily line-rows across 303 working days
                                       (Mar 2025 → May 2026)

scripts/
  migrate.ts                           Applies .sql in order, tracks u1d_ops.schema_migrations
  seed-volume.ts                       Loads master_volume.csv → volume_fact + volume_files
  seed-production.ts                   Loads production_daily.csv → production_daily +
                                       production_files; refreshes all materialized views

src/
  app/
    layout.tsx
    page.tsx                           "/" — overview dashboard (4 KPIs + tables)
    production/page.tsx                "/production" — per-line utilization + capacity ref
    reconciliation/page.tsx            "/reconciliation" — produced vs billed per period
    globals.css
  components/
    kpi-tile.tsx
    nav.tsx                            Top nav shared across pages
  lib/
    db.ts
    brand.ts                           en-US defaults, es-ES available
    parser/
      month-tokens.ts
      volume-parser.ts                 .xlsx parser (TS port of validated Python)
    queries/
      monthly.ts                       Volume queries
      production.ts                    Production + reconciliation queries
```

## Data model

Tables in `u1d_ops`:

- **`customers`** — catalog, 5 rows
- **`packages`** — catalog, 21 rows (4 families: oil / coolant / washer_fluid / def)
- **`users`** — allowlist for NextAuth (Phase 1.5)
- **`volume_files`** — one row per ingested file, with hash, `source_total_row`, `computed_customer_sum`, and `has_total_discrepancy` flag
- **`volume_fact`** — the fact table; unique on `(period_year, period_month, customer_key, package_key)`

Materialized view:

- **`mv_monthly_totals`** — per-period aggregate with totals, ULTRACHEM vs external split, and active-customer count. Call `u1d_ops.refresh_views()` after every ingest.

## Quality validation

The parser and seed automatically flag rows where the source file's TOTAL row does not match the reconstructed per-customer sum. For the 32 seed months:

- 29 files validate cleanly (no discrepancy)
- 3 files (Sep 2024, Nov 2024, Dec 2024) have `has_total_discrepancy = TRUE` with `discrepancy_amount = -450` (TERRA omitted from the TOTAL formula in the source)

The dashboard always uses the reconstructed sum (values in `volume_fact`), never the source TOTAL row.

For the production side: the seed extracts dates strictly matching the file's year (one stray Dec-2026 row in the 2025 file and one stray Dec-2025 row in the 2026 file are filtered out). Rows where all 9 line values are zero are dropped to avoid placeholder header rows in upcoming months from polluting the data. Pre-computed efficiency columns in the source are ignored — utilization is derived in the MV from `gallons / (target × working_days)` so the math stays auditable.

## Roadmap

- **Phase 1** (done): volume schema + seed + landing dashboard against DB
- **Phase 1.6** (done): production schema + capacity catalog + per-line and reconciliation pages
- **Phase 1.5**: NextAuth + Google OAuth, allowlist against `u1d_ops.users`, `/admin/upload` page with two modes — monthly volume upload and annual production replace
- **Phase 2**: drill-downs `/customer/[key]` and `/package/[key]`, charts (recharts), filters, period-matched YoY page, PDF export of the monthly board deck from live data
- **Phase 3**: auto-pull from SharePoint/Teams via Microsoft Graph API + Railway cron — one path for the monthly SUMMARY files, one for the annual MERCHANDISE_PRODUCTION_CONTROL files
- **Phase 4**: MCP server `u1d-volume-mcp` exposing volume + production tools for Claude Desktop, hosted at `mcp.u1dynamics.com`

## Maintenance notes

- Email addresses in `002_seed_catalogs.sql` use `carmine.colarusso@ultra1plus.com` and `eugenio.piratelli@ultra1plus.com` — confirm/adjust before the first deploy if your real addresses differ.
- The first `REFRESH MATERIALIZED VIEW` must run without `CONCURRENTLY` (the view is empty on first creation). The seed script handles this. Subsequent refreshes use `CONCURRENTLY` to avoid blocking reads.
- The parser assumes the SUMMARY sheet format validated against the 32 files. If the format changes (columns moved, new packages), update `volume-parser.ts` and add a migration to insert new `package_key` rows into `u1d_ops.packages`.
- Board-deck delivery (the `.pptx` for the board of directors) is generated by a separate workflow and stays in Spanish, while this dashboard and all infrastructure run in English.
