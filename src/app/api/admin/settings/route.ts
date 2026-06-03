/**
 * src/app/api/admin/settings/route.ts
 *
 * Admin settings. Currently the editable daily volume target used by the
 * monthly volume goal. Admin-only (middleware + requireAdminSession).
 *
 * GET  → { ok, dailyTarget }
 * POST → { dailyTarget: number } → { ok }
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireAdminSession } from "@/lib/auth/require-admin";
import { getDailyTargetGallons, setDailyTargetGallons } from "@/lib/settings/app-settings";

export async function GET() {
  const a = await requireAdminSession(() => auth());
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });
  const dailyTarget = await getDailyTargetGallons();
  return NextResponse.json({ ok: true, dailyTarget }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const a = await requireAdminSession(() => auth());
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "invalid_json" }, { status: 400 });
  }

  const n = Number(body.dailyTarget);
  if (!Number.isFinite(n) || n <= 0) {
    return NextResponse.json({ ok: false, message: "invalid_target" }, { status: 400 });
  }
  try {
    await setDailyTargetGallons(n, a.session.user?.email ?? undefined);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[admin/settings:POST]", err);
    return NextResponse.json({ ok: false, message: "internal_error" }, { status: 500 });
  }
}
