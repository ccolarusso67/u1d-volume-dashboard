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
import { formatPeriod } from "@/lib/brand";
import type { UploadHistoryRow } from "@/lib/upload/list-upload-history";
import { getDict } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locale";

type UploadDict = ReturnType<typeof getDict>["upload"];

function StatusBadge({ status, statusLabels }: { status: UploadHistoryRow["status"]; statusLabels: Record<string, string> }) {
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
      {statusLabels[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

function VersionPill({ row, t }: { row: UploadHistoryRow; t: UploadDict }) {
  if (row.is_superseded) {
    return (
      <span className="text-[11px] text-gray-400 italic">
        {t.vSuperseded(row.version_no)}
      </span>
    );
  }
  if (row.is_active) {
    return (
      <span className="inline-block text-[11px] font-semibold text-navy bg-navy/5 border border-navy/20 px-1.5 py-0.5 rounded-sm">
        {t.vActive(row.version_no)}
      </span>
    );
  }
  return <span className="text-[11px] text-gray-500">{t.vPlain(row.version_no)}</span>;
}

function formatLocaleDateTime(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (isNaN(d.valueOf())) return iso;
  return d.toLocaleString(locale === "es" ? "es-ES" : "en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function UploadHistoryTable({ rows, locale = "en" }: { rows: UploadHistoryRow[]; locale?: Locale }) {
  const dict = getDict(locale);
  const t = dict.upload;
  const statusLabels = dict.board.status;
  if (rows.length === 0) {
    return (
      <div className="text-sm italic text-gray-500 px-4 py-8 text-center bg-gray-50 border border-gray-200 rounded-sm">
        {t.histEmpty}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
            <th className="text-left pb-2 pr-3 font-medium">{t.thUploadedAt}</th>
            <th className="text-left pb-2 pr-3 font-medium">{t.thFilename}</th>
            <th className="text-left pb-2 pr-3 font-medium">{t.thPeriod}</th>
            <th className="text-left pb-2 pr-3 font-medium">{t.thVersion}</th>
            <th className="text-left pb-2 pr-3 font-medium">{t.thBy}</th>
            <th className="text-left pb-2 pr-3 font-medium">{t.thStatus}</th>
            <th className="text-left pb-2 pr-3 font-medium">{t.thNotes}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.file_id} className="border-b border-gray-100 last:border-b-0">
              <td className="py-2 pr-3 tabular-nums whitespace-nowrap text-gray-700">
                {formatLocaleDateTime(row.uploaded_at, locale)}
              </td>
              <td className="py-2 pr-3 text-navy truncate max-w-[260px]" title={row.filename}>
                {row.filename}
              </td>
              <td className="py-2 pr-3 whitespace-nowrap">
                <a
                  href={`/admin/review/${row.period_year}/${row.period_month}`}
                  className="text-navy underline hover:no-underline"
                  title={formatPeriod(row.period_year, row.period_month, locale)}
                >
                  {formatPeriod(row.period_year, row.period_month, locale)}
                </a>
              </td>
              <td className="py-2 pr-3 whitespace-nowrap">
                <VersionPill row={row} t={t} />
              </td>
              <td className="py-2 pr-3 truncate max-w-[200px] text-gray-700" title={row.uploaded_by}>
                {row.uploaded_by}
              </td>
              <td className="py-2 pr-3 whitespace-nowrap">
                <StatusBadge status={row.status} statusLabels={statusLabels} />
              </td>
              <td className="py-2 pr-3 text-xs text-gray-500">
                <div className="flex flex-wrap gap-2">
                  <span className="font-mono" title={`Full SHA-256: ${row.file_hash}`}>
                    {row.file_hash_prefix}
                  </span>
                  {row.has_total_discrepancy && (
                    <span className="bg-amber-50 border border-amber-200 text-amber-900 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm">
                      {t.totalMismatch}
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 text-xs italic text-gray-500">
        {t.histFooter(rows.length)}
      </div>
    </div>
  );
}
