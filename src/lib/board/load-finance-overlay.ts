/**
 * src/lib/board/load-finance-overlay.ts
 *
 * PR 012B — load the finance overlay for the board executive dashboard.
 *
 * Wraps the PR 012A read-slice helpers and assembles a BoardFinanceOverlay
 * for a given (year, month). Returns null if the finance DB is not
 * configured (no env var), unreachable, or has no data for the period.
 *
 * Separated from get-board-executive-dashboard.ts so it can be unit tested
 * in isolation and so existing tests can inject a stub loader without
 * needing to mock the finance pool.
 */
import type { Pool } from "pg";
import {
  getMonthlyPnl,
  getMonthlyPnlRange,
  aggregatePnl,
} from "../finance/get-monthly-pnl";
import { getLatestArAging } from "../finance/get-ar-aging";
import { getLatestApAging } from "../finance/get-ap-aging";
import { getSyncHealth, assessSyncHealth } from "../finance/get-sync-health";
import { computeWorkingCapital } from "../finance/working-capital";
import { getFinancePool } from "../finance/db-pool";
import type { BoardFinanceOverlay } from "./executive-types";

/** Inputs that can be overridden for tests. */
export type LoadFinanceOverlayDeps = {
  /** Finance pool. Defaults to getFinancePool(). */
  pool?: Pool;
  /** "Now" for the sync-health staleness assessment. Tests can pin this. */
  now?: Date;
};

/**
 * Loads the finance overlay for one (year, month).
 *
 * Returns null whenever:
 *   - process.env.U1D_FINANCE_DATABASE_URL is unset (local / unconfigured)
 *   - getFinancePool() throws (misconfigured connection)
 *   - the period has no monthly_pnl row AND the trailing-12 returns zeros
 *     (sync hasn't caught up — we don't want to render an empty overlay)
 */
export async function loadFinanceOverlay(
  year: number,
  month: number,
  deps: LoadFinanceOverlayDeps = {}
): Promise<BoardFinanceOverlay | null> {
  let pool: Pool;
  try {
    pool = deps.pool ?? getFinancePool();
  } catch {
    // U1D_FINANCE_DATABASE_URL not set or other init error.
    return null;
  }

  // All read paths use safeQuery internally — they never throw, only
  // return empty / null on errors. So we can fire them in parallel.
  const monthStart = startOfMonth(year, month);
  const trailingStart = trailing12Start(year, month);
  const trailingEnd = monthStart;

  const [current, trendRows, arRows, apRows, syncRows] = await Promise.all([
    getMonthlyPnl(pool, year, month),
    getMonthlyPnlRange(pool, trailingStart, trailingEnd),
    getLatestArAging(pool),
    getLatestApAging(pool),
    getSyncHealth(pool),
  ]);

  const trailing_12m = aggregatePnl(trendRows);

  // If we have neither a current row nor any trailing months AND no AR/AP,
  // the finance DB has nothing for U1D yet — surface null so the deck
  // falls back to volume-only with the "Finance data not available" banner
  // instead of rendering a deceptively-empty finance section.
  const totallyEmpty =
    !current &&
    trailing_12m.months_included === 0 &&
    arRows.length === 0 &&
    apRows.length === 0;
  if (totallyEmpty) return null;

  return {
    current,
    trailing_12m,
    pnl_trend: trendRows,
    working_capital: computeWorkingCapital(arRows, apRows),
    sync_jobs: syncRows,
    sync_assessment: assessSyncHealth(syncRows, { now: deps.now }),
  };
}

// ---------- helpers ----------

function startOfMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function trailing12Start(year: number, month: number): string {
  // 11 months back from (year, month) inclusive => 12 months total.
  const d = new Date(Date.UTC(year, month - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 11);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
