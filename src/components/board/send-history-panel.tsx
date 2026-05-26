/**
 * src/components/board/send-history-panel.tsx
 *
 * PR 004D — Server-rendered recent-sends table for the board dashboard.
 */
import type { BoardDeckSendRecord } from "@/lib/distribution/types";

function formatLocaleDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.valueOf())) return iso;
  return d.toLocaleString("en-US", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function SendHistoryPanel({ sends }: { sends: BoardDeckSendRecord[] }) {
  if (sends.length === 0) {
    return (
      <div className="text-sm italic text-gray-500 px-4 py-6 text-center bg-gray-50 border border-gray-200 rounded-sm">
        No deck sends recorded for this period yet.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
            <th className="text-left pb-2 pr-3 font-medium">Sent at</th>
            <th className="text-left pb-2 pr-3 font-medium">By</th>
            <th className="text-right pb-2 pr-3 font-medium">To</th>
            <th className="text-right pb-2 pr-3 font-medium">Cc</th>
            <th className="text-right pb-2 pr-3 font-medium">Bcc</th>
            <th className="text-left pb-2 pr-3 font-medium">Status</th>
            <th className="text-left pb-2 pr-3 font-medium">Provider msg</th>
          </tr>
        </thead>
        <tbody>
          {sends.map((s) => (
            <tr key={s.send_id} className="border-b border-gray-100 last:border-b-0">
              <td className="py-2 pr-3 tabular-nums text-gray-700 whitespace-nowrap">
                {formatLocaleDateTime(s.sent_at)}
              </td>
              <td className="py-2 pr-3 text-gray-700">{s.sent_by}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{s.to_emails.length}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{s.cc_emails.length}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{s.bcc_count}</td>
              <td className="py-2 pr-3">
                <span
                  className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm ${
                    s.status === "sent"
                      ? "bg-emerald-50 text-emerald-900"
                      : "bg-red-50 text-red-900"
                  }`}
                >
                  {s.status}
                </span>
                {s.status === "failed" && s.error_message && (
                  <div className="text-[11px] text-red-700 italic mt-0.5 max-w-[300px] truncate" title={s.error_message}>
                    {s.error_message}
                  </div>
                )}
              </td>
              <td className="py-2 pr-3 text-xs text-gray-500 font-mono truncate max-w-[200px]" title={s.provider_message_id ?? ""}>
                {s.provider_message_id ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-gray-500 italic">
        Source: <code>u1d_ops.board_deck_sends</code>. BCC recipients are counted but not listed.
      </p>
    </div>
  );
}
