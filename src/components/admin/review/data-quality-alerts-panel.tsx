"use client";

/**
 * Data quality alerts panel — client component.
 *
 * Two actions: acknowledge (reviewed and accepted as-is) or ignore.
 * No mapping target; an optional note field is currently unsupported by
 * the data_quality_alerts schema and is documented as a known limitation.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DataQualityAlert } from "@/lib/review/types";
import { getDict } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locale";

type RowState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "error"; message: string };

const SEVERITY_CLASS: Record<DataQualityAlert["severity"], string> = {
  info: "bg-blue-50 text-blue-900",
  warn: "bg-amber-50 text-amber-900",
  error: "bg-red-50 text-red-900",
};

export function DataQualityAlertsPanel({
  alerts,
  periodLocked,
  locale = "en",
}: {
  alerts: DataQualityAlert[];
  periodLocked: boolean;
  locale?: Locale;
}) {
  const t = getDict(locale).reviewPanels;
  const router = useRouter();
  const [rowState, setRowState] = useState<Record<number, RowState>>({});
  const [, startTransition] = useTransition();

  async function resolve(alertId: number, action: "acknowledged" | "ignored") {
    setRowState((s) => ({ ...s, [alertId]: { phase: "submitting" } }));
    try {
      const res = await fetch(`/api/admin/alerts/data_quality/${alertId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = (await res.json()) as { ok: boolean; reason?: string };
      if (!res.ok || !j.ok) {
        setRowState((s) => ({
          ...s,
          [alertId]: { phase: "error", message: j.reason ?? `HTTP ${res.status}` },
        }));
        return;
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setRowState((s) => ({
        ...s,
        [alertId]: {
          phase: "error",
          message: err instanceof Error ? err.message : t.networkError,
        },
      }));
    }
  }

  if (alerts.length === 0) {
    return (
      <div className="text-sm italic text-gray-500 px-4 py-6 text-center bg-gray-50 border border-gray-200 rounded-sm">
        {t.dqEmpty}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {alerts.map((a) => {
        const state = rowState[a.alert_id] ?? { phase: "idle" };
        const busy = state.phase === "submitting" || periodLocked;
        return (
          <div
            key={a.alert_id}
            className={`border rounded-sm px-4 py-3 ${SEVERITY_CLASS[a.severity]}`}
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider font-semibold">
                {a.severity}
              </span>
              <span className="text-[11px] uppercase tracking-wider opacity-80">
                {a.alert_kind}
              </span>
            </div>
            <div className="text-sm mt-1">{a.message}</div>
            {a.payload && (
              <pre className="mt-2 text-[11px] bg-white/60 border border-white/40 px-2 py-1 rounded-sm overflow-x-auto">
                {JSON.stringify(a.payload, null, 2)}
              </pre>
            )}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => resolve(a.alert_id, "acknowledged")}
                className="text-xs bg-navy hover:bg-navy-deep text-white px-3 py-1 rounded-sm disabled:opacity-40"
              >
                {t.acknowledge}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => resolve(a.alert_id, "ignored")}
                className="text-xs text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 px-3 py-1 rounded-sm disabled:opacity-40"
              >
                {t.ignoreBtn}
              </button>
              {state.phase === "error" && (
                <span className="text-[11px] text-red-700 italic ml-2">
                  {state.message}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
