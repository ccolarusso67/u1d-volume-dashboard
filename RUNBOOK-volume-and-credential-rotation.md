# Runbook — Railway Volume Mount (#114) + Finance Credential Rotation

Two operational tasks to fully button up the U1D deployment. Neither is a code change.
Do #114 first (active data-loss risk), rotation second.

---

## Task 1 — Mount the Railway Volume at `/app/storage` (#114)

**Why:** the storage code resolves the storage root as
`U1D_FILE_STORAGE_ROOT || RAILWAY_VOLUME_MOUNT_PATH || /tmp/u1d-storage`.
With no volume attached it falls to `/tmp`, which is wiped on every redeploy —
so uploaded Excel originals are lost. Attaching a volume makes Railway set
`RAILWAY_VOLUME_MOUNT_PATH` automatically and the code picks it up.

**Steps (Railway dashboard):**

1. Open Railway → **U1D app project** → select the **Next.js app service**
   (NOT the Postgres service).
2. Go to the service's **Settings** (or the **Volumes** panel).
3. **+ New Volume**. Set the **Mount path** to exactly:
   ```
   /app/storage
   ```
4. Save. Railway attaches the volume and injects `RAILWAY_VOLUME_MOUNT_PATH=/app/storage`.
5. **Belt-and-suspenders (optional):** in the same service's **Variables**, add
   ```
   U1D_FILE_STORAGE_ROOT=/app/storage
   ```
   This is the first key in the resolver, so it pins the path even if Railway's
   injected var ever changes.
6. **Redeploy** the service (attaching a volume triggers one; if not, redeploy manually).

**Verify:**

1. After deploy, go to `/admin/upload` and upload a monthly workbook.
2. Confirm it processes to `in_review` (you'll see it in the review page).
3. Trigger another deploy (e.g. an empty commit or Railway "Redeploy").
4. Re-open the admin review/audit page for that period and confirm the stored
   original file still downloads. If it survives the redeploy, the volume is working.

**Notes / gotchas:**
- A Railway volume attaches to ONE service. Attach it to the app service only.
- Do not run `db:migrate` or `db:seed` expecting them to write here — by design,
  files are only written at runtime through the admin upload flow.
- `ensureStorageRoot()` creates the directory tree on first upload; you don't
  need to pre-create `/app/storage`.

---

## Task 2 — Rotate the `u1d_finance_reader` password

**Why:** the reader credential was pasted into chat multiple times. Rotate it on
the **finance** database (project `u1p_finance_mcp`, service Postgres, db `railway`),
then update the U1D app's connection string.

**Generate a new password** (hex avoids URL-encoding pain in the connection string):
```
openssl rand -hex 24
```
Copy it somewhere safe. Do NOT paste it into chat.

**Step 1 — change the role password on the finance DB.**
Connect as a superuser on the finance project (use Railway CLI linked to the
finance project, or its admin connection string):
```
railway link        # pick the u1p_finance_mcp project + Postgres service
railway run psql "$DATABASE_URL" -c "ALTER ROLE u1d_finance_reader WITH PASSWORD 'PASTE_NEW_PASSWORD_HERE';"
```
(That `DATABASE_URL` is the finance Postgres superuser URL injected by `railway run`
when linked to the finance project — it is NOT the U1D app DB.)

**Step 2 — update the U1D app's finance connection string.**
Railway → **U1D app project** → app service → **Variables** → edit
`U1D_FINANCE_DATABASE_URL`. Keep everything the same except the password:
```
postgresql://u1d_finance_reader:NEW_PASSWORD@PUBLIC_HOST:PORT/railway?sslmode=require
```
- Use the finance DB's **public** host (the `…proxy.rlwy.net`-style host), since
  the U1D app reaches it cross-project through the public proxy.
- Keep `sslmode=require`; the pool already sets `rejectUnauthorized: false` for
  this cross-project connection.

**Step 3 — redeploy the U1D app** (or let the variable change restart it).

**Verify:**
1. Open `/board/2026/3` (or any locked period).
2. The **Financial Performance** section should populate (revenue, margin,
   working capital). If it shows "not connected", the new credential isn't right —
   re-check the password and host in `U1D_FINANCE_DATABASE_URL`.

**Downtime note:** between Step 1 and Step 3 the running app still holds the old
password, so finance queries will fail — but `safeQuery` degrades gracefully
(the board just shows the finance section empty, no crash). Do the three steps
back-to-back to keep that window short; ideally during low traffic.

**Optional hardening:** confirm `u1d_finance_reader` truly is read-only:
```
railway run psql "$DATABASE_URL" -c "\du u1d_finance_reader"
```
It should have no SUPERUSER / CREATEDB / CREATEROLE and only SELECT grants.

---

## Order of operations

1. Mount the volume (#114) → redeploy → verify an upload survives a redeploy.
2. Rotate the credential → update `U1D_FINANCE_DATABASE_URL` → redeploy → verify
   the board's Financial Performance section still loads.

Both are ~5–10 minutes. After these, the deployment is fully buttoned up; the
only remaining work is the upstream `InvoiceSyncJob` fixes in the finance-mcp repo.
