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

function formatLocaleDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.valueOf())) return iso;
  return d.toLocaleString("en-US", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function EventBadge({ type }: { type: "locked" | "reopened" }) {
  const palette = type === "locked"
    ? "bg-emerald-50 text-emerald-900"
    : "bg-purple-50 text-purple-900";
  return (
    <span
      className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm ${palette}`}
    >
      {type}
    </span>
  );
}

export function LockHistoryPanel({ events }: { events: PeriodLockEventView[] }) {
  if (events.length === 0) {
    return (
      <div className="text-sm italic text-gray-500 px-4 py-6 text-center bg-gray-50 border border-gray-200 rounded-sm">
        No lock or reopen events have been recorded for this period yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
            <th className="text-left pb-2 pr-3 font-medium">Event</th>
            <th className="text-left pb-2 pr-3 font-medium">Date / time</th>
            <th className="text-left pb-2 pr-3 font-medium">By</th>
            <th className="text-left pb-2 pr-3 font-medium">File / version</th>
            <th className="text-left pb-2 pr-3 font-medium">Transition</th>
            <th className="text-left pb-2 pr-3 font-medium">Reason</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.event_id} className="border-b border-gray-100 last:border-b-0 align-top">
              <td className="py-2 pr-3 whitespace-nowrap">
                <EventBadge type={e.event_type} />
              </td>
              <td className="py-2 pr-3 tabular-nums text-gray-700 whitespace-nowrap">
                {formatLocaleDateTime(e.event_at)}
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
                    file_id {e.file_id} (no longer joinable)
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
                    <summary className="cursor-pointer select-none">metadata</summary>
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
        Source: <code>u1d_ops.period_lock_events</code>. Append-only — every
        lock/reopen action is recorded inside the same transaction as the
        state transition.
      </p>
    </div>
  );
}
