/**
 * src/lib/distribution/types.ts
 *
 * PR 004D — Shared types for board deck distribution.
 */

export type RecipientType = "to" | "cc" | "bcc";

export type BoardDistributionRecipient = {
  recipient_id: number;
  email: string;
  display_name: string | null;
  recipient_type: RecipientType;
  is_active: boolean;
};

export type BoardDistributionListSummary = {
  list_id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  /** Per-role active counts. Inactive recipients are excluded. */
  active_to_count: number;
  active_cc_count: number;
  active_bcc_count: number;
};

export type BoardDistributionList = BoardDistributionListSummary & {
  recipients: BoardDistributionRecipient[];
};

export type BoardDeckSendRecord = {
  send_id: number;
  period_year: number;
  period_month: number;
  file_id: number | null;
  version_no: number | null;
  deck_filename: string;
  distribution_list_id: number | null;
  sent_at: string;
  sent_by: string;
  provider: string;
  provider_message_id: string | null;
  subject: string;
  to_emails: string[];
  cc_emails: string[];
  bcc_count: number;
  status: "sent" | "failed";
  error_message: string | null;
  metadata: Record<string, unknown>;
};

export type RecordSendInput = {
  period_year: number;
  period_month: number;
  file_id: number | null;
  version_no: number | null;
  deck_filename: string;
  distribution_list_id: number | null;
  sent_by: string;
  provider: string;
  provider_message_id: string | null;
  subject: string;
  to_emails: string[];
  cc_emails: string[];
  bcc_count: number;
  status: "sent" | "failed";
  error_message?: string | null;
  metadata?: Record<string, unknown>;
};
