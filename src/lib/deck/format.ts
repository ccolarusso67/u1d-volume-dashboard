/**
 * src/lib/deck/format.ts
 *
 * PR 004B — Pure formatting helpers used by the PowerPoint deck generator.
 *
 * Locale-stable on purpose: pptx output is the same for the same input so
 * tests can run anywhere without depending on the runtime's default locale.
 * The runtime `toLocaleString("en-US", ...)` calls below pin to en-US,
 * which is what an English-language board deck wants regardless of the
 * server's TZ/locale.
 */

/** "175,319 gal" — comma thousands, no decimals, "—" for null/undefined/NaN. */
export function formatGallons(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${Math.round(value).toLocaleString("en-US")} gal`;
}

/** "12.4%" — one decimal, "—" for null. Already-fractional input expected (0.124 → 12.4%). */
export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

/** "+1,234 gal" / "-1,234 gal" / "—" — signed gallons with thousands separator. */
export function formatDelta(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  if (rounded === 0) return "0 gal";
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toLocaleString("en-US")} gal`;
}

/**
 * Truncate at `maxChars`. If truncation occurs, append a single ellipsis
 * character (U+2026) inside the budget so the OUTPUT length is exactly
 * `maxChars`. Trims trailing whitespace before adding the ellipsis to avoid
 * "long sentence … " awkwardness.
 *
 * Input is trimmed first so a long string of leading/trailing whitespace
 * doesn't pad the budget.
 */
export function truncateText(value: string | null | undefined, maxChars: number): string {
  if (value === null || value === undefined) return "";
  if (!Number.isInteger(maxChars) || maxChars <= 0) return "";
  const trimmed = String(value).trim();
  if (trimmed.length <= maxChars) return trimmed;
  // Reserve 1 char for the ellipsis.
  const head = trimmed.slice(0, Math.max(0, maxChars - 1)).replace(/\s+$/u, "");
  return `${head}…`;
}

/** "May 30, 2026" — locale-stable en-US date. "—" for null/invalid input. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.valueOf())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "2-digit",
  });
}

/** "May 30, 2026 14:22 UTC" — used for audit lines that want a time too. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.valueOf())) return "—";
  return d.toLocaleString("en-US", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "UTC", timeZoneName: "short",
  });
}
