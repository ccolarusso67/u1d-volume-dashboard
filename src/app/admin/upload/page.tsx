/**
 * src/app/admin/upload/page.tsx
 *
 * PR 003C — Admin upload landing.
 *
 * Server component:
 *   - Authentication gate (defense in depth — middleware already gates).
 *   - Loads the latest 20 upload-history rows from u1d_ops.volume_files.
 *   - Renders the client UploadForm + the server-rendered history table.
 *
 * Runs on the Node runtime (default) so it can talk to Postgres.
 */
import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import { Pool } from "pg";
import { Nav } from "@/components/nav";
import { HeroHeader } from "@/components/layout/hero-header";
import { UploadForm } from "@/components/admin/upload-form";
import { UploadHistoryTable } from "@/components/admin/upload-history-table";
import { listUploadHistory } from "@/lib/upload/list-upload-history";
import { getLocale } from "@/lib/i18n/server";
import { getDict } from "@/lib/i18n/dictionaries";

export const dynamic = "force-dynamic";

function getPool(): Pool {
  const g = globalThis as unknown as { __u1dPgPool?: Pool };
  if (!g.__u1dPgPool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
    g.__u1dPgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : undefined,
    });
  }
  return g.__u1dPgPool;
}

export default async function UploadPage() {
  const locale = await getLocale();
  const dict = getDict(locale);
  const t = dict.upload;
  const session = await auth();
  // Middleware redirects unauthenticated users to /login. This re-check is
  // belt + suspenders, and additionally enforces the admin-only constraint
  // (middleware only enforces "signed in").
  if (!session?.user?.email) {
    redirect("/login?callbackUrl=/admin/upload");
  }
  if (session.user.isAdmin !== true) {
    redirect("/?error=forbidden");
  }

  // History lookup is best-effort: if the DB is down we still render the
  // upload form so an admin can at least see the page. The history slot
  // surfaces the error inline.
  let historyRows: Awaited<ReturnType<typeof listUploadHistory>> = [];
  let historyError: string | null = null;
  try {
    historyRows = await listUploadHistory(getPool(), 20);
  } catch (err) {
    historyError = err instanceof Error ? err.message : t.unknownErrorHistory;
  }

  return (
    <main>
      <HeroHeader
        eyebrow={dict.common.company}
        title={t.title}
        subtitle={t.subtitle}
        meta={
          <>
            {t.signedInAs(session.user.email)}<br />
            <a href="/admin" className="underline hover:opacity-100 opacity-90">{t.backToAdmin}</a>
          </>
        }
      />
      <Nav current="/admin/upload" />

      <div className="container mx-auto px-8 py-8 max-w-5xl space-y-8">
        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <h2 className="font-heading text-xl font-bold text-navy mb-1">
            {t.uploadReport}
          </h2>
          <p className="text-xs text-gray-500 mb-5">
            {t.uploadReportNote}
          </p>
          <UploadForm locale={locale} />
        </section>

        <section className="bg-white border border-gray-200 rounded-sm p-6">
          <div className="flex items-baseline justify-between mb-1">
            <h2 className="font-heading text-xl font-bold text-navy">
              {t.recentUploads}
            </h2>
            <span className="text-xs text-gray-500 italic">{t.latest20}</span>
          </div>
          <p className="text-xs text-gray-500 mb-5">
            {t.recentNote}
          </p>
          {historyError ? (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 text-red-900 rounded-sm px-4 py-3 text-sm"
            >
              <div className="font-semibold">{t.couldNotLoadHistory}</div>
              <div className="text-xs mt-1 font-mono">{historyError}</div>
            </div>
          ) : (
            <UploadHistoryTable rows={historyRows} locale={locale} />
          )}
        </section>

        <section className="bg-gray-50 border border-gray-200 rounded-sm p-4">
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="text-xs text-gray-600 hover:text-navy underline"
            >
              {dict.admin.signOut}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
