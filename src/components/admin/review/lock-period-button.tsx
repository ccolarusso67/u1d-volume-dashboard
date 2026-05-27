"use client";

import { useState, useTransition } from "react";
import { formatBlockerLabels } from "@/lib/review/blocker-labels";
import { useRouter } from "next/navigation";

type State =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "error"; message: string };

export function LockPeriodButton({
  year,
  month,
  canLock,
  blockedReasons,
}: {
  year: number;
  month: number;
  canLock: boolean;
  blockedReasons: string[];
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ phase: "idle" });
  const [, startTransition] = useTransition();

  async function submit() {
    setState({ phase: "submitting" });
    try {
      const res = await fetch(`/api/admin/lock/${year}/${month}`, { method: "POST" });
      const j = (await res.json()) as {
        ok: boolean;
        reasons?: string[];
        lockedAt?: string;
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

  if (!canLock) {
    const friendly = formatBlockerLabels(blockedReasons);
    return (
      <div>
        <button
          type="button"
          disabled
          aria-disabled
          className="bg-gray-200 text-gray-500 px-4 py-2 rounded-sm text-sm font-medium cursor-not-allowed"
          title={friendly.join("\n")}
        >
          Lock period
        </button>
        <div className="mt-2 text-xs text-gray-500 italic max-w-md">
          {friendly.length === 1 ? (
            <>This period cannot be locked yet: {friendly[0]}</>
          ) : (
            <>
              This period cannot be locked yet:
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                {friendly.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        aria-busy={busy}
        className="bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-sm text-sm font-medium disabled:opacity-50"
      >
        {busy ? "Locking…" : "Lock period"}
      </button>
      {state.phase === "error" && (
        <div
          role="alert"
          className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-sm"
        >
          Could not lock: {state.message}
        </div>
      )}
    </div>
  );
}
