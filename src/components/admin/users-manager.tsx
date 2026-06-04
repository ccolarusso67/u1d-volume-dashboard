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
import { getDict } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locale";

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

const CONVERSION_LINES = ["Line 1", "Line 2", "Line 3", "Line 4", "Line 5", "Line 6"];

export function UsersManager({
  initialUsers,
  currentEmail,
  initialDailyTarget,
  initialConversionRates = {},
  locale = "en",
}: {
  initialUsers: ManagedUser[];
  currentEmail: string;
  initialDailyTarget: number;
  initialConversionRates?: Record<string, number>;
  locale?: Locale;
}) {
  const t = getDict(locale).adminUsers;
  const ERR = t.err;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // add-user form
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<ManagedRole>("viewer");
  // per-row password inputs
  const [pw, setPw] = useState<Record<string, string>>({});
  // volume-goal daily target
  const [dailyTarget, setDailyTarget] = useState(String(initialDailyTarget));
  // per-line conversion rates ($/gal)
  const [convRates, setConvRates] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      CONVERSION_LINES.map((k) => [k, initialConversionRates[k] != null ? String(initialConversionRates[k]) : ""])
    )
  );

  async function saveConversionRates() {
    setBusy(true);
    setNotice(null);
    try {
      const payload: Record<string, number> = {};
      for (const k of CONVERSION_LINES) {
        const v = Number(convRates[k]);
        if (Number.isFinite(v) && v > 0) payload[k] = v;
      }
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineConversionRates: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setNotice({ kind: "err", text: t.convCouldNotSave });
      } else {
        setNotice({ kind: "ok", text: t.convSaved });
        router.refresh();
      }
    } catch {
      setNotice({ kind: "err", text: ERR.internal_error });
    } finally {
      setBusy(false);
    }
  }

  async function saveDailyTarget() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyTarget: Number(dailyTarget) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setNotice({ kind: "err", text: t.couldNotSaveTarget });
      } else {
        setNotice({ kind: "ok", text: t.targetUpdated });
        router.refresh();
      }
    } catch {
      setNotice({ kind: "err", text: ERR.internal_error });
    } finally {
      setBusy(false);
    }
  }

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

      {/* Volume goal setting */}
      <section className="bg-white border border-gray-200 rounded-sm p-5">
        <h2 className="font-heading text-lg font-bold text-navy mb-3">{t.volumeGoal}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {t.dailyTargetLabel}
            </label>
            <input
              type="number"
              min={1}
              value={dailyTarget}
              onChange={(e) => setDailyTarget(e.target.value)}
              className="w-40 border border-gray-300 rounded-sm px-3 py-2 text-sm"
            />
          </div>
          <button
            disabled={busy || !(Number(dailyTarget) > 0)}
            onClick={saveDailyTarget}
            className="bg-navy hover:bg-navy-deep disabled:opacity-50 text-white text-sm px-4 py-2 rounded-sm"
          >
            {t.save}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          {t.volumeGoalNote}
        </p>
      </section>

      {/* Per-line conversion cost */}
      <section className="bg-white border border-gray-200 rounded-sm p-5">
        <h2 className="font-heading text-lg font-bold text-navy mb-1">{t.convTitle}</h2>
        <p className="text-xs text-gray-500 mb-4">{t.convNote}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          {CONVERSION_LINES.map((k) => (
            <div key={k}>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                {t.convLineLabels[k] ?? k}
              </label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-gray-500">$</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={convRates[k] ?? ""}
                  onChange={(e) => setConvRates((s) => ({ ...s, [k]: e.target.value }))}
                  placeholder="0.00"
                  className="w-28 border border-gray-300 rounded-sm px-2 py-1.5 text-sm"
                />
                <span className="text-xs text-gray-400">/gal</span>
              </div>
            </div>
          ))}
        </div>
        <button
          disabled={busy}
          onClick={saveConversionRates}
          className="bg-navy hover:bg-navy-deep disabled:opacity-50 text-white text-sm px-4 py-2 rounded-sm"
        >
          {t.convSave}
        </button>
      </section>

      {/* Add user */}
      <section className="bg-white border border-gray-200 rounded-sm p-5">
        <h2 className="font-heading text-lg font-bold text-navy mb-3">{t.addUser}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
          <div className="sm:col-span-5">
            <label className="block text-xs font-medium text-gray-700 mb-1">{t.email}</label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder={t.emailPlaceholder}
              className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm"
            />
          </div>
          <div className="sm:col-span-4">
            <label className="block text-xs font-medium text-gray-700 mb-1">{t.name}</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t.namePlaceholder}
              className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">{t.role}</label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as ManagedRole)}
              className="w-full border border-gray-300 rounded-sm px-2 py-2 text-sm bg-white"
            >
              <option value="viewer">{t.roleViewer}</option>
              <option value="admin">{t.roleAdmin}</option>
            </select>
          </div>
          <div className="sm:col-span-1">
            <button
              disabled={busy || !newEmail}
              onClick={async () => {
                await post(
                  { action: "create", email: newEmail, display_name: newName || null, role: newRole },
                  t.userAdded
                );
                setNewEmail("");
                setNewName("");
                setNewRole("viewer");
              }}
              className="w-full bg-navy hover:bg-navy-deep disabled:opacity-50 text-white text-sm px-3 py-2 rounded-sm"
            >
              {t.add}
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          {t.addUserNote}
        </p>
      </section>

      {/* User list */}
      <section className="bg-white border border-gray-200 rounded-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-[11px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2 font-medium">{t.thUser}</th>
              <th className="text-left px-3 py-2 font-medium">{t.role}</th>
              <th className="text-left px-3 py-2 font-medium">{t.thStatus}</th>
              <th className="text-left px-3 py-2 font-medium">{t.thPassword}</th>
              <th className="text-right px-4 py-2 font-medium">{t.thActions}</th>
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
                          {t.you}
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
                      <option value="viewer">{t.roleViewer}</option>
                      <option value="admin">{t.roleAdmin}</option>
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <button
                      disabled={busy || self}
                      onClick={() =>
                        post(
                          { action: "set_active", email: u.email, active: !u.is_active },
                          u.is_active ? t.userDeactivated : t.userActivated
                        )
                      }
                      className={
                        "text-xs px-2 py-1 rounded-sm border disabled:opacity-50 " +
                        (u.is_active
                          ? "border-emerald-300 text-emerald-800 bg-emerald-50"
                          : "border-gray-300 text-gray-500 bg-gray-50")
                      }
                    >
                      {u.is_active ? t.active : t.inactive}
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="password"
                        value={pw[u.email] ?? ""}
                        onChange={(e) => setPw((s) => ({ ...s, [u.email]: e.target.value }))}
                        placeholder={u.has_password ? t.newPasswordPh : t.setPasswordPh}
                        className="w-32 border border-gray-300 rounded-sm px-2 py-1 text-xs"
                      />
                      <button
                        disabled={busy || (pw[u.email] ?? "").length < 8}
                        onClick={async () => {
                          await post(
                            { action: "set_password", email: u.email, password: pw[u.email] },
                            t.passwordSet
                          );
                          setPw((s) => ({ ...s, [u.email]: "" }));
                        }}
                        className="text-xs bg-navy hover:bg-navy-deep disabled:opacity-50 text-white px-2 py-1 rounded-sm"
                      >
                        {t.set}
                      </button>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1">
                      {u.has_password ? t.pwSetHint : t.pwNoneHint}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      disabled={busy || self}
                      onClick={() => {
                        if (confirm(t.deleteConfirm(u.email)))
                          post({ action: "delete", email: u.email }, t.userDeleted);
                      }}
                      className="text-xs text-red-700 hover:text-red-900 disabled:opacity-40"
                    >
                      {t.delete}
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
