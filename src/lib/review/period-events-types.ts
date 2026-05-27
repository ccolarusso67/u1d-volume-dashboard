/**
 * src/lib/review/period-events-types.ts
 *
 * PR 003G — Shared types for the period lock/reopen audit trail.
 *
 * The audit table u1d_ops.period_lock_events is append-only. These
 * types are consumed by:
 *   - recordPeriodEvent() — writes one row inside an existing TX
 *   - listPeriodEvents()  — reads newest-first for the review page
 *   - getPeriodReview()   — exposes events on PeriodReview
 *   - the review page     — renders the Lock history panel
 */

export type PeriodEventType = "locked" | "reopened";

export type PeriodEventInput = {
  periodYear: number;
  periodMonth: number;
  fileId: number | null;
  eventType: PeriodEventType;
  eventBy: string;
  priorStatus: string | null;
  newStatus: string;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

export type PeriodLockEvent = {
  event_id: number;
  period_year: number;
  period_month: number;
  file_id: number | null;
  event_type: PeriodEventType;
  event_at: string;          // ISO
  event_by: string;
  prior_status: string | null;
  new_status: string;
  reason: string | null;
  metadata: Record<string, unknown>;
};

/**
 * Listing view: PeriodLockEvent plus filename/version_no LEFT-JOINed
 * from volume_files for human-readable display.
 */
export type PeriodLockEventView = PeriodLockEvent & {
  filename: string | null;
  version_no: number | null;
};

/** Thrown by recordPeriodEvent when its input fails validation. */
export class PeriodEventValidationError extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(`PeriodEventValidationError: ${reasons.join(", ")}`);
    this.name = "PeriodEventValidationError";
    this.reasons = reasons;
  }
}
