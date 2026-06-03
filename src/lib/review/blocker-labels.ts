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

type Loc = "en" | "es";

const STATIC_LABELS: Record<Loc, Record<string, string>> = {
  en: {
    no_active_file: "No active upload exists for this period.",
    no_board_period_row: "The board period row is missing.",
    already_locked: "This period is already locked.",
    operator_notes_missing: "Operator notes have not been created.",
    operator_notes_incomplete: "Operator notes are still incomplete.",
  },
  es: {
    no_active_file: "No existe una carga activa para este período.",
    no_board_period_row: "Falta la fila del período del directorio.",
    already_locked: "Este período ya está bloqueado.",
    operator_notes_missing: "Las notas del operador no han sido creadas.",
    operator_notes_incomplete: "Las notas del operador aún están incompletas.",
  },
};

const COUNTED_LABELS: Record<Loc, Record<string, { singular: string; plural: string }>> = {
  en: {
    pending_package_alerts: { singular: "package alert is still pending", plural: "package alerts are still pending" },
    pending_customer_alerts: { singular: "customer alert is still pending", plural: "customer alerts are still pending" },
    pending_data_quality_alerts: { singular: "data-quality alert is still pending", plural: "data-quality alerts are still pending" },
  },
  es: {
    pending_package_alerts: { singular: "alerta de presentación sigue pendiente", plural: "alertas de presentación siguen pendientes" },
    pending_customer_alerts: { singular: "alerta de cliente sigue pendiente", plural: "alertas de cliente siguen pendientes" },
    pending_data_quality_alerts: { singular: "alerta de calidad de datos sigue pendiente", plural: "alertas de calidad de datos siguen pendientes" },
  },
};

const ADDITIONAL: Record<Loc, string> = { en: "Additional blocker", es: "Bloqueo adicional" };
const EMPTY_CODE: Record<Loc, string> = { en: "Additional blocker: <empty>", es: "Bloqueo adicional: <vacío>" };

/**
 * Convert one machine-readable blocker code into a human-friendly label.
 *
 * Falls back to "Additional blocker: <code>" for unknown codes so the
 * UI never silently hides a real problem.
 */
export function formatBlockerLabel(code: string, locale: Loc = "en"): string {
  if (typeof code !== "string" || code.length === 0) {
    return EMPTY_CODE[locale];
  }
  const direct = STATIC_LABELS[locale][code];
  if (direct) return direct;

  const colon = code.indexOf(":");
  if (colon > 0) {
    const kind = code.slice(0, colon);
    const rest = code.slice(colon + 1);
    const tmpl = COUNTED_LABELS[locale][kind];
    if (tmpl) {
      const n = parseInt(rest, 10);
      if (!Number.isFinite(n) || n <= 0) {
        return `${ADDITIONAL[locale]}: ${code}`;
      }
      return n === 1 ? `1 ${tmpl.singular}.` : `${n} ${tmpl.plural}.`;
    }
  }

  return `${ADDITIONAL[locale]}: ${code}`;
}

/** Map an array of blocker codes to their friendly labels. */
export function formatBlockerLabels(codes: string[], locale: Loc = "en"): string[] {
  return codes.map((c) => formatBlockerLabel(c, locale));
}
