/**
 * src/components/admin/upload-history-table.tsx
 *
 * PR 003C — Server-rendered table of recent uploads. Pure read view sourced
 * from u1d_ops.volume_files via listUploadHistory().
 *
 * Columns (per PR 003C spec):
 *   1. Upload date/time
 *   2. Original filename
 *   3. Period (year/month)
 *   4. Version
 *   5. Uploaded by
 *   6. Status (board_periods.status of the row's period)
 *   7. Notes — duplicate/hash indicator + total-discrepancy flag
 */
import { formatPeriod, fmtNum } from "@/lib/brand";
import type { UploadHistoryRow } from "@/lib/upload/list-upload-history";

function StatusBadge({ status }: { status: UploadHistoryRow["status"] }) {
  if (!status) {
    return <span className="text-[10px] uppercase tracking-wider text-gray-400">—</span>;
  }
  const palette: Record<NonNullable<UploadHistoryRow["status"]>, string> = {
    open:       "bg-gray-100 text-gray-700",
    staged:     "bg-blue-50 text-blue-800",
    in_review:  "bg-amber-50 text-amber-900",
    locked:     "bg-emerald-50 text-emerald-900",
    superseded: "bg-gray-100 text-gray-500 italic",
    reopened:   "bg-purple-50 text-purple-900",
  };
  return (
    <span
      className={`inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm ${palette[status]}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function VersionPill({ row }: { row: UploadHistoryRow }) {
  if (row.is_superseded) {
    return (
      <span className="text-[11px] text-gray-400 italic">
        v{row.version_no} (superseded)
      </span>
    );
  }
  if (row.is_active) {
    return (
      <span className="inline-block text-[11px] font-semibold text-navy bg-navy/5 border border-navy/20 px-1.5 py-0.5 rounded-sm">
        v{row.version_no} (active)
      </span>
    );
  }
  return <span className="text-[11px] text-gray-500">v{row.version_no}</span>;
}

function formatLocaleDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.valueOf())) return iso;
  // en-US format, 24-hour for unambiguous reading at a glance.
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function UploadHistoryTable({ rows }: { rows: UploadHistoryRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-sm italic text-gray-500 px-4 py-8 text-center bg-gray-50 border border-gray-200 rounded-sm">
        No uploads yet. The most recent monthly file will appear here once it has been processed.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
            <th className="text-left pb-2 pr-3 font-medium">Uploaded at</th>
            <th className="text-left pb-2 pr-3 font-medium">Filename</th>
            <th className="text-left pb-2 pr-3 font-medium">Period</th>
            <th className="text-left pb-2 pr-3 font-medium">Version</th>
            <th className="text-left pb-2 pr-3 font-medium">By</th>
            <th className="text-left pb-2 pr-3 font-medium">Status</th>
            <th className="text-left pb-2 pr-3 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.file_id} className="border-b border-gray-100 last:border-b-0">
              <td className="py-2 pr-3 tabular-nums whitespace-nowrap text-gray-700">
                {formatLocaleDateTime(row.uploaded_at)}
              </td>
              <td className="py-2 pr-3 text-navy truncate max-w-[260px]" title={row.filename}>
                {row.filename}
              </td>
              <td className="py-2 pr-3 whitespace-nowrap">
                <a
                  href={`/admin/review/${row.period_year}/${row.period_month}`}
                  className="text-navy underline hover:no-underline"
                  title={`Review ${formatPeriod(row.period_year, row.period_month, "en")}`}
                >
                  {formatPeriod(row.period_year, row.period_month, "en")}
                </a>
              </td>
              <td className="py-2 pr-3 whitespace-nowrap">
                <VersionPill row={row} />
              </td>
              <td className="py-2 pr-3 truncate max-w-[200px] text-gray-700" title={row.uploaded_by}>
                {row.uploaded_by}
              </td>
              <td className="py-2 pr-3 whitespace-nowrap">
                <StatusBadge status={row.status} />
              </td>
              <td className="py-2 pr-3 text-xs text-gray-500">
                <div className="flex flex-wrap gap-2">
                  <span className="font-mono" title={`Full SHA-256: ${row.file_hash}`}>
                    {row.file_hash_prefix}
                  </span>
                  {row.has_total_discrepancy && (
                    <span className="bg-amber-50 border border-amber-200 text-amber-900 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm">
                      total mismatch
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 text-xs italic text-gray-500">
        Showing the latest {rows.length} upload{rows.length === 1 ? "" : "s"}. Source: <code>u1d_ops.volume_files</code> joined to <code>u1d_ops.board_periods</code>.
        Total volume: {fmtNum(rows.length)} records.
      </div>
    </div>
  );
}
