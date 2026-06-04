"use client";

/**
 * Customer alerts panel — client component.
 *
 * Three actions per row: map to existing customer (no alias persisted),
 * create alias (raw_label → existing customer, persisted to
 * u1d_ops.customer_aliases for future uploads), or ignore.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CustomerAlert, CustomerOption } from "@/lib/review/types";
import { getDict } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locale";

type RowState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "error"; message: string };

export function CustomerAlertsPanel({
  alerts,
  customerOptions,
  periodLocked,
  locale = "en",
}: {
  alerts: CustomerAlert[];
  customerOptions: CustomerOption[];
  periodLocked: boolean;
  locale?: Locale;
}) {
  const t = getDict(locale).reviewPanels;
  const lcCode = locale === "es" ? "es-ES" : "en-US";
  const router = useRouter();
  const [rowState, setRowState] = useState<Record<number, RowState>>({});
  const [mapTarget, setMapTarget] = useState<Record<number, string>>({});
  const [, startTransition] = useTransition();

  async function resolve(
    alertId: number,
    action: "ignored" | "mapped" | "create_alias"
  ) {
    const body: Record<string, unknown> = { action };
    if (action !== "ignored") {
      const target = mapTarget[alertId];
      if (!target) {
        setRowState((s) => ({
          ...s,
          [alertId]: { phase: "error", message: t.chooseCustomerErr },
        }));
        return;
      }
      body.mapping_target = target;
    }
    setRowState((s) => ({ ...s, [alertId]: { phase: "submitting" } }));
    try {
      const res = await fetch(`/api/admin/alerts/customer/${alertId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
        {t.custEmpty}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
            <th className="text-left pb-2 pr-3 font-medium">{t.thRawLabel}</th>
            <th className="text-right pb-2 pr-3 font-medium">{t.thGallonsObserved}</th>
            <th className="text-left pb-2 pr-3 font-medium">{t.thResolveToCustomer}</th>
            <th className="text-right pb-2 pr-3 font-medium">{t.thActions}</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a) => {
            const state = rowState[a.alert_id] ?? { phase: "idle" };
            const busy = state.phase === "submitting" || periodLocked;
            return (
              <tr key={a.alert_id} className="border-b border-gray-100 align-top">
                <td className="py-2 pr-3 font-medium text-navy">{a.raw_label}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {a.gallons_observed.toLocaleString(lcCode)}
                </td>
                <td className="py-2 pr-3">
                  <select
                    aria-label={t.mapAriaCustomer(a.raw_label)}
                    disabled={busy}
                    value={mapTarget[a.alert_id] ?? ""}
                    onChange={(e) =>
                      setMapTarget((m) => ({ ...m, [a.alert_id]: e.target.value }))
                    }
                    className="text-sm border border-gray-300 rounded-sm px-2 py-1 bg-white disabled:opacity-50"
                  >
                    <option value="">{t.chooseCustomer}</option>
                    {customerOptions.map((c) => (
                      <option key={c.customer_key} value={c.customer_key}>
                        {c.display_name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">
                  <button
                    type="button"
                    disabled={busy || !mapTarget[a.alert_id]}
                    onClick={() => resolve(a.alert_id, "mapped")}
                    title={t.mapTitle}
                    className="text-xs bg-navy hover:bg-navy-deep text-white px-3 py-1 rounded-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {t.mapBtn}
                  </button>
                  <button
                    type="button"
                    disabled={busy || !mapTarget[a.alert_id]}
                    onClick={() => resolve(a.alert_id, "create_alias")}
                    title={t.mapAliasTitle}
                    className="text-xs bg-emerald-700 hover:bg-emerald-800 text-white px-3 py-1 rounded-sm ml-2 disabled:opacity-40"
                  >
                    {t.mapSaveAlias}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => resolve(a.alert_id, "ignored")}
                    className="text-xs text-gray-700 border border-gray-300 hover:bg-gray-50 px-3 py-1 rounded-sm ml-2 disabled:opacity-40"
                  >
                    {t.ignoreBtn}
                  </button>
                  {state.phase === "error" && (
                    <div className="mt-1 text-[11px] text-red-700 italic">
                      {state.message}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
