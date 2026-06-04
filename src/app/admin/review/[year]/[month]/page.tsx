/**
 * src/app/admin/review/[year]/[month]/page.tsx
 *
 * PR 003D — Per-period review page.
 *
 * Server component:
 *   - Auth + admin gate (defense in depth on top of middleware).
 *   - Parses year/month from path.
 *   - Calls getPeriodReview() + small catalog queries (packages, customers).
 *   - Composes summary cards, active-file detail, prior-versions table,
 *     three alert panels (client), volume-fact preview, and the lock button.
 */
import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { Nav } from "@/components/nav";
import { HeroHeader } from "@/components/layout/hero-header";
import { getPool } from "@/lib/db-pool";
import { getPeriodReview } from "@/lib/review/get-period-review";
import { formatPeriod, fmtNum, fmtPct } from "@/lib/brand";
import type {
  BoardPeriodStatus,
  PackageOption,
  CustomerOption,
} from "@/lib/review/types";

import { PackageAlertsPanel } from "@/components/admin/review/package-alerts-panel";
import { CustomerAlertsPanel } from "@/components/admin/review/customer-alerts-panel";
import { DataQualityAlertsPanel } from "@/components/admin/review/data-quality-alerts-panel";
import { LockPeriodButton } from "@/components/admin/review/lock-period-button";
import { ReopenPeriodButton } from "@/components/admin/review/reopen-period-button";
import { LockHistoryPanel } from "@/components/admin/review/lock-history-panel";
import { getLocale } from "@/lib/i18n/server";
import { getDict } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locale";

export const dynamic = "force-dynamic";

type Params = { year: string; month: string };

async function loadCatalogOptions(): Promise<{
  packageOptions: PackageOption[];
  customerOptions: CustomerOption[];
}> {
  const pool = getPool();
  const [pkgs, custs] = await Promise.all([
    pool.query<{ package_key: string; display_name: string; family: string }>(
      `SELECT package_key, display_name, family
         FROM u1d_ops.packages
        ORDER BY sort_order`
    ),
    pool.query<{ customer_key: string; display_name: string }>(
      `SELECT customer_key, display_name
         FROM u1d_ops.customers
        ORDER BY is_intercompany DESC, display_name`
    ),
  ]);
  return {
    packageOptions: pkgs.rows,
    customerOptions: custs.rows,
  };
}

function formatLocaleDateTime(iso: string | null, locale: Locale): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.valueOf())) return iso;
  return d.toLocaleString(locale === "es" ? "es-ES" : "en-US", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function StatusBadge({ status, statusLabels, noRow }: { status: BoardPeriodStatus | null; statusLabels: Record<string, string>; noRow: string }) {
  if (!status) {
    return <span className="text-[10px] uppercase tracking-wider text-gray-400">{noRow}</span>;
  }
  const palette: Record<BoardPeriodStatus, string> = {
    open:       "bg-gray-100 text-gray-700",
    staged:     "bg-blue-50 text-blue-800",
    in_review:  "bg-amber-50 text-amber-900",
    locked:     "bg-emerald-50 text-emerald-900",
    superseded: "bg-gray-100 text-gray-500 italic",
    reopened:   "bg-purple-50 text-purple-900",
  };
  return (
    <span
      className={`inline-block text-[11px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-sm ${palette[status]}`}
    >
      {statusLabels[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

export default async function ReviewPage({ params }: { params: Promise<Params> }) {
  const locale = await getLocale();
  const dict = getDict(locale);
  const t = dict.review;
  const statusLabels = dict.board.status;
  const session = await auth();
  if (!session?.user?.email) {
    redirect(`/login?callbackUrl=/admin/review`);
  }
  if (session.user.isAdmin !== true) {
    redirect("/?error=forbidden");
  }

  const { year: yearStr, month: monthStr } = await params;
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (
    !Number.isInteger(year) ||
    year < 2020 || year > 2100 ||
    !Number.isInteger(month) ||
    month < 1 || month > 12
  ) {
    notFound();
  }

  let review: Awaited<ReturnType<typeof getPeriodReview>>;
  let catalog: Awaited<ReturnType<typeof loadCatalogOptions>>;
  try {
    [review, catalog] = await Promise.all([
      getPeriodReview(getPool(), year, month),
      loadCatalogOptions(),
    ]);
  } catch (err) {
    return (
      <main>
        <HeroHeader
          eyebrow={dict.common.company}
          title={t.title(formatPeriod(year, month, locale))}
          subtitle={t.couldNotLoadSubtitle}
        />
        <Nav current="/admin/review" />
        <div className="container mx-auto px-8 py-8 max-w-3xl">
          <div role="alert" className="bg-red-50 border border-red-200 text-red-900 rounded-sm px-4 py-3 text-sm">
            <div className="font-semibold">{t.couldNotLoad}</div>
            <div className="text-xs mt-1 font-mono">
              {err instanceof Error ? err.message : t.unknownError}
            </div>
          </div>
        </div>
      </main>
    );
  }

  const periodLocked = review.period.status === "locked";

  return (
    <main>
      <HeroHeader
        eyebrow={dict.common.company}
        title={t.title(formatPeriod(year, month, locale))}
        subtitle={
          <>
            {review.period.locked_at
              ? t.lockedAtBy(formatLocaleDateTime(review.period.locked_at, locale), review.period.locked_by ?? "—")
              : t.resolveBeforeLock}
            <span className="mx-2">·</span>
            <a href="/admin/upload" className="underline opacity-90 hover:opacity-100">{t.backToUpload}</a>
          </>
        }
        meta={<StatusBadge status={review.period.status} statusLabels={statusLabels} noRow={t.statusNoRow} />}
      />
      <Nav current="/admin/review" />

      <div className="container mx-auto px-8 py-8 max-w-6xl space-y-6">
        {/* Summary cards */}
        <section className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <SummaryCard label={t.cardPendingPackages}    value={fmtNum(review.alertSummary.pendingPackageAlerts, 0, locale)} tone="warn" />
          <SummaryCard label={t.cardPendingCustomers}    value={fmtNum(review.alertSummary.pendingCustomerAlerts, 0, locale)} tone="warn" />
          <SummaryCard label={t.cardPendingDataQuality}  value={fmtNum(review.alertSummary.pendingDataQualityAlerts, 0, locale)} tone="warn" />
          <SummaryCard label={t.cardResolved}            value={fmtNum(review.alertSummary.resolvedAlerts, 0, locale)} tone="ok" />
          <SummaryCard label={t.cardTotalAlerts}         value={fmtNum(review.alertSummary.totalAlerts, 0, locale)} tone="neutral" />
          <SummaryCard
            label={t.cardOperatorNotes}
            value={
              review.operatorNotes.is_complete
                ? t.notesComplete
                : review.operatorNotes.exists
                ? t.notesDraft
                : t.notesMissing
            }
            tone={review.operatorNotes.is_complete ? "ok" : "warn"}
          />
        </section>

        {/* Lock action */}
        <section className="bg-white border border-gray-200 rounded-sm p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="font-heading text-base font-bold text-navy">{t.lockPeriod}</h2>
              <p className="text-xs text-gray-500 mt-1 max-w-xl">
                {t.lockPeriodNotePre} <code>board_periods.status = &apos;locked&apos;</code> {t.lockPeriodNoteMid}{" "}
                <code>volume_files</code> {t.lockPeriodNotePost}
              </p>
            </div>
            <div className="flex flex-col items-end gap-3">
              <LockPeriodButton
                year={year} month={month}
                canLock={review.canLock}
                blockedReasons={review.lockBlockedReasons}
                locale={locale}
              />
              {periodLocked && (
                <ReopenPeriodButton year={year} month={month} locale={locale} />
              )}
            </div>
          </div>
        </section>

        {/* Operator notes */}
        <section className="bg-white border border-gray-200 rounded-sm p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="font-heading text-base font-bold text-navy">
                {t.operatorNotes}
              </h2>
              <p className="text-xs text-gray-500 mt-1 max-w-xl">
                {review.operatorNotes.is_complete
                  ? t.notesCompleteOn(formatLocaleDateTime(review.operatorNotes.completed_at, locale), review.operatorNotes.completed_by ?? "—")
                  : review.operatorNotes.exists
                  ? t.notesDraftNotComplete
                  : t.noNotesYet}
              </p>
            </div>
            <a
              href={`/admin/operator-notes/${year}/${month}`}
              className="bg-navy hover:bg-navy-deep text-white text-sm font-medium px-4 py-2 rounded-sm transition-colors"
            >
              {review.operatorNotes.is_complete ? t.viewNotes : t.openEditor}
            </a>
          </div>
        </section>

        {/* Lock history */}
        <section className="bg-white border border-gray-200 rounded-sm p-5">
          <h2 className="font-heading text-base font-bold text-navy mb-3">
            {t.lockHistory(review.periodEvents.length)}
          </h2>
          <LockHistoryPanel events={review.periodEvents} locale={locale} />
        </section>

        {/* Active file detail */}
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <h2 className="font-heading text-xl font-bold text-navy mb-3">
            {t.activeFile(String(review.activeFile?.version_no ?? "—"))}
          </h2>
          {review.activeFile ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <Detail label={t.detailFilename} value={review.activeFile.filename} mono />
              <Detail label={t.detailFileId} value={String(review.activeFile.file_id)} />
              <Detail label={t.detailVersion} value={`v${review.activeFile.version_no}`} />
              <Detail label={t.detailUploadedBy} value={review.activeFile.uploaded_by} />
              <Detail label={t.detailUploadedAt} value={formatLocaleDateTime(review.activeFile.uploaded_at, locale)} />
              <Detail label={t.detailHashPrefix} value={review.activeFile.file_hash_prefix} mono />
              <Detail label={t.detailTotalReconstructed} value={fmtNum(review.activeFile.computed_customer_sum, 0, locale)} />
              <Detail
                label={t.detailSourceTotal}
                value={
                  review.activeFile.source_total_row !== null
                    ? fmtNum(review.activeFile.source_total_row, 0, locale)
                    : "—"
                }
              />
              <Detail
                label={t.detailDiscrepancy}
                value={
                  review.activeFile.has_total_discrepancy
                    ? t.discFlagged(String(review.activeFile.discrepancy_amount ?? "?"))
                    : t.none
                }
                tone={review.activeFile.has_total_discrepancy ? "warn" : "ok"}
              />
            </div>
          ) : (
            <div className="text-sm italic text-gray-500">
              {t.noActiveFile}
            </div>
          )}
        </section>

        {/* Prior versions */}
        {review.priorVersions.length > 0 && (
          <section className="bg-white border border-gray-200 rounded-sm p-6">
            <h2 className="font-heading text-base font-bold text-navy mb-3">
              {t.priorVersions(review.priorVersions.length)}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                    <th className="text-left pb-2 pr-3 font-medium">{t.thVersion}</th>
                    <th className="text-left pb-2 pr-3 font-medium">{t.thFilename}</th>
                    <th className="text-left pb-2 pr-3 font-medium">{t.thUploadedAt}</th>
                    <th className="text-left pb-2 pr-3 font-medium">{t.thBy}</th>
                    <th className="text-left pb-2 pr-3 font-medium">{t.thHashPrefix}</th>
                    <th className="text-left pb-2 pr-3 font-medium">{t.thFlags}</th>
                  </tr>
                </thead>
                <tbody>
                  {review.priorVersions.map((v) => (
                    <tr key={v.file_id} className="border-b border-gray-100 last:border-b-0">
                      <td className="py-2 pr-3 italic text-gray-500">v{v.version_no}</td>
                      <td className="py-2 pr-3 text-navy truncate max-w-[300px]" title={v.filename}>
                        {v.filename}
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-gray-700 whitespace-nowrap">
                        {formatLocaleDateTime(v.uploaded_at, locale)}
                      </td>
                      <td className="py-2 pr-3 text-gray-700">{v.uploaded_by}</td>
                      <td className="py-2 pr-3 font-mono text-gray-700">{v.file_hash_prefix}</td>
                      <td className="py-2 pr-3 text-xs">
                        {v.has_total_discrepancy && (
                          <span className="bg-amber-50 border border-amber-200 text-amber-900 px-1.5 py-0.5 rounded-sm text-[10px] uppercase tracking-wider">
                            {t.totalMismatch}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Package alerts */}
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <h2 className="font-heading text-base font-bold text-navy mb-3">
            {t.packageAlertsTitle(review.alertSummary.pendingPackageAlerts)}
          </h2>
          <PackageAlertsPanel
            alerts={review.packageAlerts}
            packageOptions={catalog.packageOptions}
            periodLocked={periodLocked}
            locale={locale}
          />
        </section>

        {/* Customer alerts */}
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <h2 className="font-heading text-base font-bold text-navy mb-3">
            {t.customerAlertsTitle(review.alertSummary.pendingCustomerAlerts)}
          </h2>
          <CustomerAlertsPanel
            alerts={review.customerAlerts}
            customerOptions={catalog.customerOptions}
            periodLocked={periodLocked}
            locale={locale}
          />
        </section>

        {/* Data quality alerts */}
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <h2 className="font-heading text-base font-bold text-navy mb-3">
            {t.dataQualityAlertsTitle(review.alertSummary.pendingDataQualityAlerts)}
          </h2>
          <DataQualityAlertsPanel
            alerts={review.dataQualityAlerts}
            periodLocked={periodLocked}
            locale={locale}
          />
        </section>

        {/* Volume fact preview */}
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="font-heading text-base font-bold text-navy">
              {t.volumeDetail}
            </h2>
            <span className="text-xs text-gray-500 italic">
              {t.rowsLabel(review.volumeFacts.length)}
            </span>
          </div>
          {review.volumeFacts.length === 0 ? (
            <div className="mt-3 text-sm italic text-gray-500">{t.noVolumeRows}</div>
          ) : (
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                    <th className="text-left pb-2 pr-3 font-medium">{t.thCustomer}</th>
                    <th className="text-left pb-2 pr-3 font-medium">{t.thPackage}</th>
                    <th className="text-left pb-2 pr-3 font-medium">{t.thFamily}</th>
                    <th className="text-right pb-2 pr-3 font-medium">{t.thGallons}</th>
                    <th className="text-right pb-2 pr-3 font-medium">{t.thShare}</th>
                  </tr>
                </thead>
                <tbody>
                  {review.volumeFacts.map((f, i) => {
                    const share = review.activeFile?.total_gallons
                      ? f.gallons / review.activeFile.total_gallons
                      : 0;
                    return (
                      <tr key={`${f.customer_key}-${f.package_key}-${i}`} className="border-b border-gray-100 last:border-b-0">
                        <td className="py-1.5 pr-3 text-navy">
                          {f.customer_display_name}
                          {f.is_intercompany && (
                            <span className="ml-2 text-[10px] uppercase tracking-wider text-gray-500">{t.intercompShort}</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3">{f.package_display_name}</td>
                        <td className="py-1.5 pr-3 text-gray-500 text-xs uppercase tracking-wider">{f.family}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums font-medium">{fmtNum(f.gallons, 0, locale)}</td>
                        <td className="py-1.5 pr-3 text-right text-gray-500 tabular-nums">{fmtPct(share, 1, false, locale)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

// ----- small server components -----

function SummaryCard({
  label, value, tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "neutral";
}) {
  const palette =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-gray-200 bg-white text-navy";
  return (
    <div className={`border rounded-sm px-4 py-3 ${palette}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="font-heading text-2xl font-bold mt-1 leading-none">{value}</div>
    </div>
  );
}

function Detail({
  label, value, mono = false, tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "ok" | "warn";
}) {
  const valClass = tone === "warn"
    ? "text-amber-900"
    : tone === "ok"
    ? "text-emerald-900"
    : "text-navy";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`${valClass} ${mono ? "font-mono text-xs" : ""}`}>{value}</div>
    </div>
  );
}
