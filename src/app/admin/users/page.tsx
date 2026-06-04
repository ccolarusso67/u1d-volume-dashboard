/**
 * src/app/admin/users/page.tsx
 *
 * Admin-only user management. Lists u1d_ops.users and renders the client
 * manager. Middleware enforces auth on /admin/*; this page additionally
 * requires the admin role (viewers are redirected to /admin).
 */
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Nav } from "@/components/nav";
import { HeroHeader } from "@/components/layout/hero-header";
import { listUsers } from "@/lib/users/manage-users";
import { getDailyTargetGallons, getLineConversionRates } from "@/lib/settings/app-settings";
import { UsersManager } from "@/components/admin/users-manager";
import { getLocale } from "@/lib/i18n/server";
import { getDict } from "@/lib/i18n/dictionaries";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const locale = await getLocale();
  const d = getDict(locale);
  const t = d.adminUsers;
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/login?callbackUrl=/admin/users");
  }
  if (session.user.isAdmin !== true) {
    redirect("/admin");
  }

  const users = await listUsers();
  const dailyTarget = await getDailyTargetGallons();
  const conversionRates = await getLineConversionRates();

  return (
    <main>
      <HeroHeader
        eyebrow={d.common.company}
        title={t.pageTitle}
        subtitle={t.pageSubtitle}
      />
      <Nav current="/admin" />
      <div className="container mx-auto px-8 py-8 max-w-5xl">
        <UsersManager
          initialUsers={users}
          currentEmail={session.user.email}
          initialDailyTarget={dailyTarget}
          initialConversionRates={conversionRates}
          locale={locale}
        />
        <p className="text-xs text-gray-500 italic mt-6">
          {t.pageFootnote}
        </p>
      </div>
    </main>
  );
}
