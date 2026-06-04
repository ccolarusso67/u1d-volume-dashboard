/**
 * src/app/admin/operator-notes/[year]/[month]/page.tsx
 *
 * PR 003E — Server component for the operator-notes editor.
 *
 * Auth + admin gate. Loads the current notes via getOperatorNotes() and
 * hands the OperatorNotesForm (client) the initial values. Form state is
 * client-only — the server doesn't re-render on each keystroke.
 */
import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { Nav } from "@/components/nav";
import { HeroHeader } from "@/components/layout/hero-header";
import { getPool } from "@/lib/db-pool";
import { getOperatorNotes } from "@/lib/operator-notes/get-operator-notes";
import { OperatorNotesForm } from "@/components/admin/operator-notes-form";
import { formatPeriod } from "@/lib/brand";
import { getLocale } from "@/lib/i18n/server";
import { getDict } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locale";

export const dynamic = "force-dynamic";

type Params = { year: string; month: string };

function formatLocaleDateTime(iso: string | null, locale: Locale): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.valueOf())) return iso;
  return d.toLocaleString(locale === "es" ? "es-ES" : "en-US", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export default async function OperatorNotesPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const locale = await getLocale();
  const dict = getDict(locale);
  const t = dict.operatorNotes;
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/login?callbackUrl=/admin");
  }
  if (session.user.isAdmin !== true) {
    redirect("/?error=forbidden");
  }

  const { year: y, month: m } = await params;
  const year = parseInt(y, 10);
  const month = parseInt(m, 10);
  if (
    !Number.isInteger(year) || year < 2020 || year > 2100 ||
    !Number.isInteger(month) || month < 1 || month > 12
  ) {
    notFound();
  }

  let notes: Awaited<ReturnType<typeof getOperatorNotes>>;
  try {
    notes = await getOperatorNotes(getPool(), year, month);
  } catch (err) {
    return (
      <main>
        <HeroHeader
          eyebrow={dict.common.company}
          title={t.title(formatPeriod(year, month, locale))}
          subtitle={t.couldNotLoadSubtitle}
        />
        <Nav current="/admin/operator-notes" />
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

  return (
    <main>
      <HeroHeader
        eyebrow={dict.common.company}
        title={t.title(formatPeriod(year, month, locale))}
        subtitle={
          <>
            {notes.is_complete ? (
              <>{t.completeOn(formatLocaleDateTime(notes.completed_at, locale), notes.completed_by ?? "—")}</>
            ) : notes.exists ? (
              <>{t.draftUpdated(formatLocaleDateTime(notes.updated_at, locale), notes.updated_by ?? "—")}</>
            ) : (
              <>{t.noNotes}</>
            )}
            <span className="mx-2">·</span>
            <a href={`/admin/review/${year}/${month}`} className="underline opacity-90 hover:opacity-100">{t.openReview}</a>
            <span className="mx-2">·</span>
            <a href="/admin/upload" className="underline opacity-90 hover:opacity-100">{t.backToUpload}</a>
          </>
        }
      />
      <Nav current="/admin/operator-notes" />

      <div className="container mx-auto px-8 py-8 max-w-3xl space-y-6">
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <h2 className="font-heading text-base font-bold text-navy mb-1">
            {t.narrativeTitle}
          </h2>
          <p className="text-xs text-gray-500 mb-5">
            {t.narrativeIntroPre} <strong>{t.markComplete}</strong>{t.narrativeIntroPost}
          </p>
          <OperatorNotesForm
            year={year}
            month={month}
            initialNotes={notes}
            locale={locale}
          />
        </section>
      </div>
    </main>
  );
}
