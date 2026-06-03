/**
 * src/app/api/admin/users/route.ts
 *
 * Admin user management. All methods require an admin session
 * (requireAdminSession; middleware already enforces auth on /api/admin/*).
 *
 * GET  → { ok, users }
 * POST → { action, email, ... }
 *   action: "create" | "set_role" | "set_active" | "set_password"
 *         | "clear_password" | "delete"
 *
 * Self-lockout guard: an admin cannot deactivate, demote, delete, or clear
 * the password of their own account.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireAdminSession } from "@/lib/auth/require-admin";
import {
  listUsers,
  createUser,
  setUserRole,
  setUserActive,
  setUserPassword,
  clearUserPassword,
  deleteUser,
  userExists,
  isValidEmail,
  normalizeEmail,
  type ManagedRole,
} from "@/lib/users/manage-users";

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function GET() {
  const a = await requireAdminSession(() => auth());
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });
  try {
    const users = await listUsers();
    return NextResponse.json({ ok: true, users }, { status: 200 });
  } catch (err) {
    console.error("[admin/users:GET]", err);
    return bad("internal_error", 500);
  }
}

export async function POST(req: NextRequest) {
  const a = await requireAdminSession(() => auth());
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });

  const me = (a.session.user?.email ?? "").toLowerCase();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("invalid_json");
  }

  const action = String(body.action ?? "");
  const email = normalizeEmail(String(body.email ?? ""));
  const role = body.role === "admin" ? "admin" : "viewer";
  const isSelf = email === me;

  if (!email || !isValidEmail(email)) return bad("invalid_email");

  try {
    switch (action) {
      case "create": {
        if (await userExists(email)) return bad("user_already_exists", 409);
        const name = body.display_name ? String(body.display_name) : null;
        await createUser(email, name, role as ManagedRole);
        break;
      }
      case "set_role": {
        if (isSelf && role !== "admin") return bad("cannot_demote_self");
        await setUserRole(email, role as ManagedRole);
        break;
      }
      case "set_active": {
        const active = body.active === true;
        if (isSelf && !active) return bad("cannot_deactivate_self");
        if (!(await userExists(email))) return bad("user_not_found", 404);
        await setUserActive(email, active);
        break;
      }
      case "set_password": {
        const password = String(body.password ?? "");
        if (password.length < 8) return bad("password_too_short");
        if (!(await userExists(email))) return bad("user_not_found", 404);
        await setUserPassword(email, password);
        break;
      }
      case "clear_password": {
        if (isSelf) return bad("cannot_clear_own_password");
        await clearUserPassword(email);
        break;
      }
      case "delete": {
        if (isSelf) return bad("cannot_delete_self");
        await deleteUser(email);
        break;
      }
      default:
        return bad("unknown_action");
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[admin/users:POST]", action, err);
    return bad("internal_error", 500);
  }
}
