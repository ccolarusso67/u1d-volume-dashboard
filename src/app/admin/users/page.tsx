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
import { getDailyTargetGallons } from "@/lib/settings/app-settings";
import { UsersManager } from "@/components/admin/users-manager";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/login?callbackUrl=/admin/users");
  }
  if (session.user.isAdmin !== true) {
    redirect("/admin");
  }

  const users = await listUsers();
  const dailyTarget = await getDailyTargetGallons();

  return (
    <main>
      <HeroHeader
        eyebrow="U1DYNAMICS MANUFACTURING LLC"
        title="Users & Access"
        subtitle="Add board members and admins, set roles, and manage passwords."
      />
      <Nav current="/admin" />
      <div className="container mx-auto px-8 py-8 max-w-5xl">
        <UsersManager
          initialUsers={users}
          currentEmail={session.user.email}
          initialDailyTarget={dailyTarget}
        />
        <p className="text-xs text-gray-500 italic mt-6">
          Admins can upload and lock the monthly close; viewers have read-only access.
          Sign-in requires an active account with a password set here.
        </p>
      </div>
    </main>
  );
}
