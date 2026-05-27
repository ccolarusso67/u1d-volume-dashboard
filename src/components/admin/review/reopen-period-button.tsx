"use client";

/**
 * src/components/admin/review/reopen-period-button.tsx
 *
 * PR 003F — Controlled reopen button for a locked period.
 *
 * UX:
 *   - Only rendered when status === 'locked' (the only state that can be
 *     reopened). The wrapper page conditionally renders it.
 *   - Native confirm() prompt before the POST — reopen is a high-blast-radius
 *     action because it walks back a published board artifact. Two-click
 *     confirmation is enough for our 2-admin team.
 *   - Disabled while in flight; success triggers router.refresh() so the
 *     status badge + alert state re-render without a full page reload.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type State =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "error"; message: string };

export function ReopenPeriodButton({
  year,
  month,
}: {
  year: number;
  month: number;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ phase: "idle" });
  const [, startTransition] = useTransition();

  async function submit() {
    const ok = confirm(
      `Reopen period ${year}-${String(month).padStart(2, "0")}?\n\n` +
        "The active file version stays in place. Status flips to 'reopened' " +
        "so the alerts / notes / lock workflow can be re-run."
    );
    if (!ok) return;

    setState({ phase: "submitting" });
    try {
      const res = await fetch(`/api/admin/reopen/${year}/${month}`, {
        method: "POST",
      });
      const j = (await res.json()) as {
        ok: boolean;
        reasons?: string[];
        reopenedAt?: string;
      };
      if (!res.ok || !j.ok) {
        setState({
          phase: "error",
          message: (j.reasons ?? []).join(", ") || `HTTP ${res.status}`,
        });
        return;
      }
      setState({ phase: "idle" });
      startTransition(() => router.refresh());
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  const busy = state.phase === "submitting";

  return (
    <div>
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        aria-busy={busy}
        className="bg-white text-amber-900 border border-amber-300 hover:bg-amber-50 text-sm font-medium px-4 py-2 rounded-sm disabled:opacity-50"
      >
        {busy ? "Reopening…" : "Reopen period"}
      </button>
      {state.phase === "error" && (
        <div
          role="alert"
          className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm"
        >
          Could not reopen: {state.message}
        </div>
      )}
    </div>
  );
}
