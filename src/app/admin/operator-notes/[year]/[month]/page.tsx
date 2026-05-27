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

export const dynamic = "force-dynamic";

type Params = { year: string; month: string };

function formatLocaleDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.valueOf())) return iso;
  return d.toLocaleString("en-US", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export default async function OperatorNotesPage({
  params,
}: {
  params: Promise<Params>;
}) {
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
          eyebrow="U1DYNAMICS MANUFACTURING LLC"
          title={`Operator Notes — ${formatPeriod(year, month, "en")}`}
          subtitle="Could not load notes for this period."
        />
        <Nav current="/admin/operator-notes" />
        <div className="container mx-auto px-8 py-8 max-w-3xl">
          <div role="alert" className="bg-red-50 border border-red-200 text-red-900 rounded-sm px-4 py-3 text-sm">
            <div className="font-semibold">Could not load notes</div>
            <div className="text-xs mt-1 font-mono">
              {err instanceof Error ? err.message : "Unknown error"}
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main>
      <HeroHeader
        eyebrow="U1DYNAMICS MANUFACTURING LLC"
        title={`Operator Notes — ${formatPeriod(year, month, "en")}`}
        subtitle={
          <>
            {notes.is_complete ? (
              <>Marked complete on {formatLocaleDateTime(notes.completed_at)} by {notes.completed_by ?? "—"}.</>
            ) : notes.exists ? (
              <>Draft last updated {formatLocaleDateTime(notes.updated_at)} by {notes.updated_by ?? "—"}. Not yet complete.</>
            ) : (
              <>No notes saved yet for this period.</>
            )}
            <span className="mx-2">·</span>
            <a href={`/admin/review/${year}/${month}`} className="underline opacity-90 hover:opacity-100">Open review</a>
            <span className="mx-2">·</span>
            <a href="/admin/upload" className="underline opacity-90 hover:opacity-100">Back to upload</a>
          </>
        }
      />
      <Nav current="/admin/operator-notes" />

      <div className="container mx-auto px-8 py-8 max-w-3xl space-y-6">
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <h2 className="font-heading text-base font-bold text-navy mb-1">
            Monthly operator narrative
          </h2>
          <p className="text-xs text-gray-500 mb-5">
            These five sections feed the board deck's operator-narrative
            slides. Save drafts as you work. The period cannot be locked
            until every section has content AND you click <strong>Mark
            complete</strong>.
          </p>
          <OperatorNotesForm
            year={year}
            month={month}
            initialNotes={notes}
          />
        </section>
      </div>
    </main>
  );
}
