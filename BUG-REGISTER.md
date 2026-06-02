# U1D Volume Dashboard — Audit & Bug Register

**Date:** 2026-06-02
**Scope:** Static audit of this repo (`u1d-volume-dashboard`) — code, SQL migrations, critical paths.
**Author:** Claude (Cowork), reviewed by Tony Colarusso.

## How to read this

Severity is about board-grade correctness and data integrity, not style.

- **BLOCKER** — wrong numbers in front of the board, or a core flow that fails.
- **HIGH** — silent data inaccuracy under a realistic condition; fix before relying on the surface.
- **MEDIUM** — inconsistency or drift risk; fix soon.
- **LOW** — cleanup / docs / flaky tests.
- **VERIFY** — could not be checked in this environment; must be confirmed on a machine with the DB and the test runner.

## Resolution status (as of this session)

| Item | Status | Commit |
|---|---|---|
| HIGH-1 mv_monthly_totals double-count | ✅ Fixed (needs `db:migrate` + verify) | migration 010 |
| HIGH-2 public-page volume_fact queries | ✅ Fixed | `monthly.ts` ACTIVE_VOLUME_FACT |
| MEDIUM-1 deck channel split | ✅ Fixed | email path → v2 |
| MEDIUM-2 family categorization drift | ✅ Fixed | SQL `CASE` generated from `CATEGORY_MAP` |
| LOW-1 stale CLAUDE.md | ✅ Fixed | doc updated |
| LOW-2 unused-var lint | ✅ Fixed | lint now clean |
| LOW-3 flaky formatDate | ✅ Fixed | `formatDate` pinned to UTC |
| DATA-LOSS #114 Railway volume | ⏳ Open — your infra task | — |
| SECURITY credential rotation | ⏳ Open — your task | — |
| UPSTREAM InvoiceSyncJob bugs | ⏳ Open — separate repo | — |

All code items are typecheck- and lint-clean here, but the **test suite and the
schema migration were not run in this environment** — validate locally before
relying on the HIGH-1 fix (see below).

## Verification status (what was and wasn't run)

| Gate | Result |
|---|---|
| `tsc --noEmit` (typecheck) | ✅ clean |
| `next lint` | ✅ passes — unused-var **warnings** only (see LOW-2) |
| `next build` | ⏸ not run here — run locally |
| `npm test` (33 files) | ⏸ **could not run** — sandbox has the macOS esbuild binary; run locally |
| Live DB / runtime behavior | ⏸ not reachable from the audit environment |
| Upstream `ultra1plus-finance-mcp` connector | ⏸ separate repo — not audited here |

---

## HIGH-1 — `mv_monthly_totals` double-counts after any re-upload

**Where:** `db/migrations/001_create_schema.sql` (MV definition) vs `db/migrations/005_create_close_workflow.sql` (constraint change).

**What:** Migration 005 changed `volume_fact` uniqueness from `(period_year, period_month, customer_key, package_key)` to `(file_id, customer_key, package_key)`. After that change, **every file version's fact rows coexist** in `volume_fact` for the same period (re-uploads no longer overwrite). The migration's own comment states board queries "must join through volume_files and filter on `is_active = TRUE` ... or `locked_at IS NOT NULL`."

`mv_monthly_totals` sums `volume_fact` grouped by period with **no join to `volume_files` and no `is_active` / `locked_at` filter**, and it was **not** redefined in 005 or 006. So the first time any month has ≥2 versions (any re-upload), this MV sums all versions and inflates `total_gallons`, `ultrachem_gallons`, `external_gallons`, and `active_customers`.

**Blast radius:**
- Public landing page `/` (`getLatestMonth`, `getMonth`, `getRecentMonths` in `src/lib/queries/monthly.ts`).
- `mv_volume_reconciliation` (migration 003) pulls `billed_gallons` **from `mv_monthly_totals`**, so `/reconciliation` inherits the inflation (and the inventory-delta math derived from it).
- **Not** the board page — `getBoardExecutiveDashboard` filters `is_active = TRUE AND locked_at IS NOT NULL` correctly. The board deck is safe.

**Status:** Latent. With today's 32 single-version months it likely reads correctly *right now*; it will silently break the public surfaces on the first re-upload. Treat as HIGH (a board-visible public number that goes wrong with no error).

**Fix:** Redefine `mv_monthly_totals` (new migration) to join `volume_files` and filter to the active, locked version per period; then `REFRESH`. Confirm `mv_volume_reconciliation` is refreshed after it. Add a test that loads two versions of one period and asserts the MV counts only the active one.

---

## HIGH-2 — Direct `volume_fact` queries on the public page miss the version filter

**Where:** `src/lib/queries/monthly.ts` — `getMonthlyCategoryTrend`, `getCustomerYoYForMonth`, `getPackageMixForMonth`, `getPackageYoYForMonth`, `getYTDComparison` (called from `src/app/page.tsx`).

**What:** Same root cause as HIGH-1. These query `volume_fact` directly (`SUM(gallons)`) with **no `volume_files` join and no `is_active` filter**. Post-migration-005, after any re-upload they double-count the superseded version — wrong category trend, customer YoY, package mix/YoY, and YTD on the public page.

**Fix:** Add `JOIN u1d_ops.volume_files f ON f.file_id = vf.file_id AND f.is_active = TRUE` (or `locked_at IS NOT NULL` if these should be board-grade) to each. Mirror the filter the exec-dashboard SQL already uses.

---

## MEDIUM-1 — Deck differs by channel (download = v2, email = v1)

**Where:** download `src/app/api/admin/deck/[year]/[month]/route.ts` (now **v2**, `generateMonthlyDeckV2`) vs email `src/lib/distribution/send-board-deck.ts` + `src/app/api/admin/deck/[year]/[month]/email/route.ts` (still **v1**, `generateMonthlyDeck` / `getBoardPeriod`).

**What:** A director who downloads from the dashboard gets the 10-slide Board Operating Review; a director who receives the emailed deck gets the old v1 volume highlight reel. Same period, two different documents.

**Fix:** Convert the send path to load `getBoardExecutiveDashboard` and call `generateMonthlyDeckV2` / `deckFilenameV2`, and re-check the email render. Then retire v1 (or keep it only behind an explicit flag).

---

## MEDIUM-2 — Two sources of truth for family categorization

**Where:** `src/lib/queries/monthly.ts` `getMonthlyCategoryTrend` (inlines a `CASE p.family ...` in SQL) vs `src/lib/queries/category.ts` `categorizeFamily()` (now an **unused** import in `monthly.ts`).

**What:** The categorization logic is duplicated — once in SQL, once in TS. The comment says the SQL "MUST mirror categorizeFamily()", but nothing enforces it. If a new family (e.g. a grease line) is added to `categorizeFamily()` and not the SQL, the trend chart silently buckets it as "Other". This is the exact failure mode of the already-fixed PR 002 hotfix, reintroduced as drift risk.

**Fix:** Single source of truth — either categorize in TS after a raw `family` select, or add a test asserting the SQL `CASE` and `categorizeFamily()` agree across all catalog families.

---

## LOW-1 — `CLAUDE.md` is stale on two "known bugs"

**What:** `CLAUDE.md` tells future agents that (a) `getMonthlyCategoryTrend` compares the family enum against uppercase, and (b) the parser uses a fragile `startsWith` for customers. **Both are already fixed** — the trend query compares lowercase tokens (PR 002 hotfix, with a comment), and `volume-parser.ts` replaced `startsWith` with an uppercased alias-map lookup (the only remaining `startsWith` is benign SUMMARY sheet-name detection). The stale doc will send agents chasing fixed bugs.

**Fix:** Update the "Common tasks" / "What NOT to do" notes in `CLAUDE.md`.

---

## LOW-2 — Lint unused-var warnings

**Where:** `generate-monthly-deck-v2.ts` (`readFileSync`, `formatPct`, `SLIDE_H`), `generate-monthly-deck.ts` (`SLIDE_H`), `monthly.ts` (`categorizeFamily` — see MEDIUM-2), `get-period-review.ts` (`OperatorNotes`, `PeriodLockEventView`).

**Fix:** Remove the dead imports/constants. Trivial; clears the lint output so real warnings stand out.

---

## LOW-3 — Flaky `formatDate` test

**Where:** `tests/deck-format.test.ts`.

**What:** Per the prior-session handoff, fails on macOS after 8pm Eastern due to a UTC/local mismatch. Cosmetic but erodes trust in the suite.

**Fix:** Pin the timezone in the test (construct dates in UTC and assert against a fixed locale), don't rely on the host clock.

---

## Operational / out-of-repo items (not code bugs, but open)

- **DATA-LOSS — Railway Volume not mounted (#114).** Storage code resolves `RAILWAY_VOLUME_MOUNT_PATH`, but until a volume is attached at `/app/storage`, uploaded Excel originals are lost on redeploy. Infra task; do first.
- **SECURITY — finance reader password leaked.** `u1d_finance_reader` credential was pasted in chat repeatedly. Rotate (`ALTER ROLE ... WITH PASSWORD`), update `U1D_FINANCE_DATABASE_URL` on Railway, verify the board page.
- **UPSTREAM — `InvoiceSyncJob` (separate repo).** Three documented bugs (cost hardcoded to 0, ~2.66× revenue inflation from missing subtotal-line filtering, missing group-item handling) gate per-customer revenue/margin. Until fixed, only canonical `monthly_pnl` totals are trustworthy — which is what the board surfaces use.

---

## Recommended fix order

1. **HIGH-1 + HIGH-2 together** — same root cause, one migration + the `monthly.ts` query edits + a regression test. This is the only item that produces *wrong board-adjacent numbers*, so it leads.
2. **#114 Railway volume** (your infra task) — parallel, prevents live data loss.
3. **MEDIUM-1** — convert the email path to v2 so the board never sees two different decks.
4. **MEDIUM-2 + LOW-1/2** — categorization single-source + doc refresh + lint cleanup, one tidy commit.
5. **Credential rotation** — session close-out.
6. **LOW-3** — fix when convenient.

Out of scope here and separately sized: the upstream connector fixes (a day-plus in the other repo) and roadmap Phases 3–4 (SharePoint auto-pull, MCP server — multi-day each).
