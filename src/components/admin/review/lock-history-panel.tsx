/**
 * src/components/admin/review/lock-history-panel.tsx
 *
 * PR 003G — Server-rendered Lock history table.
 *
 * Reads PeriodLockEventView[] (joined to volume_files for filename/version)
 * and renders newest-first. Metadata sits inside a collapsed <details>
 * element so the default view stays scannable.
 */
import type { PeriodLockEventView } from "@/lib/review/period-events-types";
import { getDict } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locale";

function formatLocaleDateTime(iso: string | null, locale: Locale): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.valueOf())) return iso;
  return d.toLocaleString(locale === "es" ? "es-ES" : "en-US", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function EventBadge({ type, label }: { type: "locked" | "reopened"; label: string }) {
  const palette = type === "locked"
    ? "bg-emerald-50 text-emerald-900"
    : "bg-purple-50 text-purple-900";
  return (
    <span
      className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm ${palette}`}
    >
      {label}
    </span>
  );
}

export function LockHistoryPanel({ events, locale = "en" }: { events: PeriodLockEventView[]; locale?: Locale }) {
  const dict = getDict(locale);
  const t = dict.reviewPanels;
  const statusLabels = dict.board.status;
  if (events.length === 0) {
    return (
      <div className="text-sm italic text-gray-500 px-4 py-6 text-center bg-gray-50 border border-gray-200 rounded-sm">
        {t.lhEmpty}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
            <th className="text-left pb-2 pr-3 font-medium">{t.thEvent}</th>
            <th className="text-left pb-2 pr-3 font-medium">{t.thDateTime}</th>
            <th className="text-left pb-2 pr-3 font-medium">{t.thBy}</th>
            <th className="text-left pb-2 pr-3 font-medium">{t.thFileVersion}</th>
            <th className="text-left pb-2 pr-3 font-medium">{t.thTransition}</th>
            <th className="text-left pb-2 pr-3 font-medium">{t.thReason}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.event_id} className="border-b border-gray-100 last:border-b-0 align-top">
              <td className="py-2 pr-3 whitespace-nowrap">
                <EventBadge type={e.event_type} label={statusLabels[e.event_type] ?? e.event_type} />
              </td>
              <td className="py-2 pr-3 tabular-nums text-gray-700 whitespace-nowrap">
                {formatLocaleDateTime(e.event_at, locale)}
              </td>
              <td className="py-2 pr-3 text-gray-700 truncate max-w-[220px]" title={e.event_by}>
                {e.event_by}
              </td>
              <td className="py-2 pr-3 text-xs">
                {e.version_no !== null ? (
                  <>
                    <span className="font-medium text-navy">v{e.version_no}</span>
                    {e.filename && (
                      <span
                        className="block text-gray-500 truncate max-w-[260px]"
                        title={e.filename}
                      >
                        {e.filename}
                      </span>
                    )}
                  </>
                ) : e.file_id !== null ? (
                  <span className="text-gray-500 italic">
                    {t.fileIdNoJoin(e.file_id)}
                  </span>
                ) : (
                  <span className="text-gray-400 italic">—</span>
                )}
              </td>
              <td className="py-2 pr-3 text-xs whitespace-nowrap">
                <span className="text-gray-500">{e.prior_status ?? "—"}</span>
                <span className="mx-1 text-gray-400">→</span>
                <span className="text-navy font-medium">{e.new_status}</span>
              </td>
              <td className="py-2 pr-3 text-xs text-gray-700">
                {e.reason ?? <span className="text-gray-400">—</span>}
                {e.metadata && Object.keys(e.metadata).length > 0 && (
                  <details className="mt-1 text-[11px] text-gray-500">
                    <summary className="cursor-pointer select-none">{t.metadata}</summary>
                    <pre className="mt-1 bg-gray-50 border border-gray-200 px-2 py-1 rounded-sm overflow-x-auto">
                      {JSON.stringify(e.metadata, null, 2)}
                    </pre>
                  </details>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-gray-500 italic">
        {t.lhFooter}
      </p>
    </div>
  );
}
