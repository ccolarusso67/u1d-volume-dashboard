# u1d-volume-dashboard

Monthly operations dashboard for U1Dynamics Manufacturing LLC.

Phases 1, 1.6, and (in progress) 1.7:

- **Volume domain**: 32 validated months of billed volume (Jan 2023 → Mar 2026) by customer × package, with the TERRA-450 quality flag captured for Sep/Nov/Dec 2024.
- **Production domain**: 1,595 daily line-rows across 303 working days (Mar 2025 → May 2026) covering 9 production lines, joined to installed and 80% planning capacity per line.
- **Three pages**: `/` overview, `/production` per-line utilization, `/reconciliation` produced-vs-billed per period (surfaces inventory build/burn dynamics).
- **Phase 1.7 (in progress)**: monthly close workflow with admin upload, file versioning, period lock, and operator notes — backed by Railway Volume for original Excel storage.

## Stack

- **Next.js 15** (App Router, Server Components, TypeScript)
- **PostgreSQL** — schema `u1d_ops` inside the Railway instance shared with `ultra1plus-pricing-core`
- **Railway Volume** — original Excel file storage (Phase 1.7)
- **Tailwind CSS** with navy/red branding and Georgia/Calibri typography (matches the board deck)
- **ExcelJS** for parsing monthly `U1DYNAMICS_VOLUME_*.xlsx` files

## Storage (Phase 1.7)

Phase 1.7 uses **Railway Volume** for original Excel file storage. No S3, R2, or SharePoint at this phase — the architecture is intentionally minimal until volume justifies a blob store. A future migration to object storage swaps a single resolver.

### Mount

Attach a Railway Volume to the service and mount it at:

```
/app/storage
```

### Runtime root resolution

All file I/O resolves the storage root through this precedence (defined in `src/lib/storage/paths.ts`):

```ts
const STORAGE_ROOT =
  process.env.U1D_FILE_STORAGE_ROOT ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  "/tmp/u1d-storage";
```

- `U1D_FILE_STORAGE_ROOT` — explicit override (local dev, migration testing).
- `RAILWAY_VOLUME_MOUNT_PATH` — set automatically by Railway when a volume is attached.
- `/tmp/u1d-storage` — dev fallback. Never used in production.

### File layout

```
{STORAGE_ROOT}/u1d-volume-files/{year}/{month}/v{version_no}/{file_name}
```

### File naming convention

```
U1DYNAMICS_VOLUME_{YYYY}_{MM}__{sha256_prefix}.xlsx
```

Example:

```
/app/storage/u1d-volume-files/2026/03/v1/U1DYNAMICS_VOLUME_2026_03__a1b2c3d4.xlsx
```

### Internal URL convention

Stored in `u1d_ops.volume_files.original_blob_url`:

```
railway-volume://u1d-volume-files/{year}/{month}/v{version_no}/{file_name}
```

The `railway-volume://` scheme is internal and resolved through the storage helper. Do not hardcode `/app/storage` anywhere in code.

### Write-time discipline

- Files are **never** written at build time (`next build`).
- Files are **never** written from migrations (`db:migrate`) or seeds (`db:seed:*`).
- All writes happen at **runtime** through the admin upload route.
- A startup check (`ensureStorageRoot()`) confirms the storage root exists and is writable on first admin-route hit; it creates the directory tree at runtime if missing.

### The 10 storage rules

1. The uploaded original Excel must be written to Railway Volume before parsing is finalized.
2. Compute SHA-256 from the file buffer.
3. Reject exact duplicate hashes.
4. If the same period receives a different hash, create the next `version_no`.
5. Only one active file version may exist per period (`is_active = TRUE`).
6. Superseded versions must remain in history (`is_superseded = TRUE`, `superseded_by_file_id` set).
7. Never delete prior uploaded files automatically.
8. Board reports must use locked data from Postgres, not direct Excel reads.
9. Admin review pages may link to the stored original file for audit purposes.
10. The startup check creates the storage root at runtime if missing.

See `CLAUDE.md` for the full storage contract and Phase 1.7 invariants.

## Authentication (PR 003A)

The admin surface is gated by **NextAuth (Auth.js v5)** with a **Google OAuth** provider and an allowlist check against `u1d_ops.users`.

### Protected routes

| Path | Public? | Auth required |
|---|---|---|
| `/` | yes | no |
| `/production` | yes | no |
| `/reconciliation` | yes | no |
| `/login` | yes | no |
| `/admin` and `/admin/*` | no | sign-in + allowlist |
| `/api/admin/*` | no | sign-in + allowlist |
| `/api/auth/*` | yes | no (the OAuth dance lives here) |

Middleware (`src/middleware.ts`) only runs on `/admin/:path*` and `/api/admin/:path*`, so the public dashboards pay zero auth overhead.

### Allowlist semantics

Sign-in succeeds only if all four conditions hold for the Google-returned email:
1. Row exists in `u1d_ops.users` (case-insensitive match on `email`).
2. `is_active = TRUE`.
3. `role IN ('viewer', 'admin')`.
4. The DB lookup itself succeeds (transient errors deny sign-in by design).

The DB check happens **once** at sign-in. After that, `role` and `isAdmin` live on the JWT for fast middleware decisions. Deactivating a user in the DB does not invalidate their session until the JWT expires; rotate `NEXTAUTH_SECRET` to force a hard logout for everyone.

### Required environment variables

| Var | Required | Notes |
|---|---|---|
| `NEXTAUTH_SECRET` | yes | 32+ random bytes. Generate: `openssl rand -base64 32`. |
| `NEXTAUTH_URL` | yes (prod) | Public base URL, e.g. `https://dashboard.u1dynamics.com`. Must match the Google OAuth callback config. |
| `GOOGLE_CLIENT_ID` | yes | From Google Cloud Console → APIs & Services → Credentials. |
| `GOOGLE_CLIENT_SECRET` | yes | Same place. |

Authorized redirect URI to configure on the Google OAuth client:
```
${NEXTAUTH_URL}/api/auth/callback/google
```

### Adding or removing an admin

```sql
-- Add
INSERT INTO u1d_ops.users (email, display_name, role)
VALUES ('new.admin@ultra1plus.com', 'New Admin', 'admin');

-- Demote to viewer
UPDATE u1d_ops.users SET role = 'viewer' WHERE email = 'someone@ultra1plus.com';

-- Deactivate (preserves audit trail)
UPDATE u1d_ops.users SET is_active = FALSE WHERE email = 'someone@ultra1plus.com';
```

## Local setup

```bash
# 1. Clone and install
git clone git@github.com:ccolarusso67/u1d-volume-dashboard.git
cd u1d-volume-dashboard
npm install

# 2. Configure env
cp .env.example .env
# Edit .env and set DATABASE_URL (Railway, or a local Postgres with the
# u1d_ops schema available). For local file uploads, optionally set
# U1D_FILE_STORAGE_ROOT to a local directory (defaults to /tmp/u1d-storage).

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

1. **New Service** → Deploy from GitHub repo → select `u1d-volume-dashboard`.
2. Set `DATABASE_URL` env var pointing to the same Postgres instance that hosts `ultra1plus-pricing-core`.
3. **Attach a Railway Volume** to the service and set the mount path to `/app/storage`. This is the storage backend for Phase 1.7 uploaded Excel files. Railway automatically exposes `RAILWAY_VOLUME_MOUNT_PATH` in the runtime environment.
4. After the first deploy, run once in the Railway shell:
   ```bash
   npm run db:setup
   ```
5. Point `dashboard.u1dynamics.com` (CNAME) at the service's public URL.

The application does not write to `/app/storage` at build or deploy time. The directory is created (if missing) the first time the admin upload route is hit at runtime.

## Repo layout

```
db/
  migrations/
    001_create_schema.sql              u1d_ops schema, volume tables/indexes, mv_monthly_totals
    002_seed_catalogs.sql              5 customers, 21 packages, 2 admin users
    003_create_production_schema.sql   production_lines / production_daily / production_files,
                                       mv_production_monthly, mv_volume_reconciliation
    004_seed_production_lines.sql      9 production lines with installed and 80% capacity
    005_create_close_workflow.sql      (Phase 1.7) board_periods, alerts, operator notes, customer_aliases,
                                       volume_files versioning + storage columns
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
    admin/                             (Phase 1.7) upload, review, operator-notes, close
    api/admin/upload/                  (Phase 1.7) POST endpoint that writes to Railway Volume
    globals.css
  components/
    kpi-tile.tsx
    nav.tsx                            Top nav shared across pages
  lib/
    db.ts
    brand.ts                           en-US defaults, es-ES available
    storage/
      paths.ts                         (Phase 1.7) STORAGE_ROOT resolver + URL helpers
      ensure-root.ts                   (Phase 1.7) runtime ensureStorageRoot() check
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
- **`users`** — allowlist for NextAuth (Phase 1.5 / 1.7)
- **`volume_files`** — one row per ingested file version, with hash, `source_total_row`, `computed_customer_sum`, `has_total_discrepancy` flag, plus (Phase 1.7) `version_no`, `is_active`, `is_superseded`, `superseded_by_file_id`, `original_file_path`, `original_blob_url`, `storage_provider`, `uploaded_by`, `uploaded_at`, `staged_at`, `reviewed_at`, `locked_at`
- **`volume_fact`** — the fact table; unique on `(period_year, period_month, customer_key, package_key)`
- **`board_periods`** — (Phase 1.7) lifecycle per period with `status`, `active_file_id`, audit timestamps (`reviewed_at`, `locked_at`, `reopened_at`) and actor fields. Status: `open / staged / in_review / locked / superseded / reopened`
- **`package_alerts`**, **`customer_alerts`** — (Phase 1.7) unknown labels seen during parse; block lock until resolved
- **`monthly_operator_notes`** — (Phase 1.7) Markdown commentary for the operator-narrative slides of the board deck

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
- **Phase 1.7** (in progress): monthly close workflow — NextAuth + Google OAuth, `/admin/upload` with Railway Volume storage, file versioning, period lock, operator-notes form, close-readiness contract for downstream deck generation
- **Phase 2**: drill-downs `/customer/[key]` and `/package/[key]`, charts (recharts), filters, period-matched YoY page, PDF/PPTX export of the monthly board deck from locked Postgres data
- **Phase 3**: auto-pull from SharePoint/Teams via Microsoft Graph API + Railway cron — one path for the monthly SUMMARY files, one for the annual MERCHANDISE_PRODUCTION_CONTROL files
- **Phase 4**: MCP server `u1d-volume-mcp` exposing volume + production tools for Claude Desktop, hosted at `mcp.u1dynamics.com`

## Maintenance notes

- Email addresses in `002_seed_catalogs.sql` use `carmine.colarusso@ultra1plus.com` and `eugenio.piratelli@ultra1plus.com` — confirm/adjust before the first deploy if your real addresses differ.
- The first `REFRESH MATERIALIZED VIEW` must run without `CONCURRENTLY` (the view is empty on first creation). The seed script handles this. Subsequent refreshes use `CONCURRENTLY` to avoid blocking reads.
- The parser assumes the SUMMARY sheet format validated against the 32 files. If the format changes (columns moved, new packages), update `volume-parser.ts` and add a migration to insert new `package_key` rows into `u1d_ops.packages`. Phase 1.7 surfaces unknown packages through `u1d_ops.package_alerts` instead of silently dropping them.
- Board-deck delivery (the `.pptx` for the board of directors) is generated by a separate workflow and stays in Spanish, while this dashboard and all infrastructure run in English.
- **Storage:** never hardcode `/app/storage` in code; always resolve through the helpers in `src/lib/storage/paths.ts`. This keeps the future migration to S3/R2 to a single change.
