/**
 * src/lib/board/metrics.ts
 *
 * PR 004A — Pure utility math/labeling for the board dashboard.
 *
 * Everything here is deterministic and side-effect-free so it can be
 * exhaustively unit-tested with node:test. Keep this module narrow:
 * SQL belongs in the aggregator (get-board-period.ts), formatting for
 * specific UI surfaces belongs in components.
 */

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * (year, month) → human-readable label like "May 2026".
 * Returns "Month N <year>" for out-of-range months as a defensive fallback;
 * callers should validate input before this function is reached.
 */
export function monthLabel(year: number, month: number): string {
  const m = MONTHS_EN[month - 1] ?? `Month ${month}`;
  return `${m} ${year}`;
}

/**
 * Walk back one calendar month. December rolls to the previous year.
 *
 *   priorMonth(2026, 5)  → { year: 2026, month: 4 }
 *   priorMonth(2026, 1)  → { year: 2025, month: 12 }
 *
 * Validates inputs and throws on garbage; this is a contract failure
 * (the caller already validated the path params), not a runtime branch.
 */
export function priorMonth(year: number, month: number): { year: number; month: number } {
  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    throw new RangeError(`priorMonth: invalid year ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`priorMonth: invalid month ${month}`);
  }
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

/**
 * Safe percentage = (a / b). Returns null when:
 *   - b is null / undefined / non-finite
 *   - b === 0 (avoids Infinity/NaN propagating into the UI)
 *   - a is null / undefined / non-finite
 *
 * Output is a fraction in (-Inf, +Inf) — UI formats it as a percent.
 */
export function safePct(
  a: number | null | undefined,
  b: number | null | undefined
): number | null {
  if (a === null || a === undefined || !Number.isFinite(a)) return null;
  if (b === null || b === undefined || !Number.isFinite(b) || b === 0) return null;
  return a / b;
}

/**
 * Share = part / whole, clamped to [0, 1] if whole > 0. Null when whole
 * is missing or zero. Caller renders as percent.
 */
export function calculateShare(
  part: number | null | undefined,
  whole: number | null | undefined
): number | null {
  const pct = safePct(part, whole);
  if (pct === null) return null;
  if (pct < 0) return 0;
  if (pct > 1) return 1;
  return pct;
}

/**
 * Month-over-month delta: returns { delta_gallons, delta_pct }.
 * delta_gallons is null only when current is null AND prior is null.
 * delta_pct is null when prior is null/0 (cannot divide).
 */
export function monthOverMonth(
  current: number | null | undefined,
  prior: number | null | undefined
): { delta_gallons: number | null; delta_pct: number | null } {
  const c = current ?? null;
  const p = prior ?? null;
  if (c === null && p === null) {
    return { delta_gallons: null, delta_pct: null };
  }
  const delta = (c ?? 0) - (p ?? 0);
  return {
    delta_gallons: delta,
    delta_pct: safePct(delta, p ?? null),
  };
}
