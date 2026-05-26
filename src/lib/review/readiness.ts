/**
 * src/lib/review/readiness.ts
 *
 * PR 003E — Single source of truth for "is this period board-ready?".
 *
 * Inputs (all derived from current DB state):
 *   - active file present
 *   - board_periods row present
 *   - period not already locked
 *   - zero pending alerts of any of the three kinds
 *   - operator notes is_complete
 *
 * Outputs:
 *   - ready: boolean
 *   - blockers: stable string codes the UI / deck generator can branch on
 *
 * Stable code shape: `kind` (snake_case) optionally followed by ":count".
 *
 *   no_active_file
 *   no_board_period_row
 *   already_locked
 *   pending_package_alerts:N
 *   pending_customer_alerts:N
 *   pending_data_quality_alerts:N
 *   operator_notes_missing
 *   operator_notes_incomplete
 */

export type ReadinessInputs = {
  hasActiveFile: boolean;
  hasBoardPeriodRow: boolean;
  isAlreadyLocked: boolean;
  pendingPackageAlerts: number;
  pendingCustomerAlerts: number;
  pendingDataQualityAlerts: number;
  operatorNotesExists: boolean;
  operatorNotesComplete: boolean;
};

export type ReadinessResult = {
  ready: boolean;
  blockers: string[];
};

export function evaluateReadiness(i: ReadinessInputs): ReadinessResult {
  const blockers: string[] = [];

  if (!i.hasActiveFile) blockers.push("no_active_file");
  if (!i.hasBoardPeriodRow) blockers.push("no_board_period_row");
  if (i.isAlreadyLocked) blockers.push("already_locked");

  if (i.pendingPackageAlerts > 0)
    blockers.push(`pending_package_alerts:${i.pendingPackageAlerts}`);
  if (i.pendingCustomerAlerts > 0)
    blockers.push(`pending_customer_alerts:${i.pendingCustomerAlerts}`);
  if (i.pendingDataQualityAlerts > 0)
    blockers.push(`pending_data_quality_alerts:${i.pendingDataQualityAlerts}`);

  if (!i.operatorNotesExists) {
    blockers.push("operator_notes_missing");
  } else if (!i.operatorNotesComplete) {
    blockers.push("operator_notes_incomplete");
  }

  return { ready: blockers.length === 0, blockers };
}
