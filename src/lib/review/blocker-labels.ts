/**
 * src/lib/review/blocker-labels.ts
 *
 * PR 003G — Friendly UI labels for readiness blocker codes.
 *
 * IMPORTANT:
 *   - This file is ONLY used by the admin UI.
 *   - The readiness API (/api/period/[y]/[m]/readiness) continues to
 *     return stable machine-readable codes for downstream consumers
 *     (deck generator, MCP tools, ops scripts).
 *
 * Code shapes:
 *   1. Bare codes (no count):
 *        no_active_file
 *        no_board_period_row
 *        already_locked
 *        operator_notes_missing
 *        operator_notes_incomplete
 *   2. Counted codes (format: <kind>:<N>):
 *        pending_package_alerts:3
 *        pending_customer_alerts:1
 *        pending_data_quality_alerts:4
 *   3. Anything else falls through to a readable "additional blocker"
 *      message — we never silently drop an unknown code.
 */

const STATIC_LABELS: Record<string, string> = {
  no_active_file:
    "No active upload exists for this period.",
  no_board_period_row:
    "The board period row is missing.",
  already_locked:
    "This period is already locked.",
  operator_notes_missing:
    "Operator notes have not been created.",
  operator_notes_incomplete:
    "Operator notes are still incomplete.",
};

const COUNTED_LABELS: Record<string, { singular: string; plural: string }> = {
  pending_package_alerts: {
    singular: "package alert is still pending",
    plural: "package alerts are still pending",
  },
  pending_customer_alerts: {
    singular: "customer alert is still pending",
    plural: "customer alerts are still pending",
  },
  pending_data_quality_alerts: {
    singular: "data-quality alert is still pending",
    plural: "data-quality alerts are still pending",
  },
};

/**
 * Convert one machine-readable blocker code into a human-friendly label.
 *
 * Falls back to "Additional blocker: <code>" for unknown codes so the
 * UI never silently hides a real problem.
 */
export function formatBlockerLabel(code: string): string {
  if (typeof code !== "string" || code.length === 0) {
    return "Additional blocker: <empty>";
  }
  const direct = STATIC_LABELS[code];
  if (direct) return direct;

  const colon = code.indexOf(":");
  if (colon > 0) {
    const kind = code.slice(0, colon);
    const rest = code.slice(colon + 1);
    const tmpl = COUNTED_LABELS[kind];
    if (tmpl) {
      const n = parseInt(rest, 10);
      if (!Number.isFinite(n) || n <= 0) {
        return `Additional blocker: ${code}`;
      }
      return n === 1 ? `1 ${tmpl.singular}.` : `${n} ${tmpl.plural}.`;
    }
  }

  return `Additional blocker: ${code}`;
}

/** Map an array of blocker codes to their friendly labels. */
export function formatBlockerLabels(codes: string[]): string[] {
  return codes.map(formatBlockerLabel);
}
