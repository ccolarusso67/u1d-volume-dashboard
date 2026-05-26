/**
 * src/lib/review/types.ts
 *
 * PR 003D — Shared types for the period review surface. Used by the
 * server helpers, API routes, the page, and the client components.
 */

export type BoardPeriodStatus =
  | "open"
  | "staged"
  | "in_review"
  | "locked"
  | "superseded"
  | "reopened";

export type ActiveVolumeFile = {
  file_id: number;
  filename: string;
  file_hash: string;
  file_hash_prefix: string;
  version_no: number;
  uploaded_at: string;        // ISO
  uploaded_by: string;
  staged_at: string | null;
  reviewed_at: string | null;
  locked_at: string | null;
  source_total_row: number | null;
  computed_customer_sum: number;
  has_total_discrepancy: boolean;
  discrepancy_amount: number | null;
  total_gallons: number;       // mirrors computed_customer_sum, kept for explicitness
};

export type VolumeFileVersion = {
  file_id: number;
  filename: string;
  version_no: number;
  is_active: boolean;
  is_superseded: boolean;
  uploaded_at: string;
  uploaded_by: string;
  file_hash_prefix: string;
  has_total_discrepancy: boolean;
};

export type PackageAlert = {
  alert_id: number;
  file_id: number;
  raw_label: string;
  gallons_observed: number;
  status: "pending" | "mapped" | "ignored";
  mapped_to_package_key: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  notes: string | null;
  created_at: string;
};

export type CustomerAlert = {
  alert_id: number;
  file_id: number;
  raw_label: string;
  gallons_observed: number;
  status: "pending" | "mapped" | "ignored";
  mapped_to_customer_key: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  notes: string | null;
  created_at: string;
};

export type DataQualityAlert = {
  alert_id: number;
  file_id: number;
  alert_kind: string;
  severity: "info" | "warn" | "error";
  message: string;
  payload: Record<string, unknown> | null;
  status: "pending" | "acknowledged" | "ignored";
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};

export type VolumeFactPreview = {
  customer_key: string;
  customer_display_name: string;
  is_intercompany: boolean;
  package_key: string;
  package_display_name: string;
  family: string;
  gallons: number;
};

export type AlertSummary = {
  pendingPackageAlerts: number;
  pendingCustomerAlerts: number;
  pendingDataQualityAlerts: number;
  resolvedAlerts: number;
  totalAlerts: number;
};

import type { OperatorNotes } from "../operator-notes/types";
import type { PeriodLockEventView } from "./period-events-types";

export type PeriodReview = {
  operatorNotes: OperatorNotes;
  periodEvents: PeriodLockEventView[];
  period: {
    year: number;
    month: number;
    status: BoardPeriodStatus | null;
    locked_at: string | null;
    locked_by: string | null;
    reviewed_at: string | null;
    reviewed_by: string | null;
  };
  activeFile: ActiveVolumeFile | null;
  priorVersions: VolumeFileVersion[];
  alertSummary: AlertSummary;
  packageAlerts: PackageAlert[];
  customerAlerts: CustomerAlert[];
  dataQualityAlerts: DataQualityAlert[];
  volumeFacts: VolumeFactPreview[];
  canLock: boolean;
  lockBlockedReasons: string[];
};

// ---------------------------------------------------------------------------
// Catalog options surfaced to the alert-resolution UI so admins can map a
// raw label to a known package/customer without round-tripping to the DB.
// ---------------------------------------------------------------------------

export type PackageOption = {
  package_key: string;
  display_name: string;
  family: string;
};

export type CustomerOption = {
  customer_key: string;
  display_name: string;
};
