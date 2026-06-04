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
import { getDict } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locale";

type PeriodsDict = ReturnType<typeof getDict>["periods"];

function formatLocaleDateTime(iso: string | null, locale: Locale): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.valueOf())) return iso;
  return d.toLocaleString(locale === "es" ? "es-ES" : "en-US", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function StatusBadge({ status, statusLabels }: { status: string | null; statusLabels: Record<string, string> }) {
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
      {statusLabels[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

function NotesBadge({ exists, complete, t }: { exists: boolean; complete: boolean; t: PeriodsDict }) {
  if (complete) {
    return <span className="inline-block text-[10px] uppercase tracking-wider font-semibold bg-emerald-50 text-emerald-900 px-2 py-0.5 rounded-sm">{t.notesComplete}</span>;
  }
  if (exists) {
    return <span className="inline-block text-[10px] uppercase tracking-wider font-semibold bg-amber-50 text-amber-900 px-2 py-0.5 rounded-sm">{t.notesDraft}</span>;
  }
  return <span className="inline-block text-[10px] uppercase tracking-wider font-semibold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-sm">{t.notesMissing}</span>;
}

function ReadinessBadge({
  ready, status, blockers, t, locale,
}: {
  ready: boolean;
  status: string | null;
  blockers: string[];
  t: PeriodsDict;
  locale: Locale;
}) {
  if (status === "locked") {
    return <span className="inline-block text-[10px] uppercase tracking-wider font-semibold bg-emerald-50 text-emerald-900 px-2 py-0.5 rounded-sm">{t.readyLocked}</span>;
  }
  if (ready) {
    return <span className="inline-block text-[10px] uppercase tracking-wider font-semibold bg-emerald-50 text-emerald-900 px-2 py-0.5 rounded-sm">{t.ready}</span>;
  }
  return (
    <span
      className="inline-block text-[10px] uppercase tracking-wider font-semibold bg-amber-50 text-amber-900 px-2 py-0.5 rounded-sm"
      title={formatBlockerLabels(blockers, locale).join("\n")}
    >
      {t.blocked}
    </span>
  );
}

function ActionButton({
  label, href, tone, t,
}: { label: string; href: string; tone: NextActionTone; t: PeriodsDict }) {
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
      {t.actions[label] ?? label}
    </a>
  );
}

function AlertChips({
  pkg, cust, dq, t,
}: { pkg: number; cust: number; dq: number; t: PeriodsDict }) {
  const total = pkg + cust + dq;
  if (total === 0) {
    return <span className="text-[11px] text-gray-400 italic">—</span>;
  }
  return (
    <span className="text-xs whitespace-nowrap">
      {pkg > 0 && (
        <span className="bg-amber-50 border border-amber-200 text-amber-900 px-1.5 py-0.5 rounded-sm mr-1">
          {pkg} {t.alertPkg}
        </span>
      )}
      {cust > 0 && (
        <span className="bg-amber-50 border border-amber-200 text-amber-900 px-1.5 py-0.5 rounded-sm mr-1">
          {cust} {t.alertCust}
        </span>
      )}
      {dq > 0 && (
        <span className="bg-amber-50 border border-amber-200 text-amber-900 px-1.5 py-0.5 rounded-sm">
          {dq} {t.alertDq}
        </span>
      )}
    </span>
  );
}

export function PeriodsTable({ rows, locale = "en" }: { rows: PeriodIndexRow[]; locale?: Locale }) {
  const t = getDict(locale).periods;
  if (rows.length === 0) {
    return (
      <div className="text-sm italic text-gray-500 px-4 py-8 text-center bg-gray-50 border border-gray-200 rounded-sm">
        {t.emptyPre}{" "}
        <a href="/admin/upload" className="text-navy underline">/admin/upload</a> {t.emptyPost}
      </div>
    );
  }

  const statusLabels = getDict(locale).board.status;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
            <th className="text-left pb-2 pr-3 font-medium">{t.thPeriod}</th>
            <th className="text-left pb-2 pr-3 font-medium">{t.thStatus}</th>
            <th className="text-left pb-2 pr-3 font-medium">{t.thActiveFile}</th>
            <th className="text-left pb-2 pr-3 font-medium">{t.thUploaded}</th>
            <th className="text-left pb-2 pr-3 font-medium">{t.thAlerts}</th>
            <th className="text-left pb-2 pr-3 font-medium">{t.thNotes}</th>
            <th className="text-left pb-2 pr-3 font-medium">{t.thLock}</th>
            <th className="text-right pb-2 pr-3 font-medium">{t.thNextAction}</th>
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
                <StatusBadge status={row.status} statusLabels={statusLabels} />
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
                  <span className="text-[11px] italic text-gray-400">{t.none}</span>
                )}
              </td>
              <td className="py-2.5 pr-3 text-xs text-gray-700 whitespace-nowrap">
                {row.activeFile ? (
                  <div>
                    <div>{formatLocaleDateTime(row.activeFile.uploaded_at, locale)}</div>
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
                  t={t}
                />
              </td>
              <td className="py-2.5 pr-3 whitespace-nowrap">
                <NotesBadge
                  exists={row.operatorNotes.exists}
                  complete={row.operatorNotes.complete}
                  t={t}
                />
              </td>
              <td className="py-2.5 pr-3 whitespace-nowrap">
                <ReadinessBadge
                  ready={row.readiness.ready}
                  status={row.status}
                  blockers={row.readiness.blockers}
                  t={t}
                  locale={locale}
                />
              </td>
              <td className="py-2.5 pr-3 text-right">
                <ActionButton {...row.nextAction} t={t} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-gray-500 italic">
        {t.footer}
      </p>
    </div>
  );
}
