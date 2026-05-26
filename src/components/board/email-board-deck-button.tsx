"use client";

/**
 * src/components/board/email-board-deck-button.tsx
 *
 * PR 004D — Client component for the Email-board-deck action.
 *
 * Behavior:
 *   - POST /api/admin/deck/[y]/[m]/email with distribution_list_id
 *   - Disables itself while in flight (prevents double-submit)
 *   - Surfaces stable typed errors as inline banners
 *   - On 'recent_send_exists', shows a second-click "Send anyway" button
 *   - On success, refreshes the page so the send-history panel updates
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type State =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "ok"; message: string; subject: string }
  | { phase: "error"; message: string }
  | {
      phase: "confirm_resend";
      message: string;
      lastSentAt: string;
      lastSentBy: string;
    };

export function EmailBoardDeckButton({
  year,
  month,
  distributionListId,
  distributionListName,
  recipientCount,
  disabled,
  disabledReason,
}: {
  year: number;
  month: number;
  distributionListId: number | null;
  distributionListName: string | null;
  recipientCount: number;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ phase: "idle" });
  const [, startTransition] = useTransition();

  async function send(confirmResend = false) {
    if (!distributionListId) return;
    setState({ phase: "sending" });
    try {
      const res = await fetch(`/api/admin/deck/${year}/${month}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          distribution_list_id: distributionListId,
          confirm_resend: confirmResend,
        }),
      });
      let body: {
        ok?: boolean;
        error?: string;
        message?: string;
        blockers?: string[];
        last_sent_at?: string;
        last_sent_by?: string;
        subject?: string;
        sent_to_count?: number;
        cc_count?: number;
        bcc_count?: number;
      } = {};
      try { body = await res.json(); } catch { body = {}; }

      if (res.ok && body.ok) {
        setState({
          phase: "ok",
          message:
            `Sent to ${body.sent_to_count ?? "?"} to · ${body.cc_count ?? 0} cc · ${body.bcc_count ?? 0} bcc.`,
          subject: body.subject ?? "—",
        });
        startTransition(() => router.refresh());
        return;
      }

      if (res.status === 409 && body.error === "recent_send_exists") {
        setState({
          phase: "confirm_resend",
          message:
            `A successful send already exists for this period within the last 24 hours. ` +
            `Last sent ${body.last_sent_at} by ${body.last_sent_by}.`,
          lastSentAt: body.last_sent_at ?? "",
          lastSentBy: body.last_sent_by ?? "",
        });
        return;
      }

      const userMessage = (() => {
        switch (body.error) {
          case "period_not_ready":
            return `The period is not board-ready: ${(body.blockers ?? []).join(", ") || "unknown"}.`;
          case "no_active_recipients":
            return "Distribution list has no active TO recipients.";
          case "distribution_list_not_found":
            return "Distribution list not found.";
          case "distribution_list_inactive":
            return "Distribution list is inactive.";
          case "email_provider_not_configured":
            return "No email provider is configured. Set BOARD_EMAIL_PROVIDER on the server.";
          default:
            return body.message ?? `Send failed (HTTP ${res.status}).`;
        }
      })();

      setState({ phase: "error", message: userMessage });
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  const busy = state.phase === "sending";
  const buttonDisabled = busy || disabled || !distributionListId || recipientCount === 0;

  return (
    <div>
      {!distributionListId ? (
        <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-sm px-3 py-2">
          Configure a board distribution list before sending.
        </div>
      ) : recipientCount === 0 ? (
        <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-sm px-3 py-2">
          {distributionListName ?? "Distribution list"} has no active recipients.
        </div>
      ) : (
        <button
          type="button"
          onClick={() => send(false)}
          disabled={buttonDisabled}
          aria-busy={busy}
          className="bg-emerald-700 hover:bg-emerald-800 text-white font-medium text-sm px-4 py-2 rounded-sm disabled:opacity-50 disabled:cursor-not-allowed"
          title={disabled && disabledReason ? disabledReason : undefined}
        >
          {busy ? "Sending…" : `Email board deck (${recipientCount} recipient${recipientCount === 1 ? "" : "s"})`}
        </button>
      )}

      {state.phase === "ok" && (
        <div role="status" className="mt-2 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-sm">
          <div className="font-semibold">Deck sent</div>
          <div>{state.message}</div>
          <div className="italic mt-1">Subject: {state.subject}</div>
        </div>
      )}

      {state.phase === "error" && (
        <div role="alert" className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm">
          Could not send: {state.message}
        </div>
      )}

      {state.phase === "confirm_resend" && (
        <div role="alert" className="mt-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 px-3 py-2 rounded-sm">
          <div className="font-semibold">A recent send already exists</div>
          <div>{state.message}</div>
          <button
            type="button"
            onClick={() => send(true)}
            className="mt-2 inline-block bg-amber-700 hover:bg-amber-800 text-white text-xs px-3 py-1 rounded-sm"
          >
            Send anyway (resend)
          </button>
        </div>
      )}
    </div>
  );
}
