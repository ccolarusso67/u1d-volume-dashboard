"use client";

/**
 * src/components/admin/users-manager.tsx
 *
 * Admin UI for u1d_ops.users: add users, change role, activate/deactivate,
 * set or clear passwords, delete. All mutations POST to /api/admin/users and
 * then refresh the server component. Self-destructive actions are disabled.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

type ManagedRole = "viewer" | "admin";
type ManagedUser = {
  email: string;
  display_name: string | null;
  role: ManagedRole;
  is_active: boolean;
  has_password: boolean;
  last_login_at: string | null;
  created_at: string;
};

const ERR: Record<string, string> = {
  user_already_exists: "That email already exists.",
  cannot_demote_self: "You cannot remove your own admin role.",
  cannot_deactivate_self: "You cannot deactivate your own account.",
  cannot_delete_self: "You cannot delete your own account.",
  cannot_clear_own_password: "You cannot clear your own password.",
  password_too_short: "Password must be at least 8 characters.",
  invalid_email: "Enter a valid email.",
  user_not_found: "User not found.",
  forbidden: "Admin role required.",
  unauthenticated: "Please sign in again.",
  internal_error: "Something went wrong. Try again.",
};

export function UsersManager({
  initialUsers,
  currentEmail,
}: {
  initialUsers: ManagedUser[];
  currentEmail: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // add-user form
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<ManagedRole>("viewer");
  // per-row password inputs
  const [pw, setPw] = useState<Record<string, string>>({});

  async function post(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        const code = (data && (data.message || data.error)) || "internal_error";
        setNotice({ kind: "err", text: ERR[code] ?? code });
      } else {
        setNotice({ kind: "ok", text: okMsg });
        router.refresh();
      }
    } catch {
      setNotice({ kind: "err", text: ERR.internal_error });
    } finally {
      setBusy(false);
    }
  }

  const me = currentEmail.toLowerCase();

  return (
    <div className="space-y-6">
      {notice && (
        <div
          role="status"
          className={
            "text-sm px-4 py-3 rounded-sm border " +
            (notice.kind === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-red-50 border-red-200 text-red-900")
          }
        >
          {notice.text}
        </div>
      )}

      {/* Add user */}
      <section className="bg-white border border-gray-200 rounded-sm p-5">
        <h2 className="font-heading text-lg font-bold text-navy mb-3">Add user</h2>
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
          <div className="sm:col-span-5">
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="person@company.com"
              className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm"
            />
          </div>
          <div className="sm:col-span-4">
            <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Full name"
              className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as ManagedRole)}
              className="w-full border border-gray-300 rounded-sm px-2 py-2 text-sm bg-white"
            >
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <div className="sm:col-span-1">
            <button
              disabled={busy || !newEmail}
              onClick={async () => {
                await post(
                  { action: "create", email: newEmail, display_name: newName || null, role: newRole },
                  "User added."
                );
                setNewEmail("");
                setNewName("");
                setNewRole("viewer");
              }}
              className="w-full bg-navy hover:bg-navy-deep disabled:opacity-50 text-white text-sm px-3 py-2 rounded-sm"
            >
              Add
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          New users start active with no password. Set a password below so they can sign in.
        </p>
      </section>

      {/* User list */}
      <section className="bg-white border border-gray-200 rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-[11px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2 font-medium">User</th>
              <th className="text-left px-3 py-2 font-medium">Role</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Password</th>
              <th className="text-right px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {initialUsers.map((u) => {
              const self = u.email.toLowerCase() === me;
              return (
                <tr key={u.email} className="border-t border-gray-100 align-middle">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">
                      {u.display_name || u.email}
                      {self && (
                        <span className="ml-2 text-[10px] bg-navy/10 text-navy px-1.5 py-0.5 rounded-sm">
                          you
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">{u.email}</div>
                  </td>
                  <td className="px-3 py-3">
                    <select
                      value={u.role}
                      disabled={busy || (self && u.role === "admin")}
                      onChange={(e) =>
                        post({ action: "set_role", email: u.email, role: e.target.value }, "Role updated.")
                      }
                      className="border border-gray-300 rounded-sm px-2 py-1 text-sm bg-white disabled:opacity-60"
                    >
                      <option value="viewer">viewer</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <button
                      disabled={busy || self}
                      onClick={() =>
                        post(
                          { action: "set_active", email: u.email, active: !u.is_active },
                          u.is_active ? "User deactivated." : "User activated."
                        )
                      }
                      className={
                        "text-xs px-2 py-1 rounded-sm border disabled:opacity-50 " +
                        (u.is_active
                          ? "border-emerald-300 text-emerald-800 bg-emerald-50"
                          : "border-gray-300 text-gray-500 bg-gray-50")
                      }
                    >
                      {u.is_active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="password"
                        value={pw[u.email] ?? ""}
                        onChange={(e) => setPw((s) => ({ ...s, [u.email]: e.target.value }))}
                        placeholder={u.has_password ? "new password" : "set password"}
                        className="w-32 border border-gray-300 rounded-sm px-2 py-1 text-xs"
                      />
                      <button
                        disabled={busy || (pw[u.email] ?? "").length < 8}
                        onClick={async () => {
                          await post(
                            { action: "set_password", email: u.email, password: pw[u.email] },
                            "Password set."
                          );
                          setPw((s) => ({ ...s, [u.email]: "" }));
                        }}
                        className="text-xs bg-navy hover:bg-navy-deep disabled:opacity-50 text-white px-2 py-1 rounded-sm"
                      >
                        Set
                      </button>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1">
                      {u.has_password ? "password set · min 8 chars" : "no password · min 8 chars"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      disabled={busy || self}
                      onClick={() => {
                        if (confirm(`Delete ${u.email}? This cannot be undone.`))
                          post({ action: "delete", email: u.email }, "User deleted.");
                      }}
                      className="text-xs text-red-700 hover:text-red-900 disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
