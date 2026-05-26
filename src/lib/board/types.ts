/**
 * src/lib/board/types.ts
 *
 * PR 004A — BoardPeriodView shape consumed by /board/[year]/[month].
 *
 * Design: the same shape is returned whether the period is board-ready or
 * blocked. The UI branches on readiness.ready. Numeric "total" fields
 * default to 0 when blocked rather than null to keep the type ergonomic;
 * the UI must still gate metric rendering on readiness.ready.
 */
import type { SectionKey } from "../operator-notes/types";

export type BoardPeriodView = {
  period: {
    year: number;
    month: number;
    label: string;
    status: string | null;
    locked_at: string | null;
    locked_by: string | null;
  };
  readiness: {
    ready: boolean;
    blockers: string[];
  };
  activeFile: {
    file_id: number;
    filename: string;
    version_no: number;
    uploaded_at: string | null;
    uploaded_by: string | null;
    file_hash_prefix: string;
    total_gallons: number | null;
    source_total_gallons: number | null;
    reconstructed_total_gallons: number | null;
    has_total_discrepancy: boolean;
  } | null;
  headlineMetrics: {
    total_gallons: number;
    prior_month_total_gallons: number | null;
    month_over_month_delta_gallons: number | null;
    month_over_month_delta_pct: number | null;
    customer_count: number;
    package_count: number;
    fact_row_count: number;
  };
  topCustomers: Array<{
    customer_key: string | null;
    customer_name: string;
    gallons: number;
    share_pct: number | null;
    prior_month_gallons: number | null;
    delta_gallons: number | null;
    delta_pct: number | null;
  }>;
  topPackages: Array<{
    package_key: string | null;
    package_label: string;
    gallons: number;
    share_pct: number | null;
    prior_month_gallons: number | null;
    delta_gallons: number | null;
    delta_pct: number | null;
  }>;
  operatorNotes: Record<SectionKey, string> & {
    completed_at: string | null;
    completed_by: string | null;
  } | null;
  alertSummary: {
    package_alerts_total: number;
    customer_alerts_total: number;
    data_quality_alerts_total: number;
    resolved_alerts_total: number;
    pending_alerts_total: number;
  };
  lockHistory: Array<{
    event_id: number;
    event_type: "locked" | "reopened";
    event_at: string;
    event_by: string;
    prior_status: string | null;
    new_status: string;
    file_id: number | null;
    version_no: number | null;
    filename: string | null;
  }>;
};

export type BoardPeriodIndexRow = {
  period: {
    year: number;
    month: number;
    label: string;
  };
  status: string;
  locked_at: string | null;
  locked_by: string | null;
  total_gallons: number | null;
  prior_month_total_gallons: number | null;
  month_over_month_delta_pct: number | null;
  operator_notes_complete: boolean;
  href: string;
};
