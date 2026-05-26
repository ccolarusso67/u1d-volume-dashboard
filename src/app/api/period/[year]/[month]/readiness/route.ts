/**
 * src/app/api/period/[year]/[month]/readiness/route.ts
 *
 * PR 003E — Lock-readiness contract endpoint.
 *
 * GET → returns the period's readiness state as a stable JSON contract
 * the UI lock button, the Phase 2 deck generator, and any future MCP
 * tool can consume:
 *
 *   {
 *     period: { year, month },
 *     ready: boolean,
 *     blockers: string[],          // stable codes
 *     active_file_id: number | null,
 *     locked_at: string | null,
 *     operator_notes: {
 *       exists: boolean,
 *       complete: boolean,
 *       completed_at: string | null,
 *       completed_by: string | null
 *     },
 *     alert_counts: {
 *       pending_package: number,
 *       pending_customer: number,
 *       pending_data_quality: number
 *     },
 *     computed_at: "<ISO>"
 *   }
 *
 * Admin-only for now. When the Phase 2 deck generator gets a service
 * account, expand the auth path to accept either.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireAdminSession } from "@/lib/auth/require-admin";
import { getPool } from "@/lib/db-pool";
import { getPeriodReview } from "@/lib/review/get-period-review";

type Params = { year: string; month: string };

export async function GET(
  _req: NextRequest,
  context: { params: Promise<Params> }
) {
  const a = await requireAdminSession(() => auth());
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });

  const { year: y, month: m } = await context.params;
  const year = parseInt(y, 10);
  const month = parseInt(m, 10);
  if (
    !Number.isInteger(year) || year < 2020 || year > 2100 ||
    !Number.isInteger(month) || month < 1 || month > 12
  ) {
    return NextResponse.json(
      { ok: false, reason: "invalid_path_params" },
      { status: 400 }
    );
  }

  try {
    const review = await getPeriodReview(getPool(), year, month, {
      volumeFactLimit: 1, // we don't need the fact preview here
    });
    return NextResponse.json(
      {
        period: { year, month },
        ready: review.canLock,
        blockers: review.lockBlockedReasons,
        active_file_id: review.activeFile?.file_id ?? null,
        locked_at: review.period.locked_at,
        operator_notes: {
          exists: review.operatorNotes.exists,
          complete: review.operatorNotes.is_complete,
          completed_at: review.operatorNotes.completed_at,
          completed_by: review.operatorNotes.completed_by,
        },
        alert_counts: {
          pending_package: review.alertSummary.pendingPackageAlerts,
          pending_customer: review.alertSummary.pendingCustomerAlerts,
          pending_data_quality: review.alertSummary.pendingDataQualityAlerts,
        },
        computed_at: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[readiness] error:", err);
    return NextResponse.json(
      { ok: false, reason: "internal_error" },
      { status: 500 }
    );
  }
}
