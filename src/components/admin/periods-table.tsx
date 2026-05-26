/**
 * src/components/admin/periods-table.tsx
 *
 * PR 003F — Server-rendered periods index.
 *
 * Pure read view; no client state. Every cell is a stable derivation of
 * the data fetched in listPeriods(), and the "Next action" button uses
 * the action.href the helper already chose — keeps the action logic in
 * one place rather than spreading rules across the table component.
 */
import type { PeriodIndexRow, NextActionTone } from "@/lib/periods/list-periods";
import { formatBlockerLabels } from "@/lib/review/blocker-labels";

function formatLocaleDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.valueOf())) return iso;
  return d.toLocaleString("en-US", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return <span className="text-[10px] uppercase tracking-wider text-gray-400">—</span>;
  }
  const palette: Record<string, string> = {
    open:       "bg-gray-100 text-gray-700",
    staged:     "bg-blue-50 text-blue-800",
    in_review:  "bg-amber-50 text-amber-900",
    locked:     "bg-emerald-50 text-emerald-900",
    superseded: "bg-gray-100 text-gray-500 italic",
    reopened:   "bg-purple-50 text-purple-900",
  };
  return (
    <span
      className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm ${palette[status] ?? "bg-gray-100 text-gray-700"}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function NotesBadge({ exists, complete }: { exists: boolean; complete: boolean }) {
  if (complete) {
    return <span className="inline-block text-[10px] uppercase tracking-wider font-semibold bg-emerald-50 text-emerald-900 px-2 py-0.5 rounded-sm">complete</span>;
  }
  if (exists) {
    return <span className="inline-block text-[10px] uppercase tracking-wider font-semibold bg-amber-50 text-amber-900 px-2 py-0.5 rounded-sm">draft</span>;
  }
  return <span className="inline-block text-[10px] uppercase tracking-wider font-semibold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-sm">missing</span>;
}

function ReadinessBadge({
  ready, status, blockers,
}: {
  ready: boolean;
  status: string | null;
  blockers: string[];
}) {
  if (status === "locked") {
    return <span className="inline-block text-[10px] uppercase tracking-wider font-semibold bg-emerald-50 text-emerald-900 px-2 py-0.5 rounded-sm">locked</span>;
  }
  if (ready) {
    return <span className="inline-block text-[10px] uppercase tracking-wider font-semibold bg-emerald-50 text-emerald-900 px-2 py-0.5 rounded-sm">ready</span>;
  }
  return (
    <span
      className="inline-block text-[10px] uppercase tracking-wider font-semibold bg-amber-50 text-amber-900 px-2 py-0.5 rounded-sm"
      title={formatBlockerLabels(blockers).join("\n")}
    >
      blocked
    </span>
  );
}

function ActionButton({
  label, href, tone,
}: { label: string; href: string; tone: NextActionTone }) {
  const palette: Record<NextActionTone, string> = {
    primary: "bg-navy hover:bg-navy-deep text-white",
    warning: "bg-amber-700 hover:bg-amber-800 text-white",
    neutral: "bg-white text-navy border border-gray-300 hover:bg-gray-50",
    success: "bg-emerald-700 hover:bg-emerald-800 text-white",
  };
  return (
    <a
      href={href}
      className={`inline-block text-xs font-medium px-3 py-1 rounded-sm transition-colors whitespace-nowrap ${palette[tone]}`}
    >
      {label}
    </a>
  );
}

function AlertChips({
  pkg, cust, dq,
}: { pkg: number; cust: number; dq: number }) {
  const total = pkg + cust + dq;
  if (total === 0) {
    return <span className="text-[11px] text-gray-400 italic">—</span>;
  }
  return (
    <span className="text-xs whitespace-nowrap">
      {pkg > 0 && (
        <span className="bg-amber-50 border border-amber-200 text-amber-900 px-1.5 py-0.5 rounded-sm mr-1">
          {pkg} pkg
        </span>
      )}
      {cust > 0 && (
        <span className="bg-amber-50 border border-amber-200 text-amber-900 px-1.5 py-0.5 rounded-sm mr-1">
          {cust} cust
        </span>
      )}
      {dq > 0 && (
        <span className="bg-amber-50 border border-amber-200 text-amber-900 px-1.5 py-0.5 rounded-sm">
          {dq} dq
        </span>
      )}
    </span>
  );
}

export function PeriodsTable({ rows }: { rows: PeriodIndexRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-sm italic text-gray-500 px-4 py-8 text-center bg-gray-50 border border-gray-200 rounded-sm">
        No periods to show yet. Upload a monthly workbook from{" "}
        <a href="/admin/upload" className="text-navy underline">/admin/upload</a> to seed the index.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
            <th className="text-left pb-2 pr-3 font-medium">Period</th>
            <th className="text-left pb-2 pr-3 font-medium">Status</th>
            <th className="text-left pb-2 pr-3 font-medium">Active file</th>
            <th className="text-left pb-2 pr-3 font-medium">Uploaded</th>
            <th className="text-left pb-2 pr-3 font-medium">Alerts</th>
            <th className="text-left pb-2 pr-3 font-medium">Notes</th>
            <th className="text-left pb-2 pr-3 font-medium">Lock</th>
            <th className="text-right pb-2 pr-3 font-medium">Next action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.period.year}-${row.period.month}`}
              className="border-b border-gray-100 last:border-b-0 align-top"
            >
              <td className="py-2.5 pr-3 whitespace-nowrap">
                <a
                  href={`/admin/review/${row.period.year}/${row.period.month}`}
                  className="font-medium text-navy underline-offset-2 hover:underline"
                >
                  {row.period.label}
                </a>
              </td>
              <td className="py-2.5 pr-3 whitespace-nowrap">
                <StatusBadge status={row.status} />
              </td>
              <td className="py-2.5 pr-3">
                {row.activeFile ? (
                  <div className="flex flex-col">
                    <span className="font-medium text-navy text-xs">
                      v{row.activeFile.version_no}
                    </span>
                    <span
                      className="text-xs text-gray-700 truncate max-w-[220px]"
                      title={row.activeFile.filename}
                    >
                      {row.activeFile.filename}
                    </span>
                    <span className="font-mono text-[10px] text-gray-400">
                      {row.activeFile.file_hash_prefix}
                    </span>
                  </div>
                ) : (
                  <span className="text-[11px] italic text-gray-400">none</span>
                )}
              </td>
              <td className="py-2.5 pr-3 text-xs text-gray-700 whitespace-nowrap">
                {row.activeFile ? (
                  <div>
                    <div>{formatLocaleDateTime(row.activeFile.uploaded_at)}</div>
                    <div className="text-[11px] text-gray-500">
                      {row.activeFile.uploaded_by ?? "—"}
                    </div>
                  </div>
                ) : (
                  <span className="text-[11px] italic text-gray-400">—</span>
                )}
              </td>
              <td className="py-2.5 pr-3">
                <AlertChips
                  pkg={row.alertCounts.pending_package}
                  cust={row.alertCounts.pending_customer}
                  dq={row.alertCounts.pending_data_quality}
                />
              </td>
              <td className="py-2.5 pr-3 whitespace-nowrap">
                <NotesBadge
                  exists={row.operatorNotes.exists}
                  complete={row.operatorNotes.complete}
                />
              </td>
              <td className="py-2.5 pr-3 whitespace-nowrap">
                <ReadinessBadge
                  ready={row.readiness.ready}
                  status={row.status}
                  blockers={row.readiness.blockers}
                />
              </td>
              <td className="py-2.5 pr-3 text-right">
                <ActionButton {...row.nextAction} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-gray-500 italic">
        Source: <code>u1d_ops.board_periods</code> joined to active{" "}
        <code>volume_files</code> and <code>monthly_operator_notes</code>.
        Hover the "blocked" badge for the full readiness reason list.
      </p>
    </div>
  );
}
