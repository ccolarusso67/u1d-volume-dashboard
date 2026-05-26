/**
 * src/app/api/admin/lock/[year]/[month]/route.ts
 *
 * PR 003D — POST /api/admin/lock/:year/:month
 *
 * Locks the board period if the readiness contract holds. The actual
 * transaction lives in src/lib/review/lock-period.ts; this route is the
 * thin auth + parse + dispatch shell.
 *
 * Status code matrix:
 *   200 — locked. Body: { ok: true, lockedAt, activeFileId }
 *   400 — invalid year/month or missing email. Body: { ok: false, reasons }
 *   401 — no session
 *   403 — not admin
 *   409 — lock blocked by pending alerts / missing active file / already locked.
 *         Body: { ok: false, reasons: ["pending_package_alerts:N", ...] }
 *   500 — unexpected error
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireAdminSession } from "@/lib/auth/require-admin";
import { lockPeriod } from "@/lib/review/lock-period";
import { getPool } from "@/lib/db-pool";

type Params = { year: string; month: string };

export async function POST(
  _req: NextRequest,
  context: { params: Promise<Params> }
) {
  const authResult = await requireAdminSession(() => auth());
  if (!authResult.ok) {
    return NextResponse.json(authResult.body, { status: authResult.status });
  }
  const email = authResult.session.user?.email;
  if (!email) {
    return NextResponse.json(
      { ok: false, reasons: ["no_email"] },
      { status: 400 }
    );
  }

  const { year: yearStr, month: monthStr } = await context.params;
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return NextResponse.json(
      { ok: false, reasons: ["invalid_path_params"] },
      { status: 400 }
    );
  }

  try {
    const result = await lockPeriod(getPool(), year, month, email);
    if (result.ok) {
      return NextResponse.json(result, { status: 200 });
    }
    // Differentiate validation errors (400) from contract-blocked (409).
    const validationReasons = new Set(["invalid_year", "invalid_month", "locked_by_required"]);
    const isValidationOnly = result.reasons.every((r) => validationReasons.has(r));
    return NextResponse.json(result, { status: isValidationOnly ? 400 : 409 });
  } catch (err) {
    console.error("[lock] unexpected error:", err);
    return NextResponse.json(
      { ok: false, reasons: ["internal_error"] },
      { status: 500 }
    );
  }
}
