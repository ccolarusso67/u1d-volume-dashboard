/**
 * src/app/api/admin/reopen/[year]/[month]/route.ts
 *
 * PR 003F — POST /api/admin/reopen/:year/:month
 *
 * Status code matrix:
 *   200 — { ok: true, reopenedAt: "ISO" }
 *   400 — { ok: false, reasons: [...] } for invalid_path_params /
 *         invalid_year / invalid_month / reopened_by_required
 *   401 — no session
 *   403 — not admin
 *   404 — no_board_period_row (period doesn't exist yet)
 *   409 — not_locked (period is currently in some other status)
 *   500 — unexpected
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireAdminSession } from "@/lib/auth/require-admin";
import { reopenPeriod } from "@/lib/review/reopen-period";
import { getPool } from "@/lib/db-pool";

type Params = { year: string; month: string };

export async function POST(
  _req: NextRequest,
  context: { params: Promise<Params> }
) {
  const a = await requireAdminSession(() => auth());
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });
  const email = a.session.user?.email;
  if (!email) {
    return NextResponse.json(
      { ok: false, reasons: ["no_email"] },
      { status: 400 }
    );
  }

  const { year: y, month: m } = await context.params;
  const year = parseInt(y, 10);
  const month = parseInt(m, 10);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return NextResponse.json(
      { ok: false, reasons: ["invalid_path_params"] },
      { status: 400 }
    );
  }

  try {
    const result = await reopenPeriod(getPool(), year, month, email);
    if (result.ok) {
      return NextResponse.json(result, { status: 200 });
    }
    // Map reasons to specific HTTP codes for legibility.
    const validationOnly = new Set(["invalid_year", "invalid_month", "reopened_by_required"]);
    if (result.reasons.every((r) => validationOnly.has(r))) {
      return NextResponse.json(result, { status: 400 });
    }
    if (result.reasons.includes("no_board_period_row")) {
      return NextResponse.json(result, { status: 404 });
    }
    // not_locked is the most common operator-error; surface as conflict.
    return NextResponse.json(result, { status: 409 });
  } catch (err) {
    console.error("[reopen] unexpected error:", err);
    return NextResponse.json(
      { ok: false, reasons: ["internal_error"] },
      { status: 500 }
    );
  }
}
