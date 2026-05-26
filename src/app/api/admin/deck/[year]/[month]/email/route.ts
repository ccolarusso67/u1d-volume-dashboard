/**
 * src/app/api/admin/deck/[year]/[month]/email/route.ts
 *
 * PR 004D — POST /api/admin/deck/:year/:month/email
 *
 * Thin shell over sendBoardDeck. Maps typed errors to stable HTTP codes.
 *
 * Status code matrix:
 *   200 — sent (UploadResult-style success body)
 *   400 — invalid year/month/body/distribution_list_id
 *   401 — no session
 *   403 — not admin
 *   404 — period or distribution list not found
 *   409 — period not ready  OR  recent send already exists
 *   422 — distribution list has no active TO recipients
 *   503 — email provider not configured
 *   500 — unexpected
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireAdminSession } from "@/lib/auth/require-admin";
import { getPool } from "@/lib/db-pool";
import { getBoardEmailProvider, ProviderNotConfiguredError } from "@/lib/email/board-email-provider";
import {
  sendBoardDeck,
  PeriodNotFoundError,
  PeriodNotReadyError,
  DistributionListNotFoundError,
  NoActiveRecipientsError,
  RecentSendExistsError,
  InvalidSendInputError,
} from "@/lib/distribution/send-board-deck";

type Params = { year: string; month: string };

export async function POST(
  req: NextRequest,
  context: { params: Promise<Params> }
) {
  const a = await requireAdminSession(() => auth());
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });
  const email = a.session.user?.email;
  if (!email) {
    return NextResponse.json(
      { ok: false, error: "no_email" },
      { status: 400 }
    );
  }

  const { year: y, month: m } = await context.params;
  const year = parseInt(y, 10);
  const month = parseInt(m, 10);
  if (
    !Number.isInteger(year) || year < 2020 || year > 2100 ||
    !Number.isInteger(month) || month < 1 || month > 12
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid_path_params" },
      { status: 400 }
    );
  }

  let body: {
    distribution_list_id?: unknown;
    subject?: unknown;
    message?: unknown;
    confirm_resend?: unknown;
  };
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_body" },
      { status: 400 }
    );
  }

  const distributionListId = Number(body.distribution_list_id);
  if (!Number.isInteger(distributionListId) || distributionListId <= 0) {
    return NextResponse.json(
      { ok: false, error: "invalid_distribution_list_id" },
      { status: 400 }
    );
  }
  const subjectOverride = typeof body.subject === "string" ? body.subject : undefined;
  const message = typeof body.message === "string" ? body.message : undefined;
  const confirmResend = body.confirm_resend === true;

  try {
    const result = await sendBoardDeck(
      { pool: getPool(), emailProvider: getBoardEmailProvider() },
      {
        year, month,
        distributionListId,
        sentBy: email,
        subjectOverride,
        message,
        confirmResend,
      }
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof InvalidSendInputError) {
      return NextResponse.json(
        { ok: false, error: err.code, message: err.message },
        { status: 400 }
      );
    }
    if (err instanceof PeriodNotFoundError) {
      return NextResponse.json(
        { ok: false, error: "period_not_found" },
        { status: 404 }
      );
    }
    if (err instanceof PeriodNotReadyError) {
      return NextResponse.json(
        { ok: false, error: "period_not_ready", blockers: err.blockers },
        { status: 409 }
      );
    }
    if (err instanceof DistributionListNotFoundError) {
      return NextResponse.json(
        { ok: false, error: "distribution_list_not_found" },
        { status: 404 }
      );
    }
    if (err instanceof NoActiveRecipientsError) {
      return NextResponse.json(
        { ok: false, error: "no_active_recipients" },
        { status: 422 }
      );
    }
    if (err instanceof RecentSendExistsError) {
      return NextResponse.json(
        {
          ok: false,
          error: "recent_send_exists",
          last_sent_at: err.lastSentAt,
          last_sent_by: err.lastSentBy,
        },
        { status: 409 }
      );
    }
    if (err instanceof ProviderNotConfiguredError) {
      return NextResponse.json(
        { ok: false, error: "email_provider_not_configured" },
        { status: 503 }
      );
    }
    console.error("[deck/email] unexpected error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}
