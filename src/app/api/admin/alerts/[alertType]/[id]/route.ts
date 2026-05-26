/**
 * src/app/api/admin/alerts/[alertType]/[id]/route.ts
 *
 * PR 003D — POST /api/admin/alerts/:alertType/:id
 *
 * alertType ∈ { "package" | "customer" | "data_quality" }
 *
 * Request body (JSON):
 *   {
 *     action: "ignored" | "mapped" | "create_alias" | "acknowledged",
 *     mapping_target?: string,
 *     note?: string
 *   }
 *
 * Response:
 *   200 — { ok: true, alertId, newStatus }
 *   400 — bad body, missing mapping_target where required
 *   401 — no session
 *   403 — not admin
 *   404 — alert not pending / not found
 *   500 — unexpected error
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireAdminSession } from "@/lib/auth/require-admin";
import { resolveAlert, type AlertResolution } from "@/lib/review/resolve-alert";
import { getPool } from "@/lib/db-pool";

type Params = { alertType: string; id: string };

const KIND_BY_PATH: Record<string, AlertResolution["kind"]> = {
  package: "package_alert",
  customer: "customer_alert",
  data_quality: "data_quality_alert",
};

const ACTION_BY_KIND: Record<AlertResolution["kind"], string[]> = {
  package_alert: ["ignored", "mapped"],
  customer_alert: ["ignored", "mapped", "create_alias"],
  data_quality_alert: ["acknowledged", "ignored"],
};

export async function POST(
  req: NextRequest,
  context: { params: Promise<Params> }
) {
  const authResult = await requireAdminSession(() => auth());
  if (!authResult.ok) {
    return NextResponse.json(authResult.body, { status: authResult.status });
  }
  const email = authResult.session.user?.email;
  if (!email) {
    return NextResponse.json(
      { ok: false, reason: "no_email" },
      { status: 400 }
    );
  }

  const { alertType, id } = await context.params;
  const kind = KIND_BY_PATH[alertType];
  if (!kind) {
    return NextResponse.json(
      { ok: false, reason: "unknown_alert_type" },
      { status: 400 }
    );
  }
  const alertId = parseInt(id, 10);
  if (!Number.isInteger(alertId) || alertId <= 0) {
    return NextResponse.json(
      { ok: false, reason: "invalid_alert_id" },
      { status: 400 }
    );
  }

  let body: { action?: unknown; mapping_target?: unknown; note?: unknown };
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_body" },
      { status: 400 }
    );
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (!ACTION_BY_KIND[kind].includes(action)) {
    return NextResponse.json(
      { ok: false, reason: "unsupported_action_for_alert_type" },
      { status: 400 }
    );
  }

  const mappingTarget =
    typeof body.mapping_target === "string" && body.mapping_target.length > 0
      ? body.mapping_target
      : undefined;
  const note =
    typeof body.note === "string" && body.note.length > 0 ? body.note : undefined;

  // Build a properly-typed AlertResolution per alert kind.
  const resolution = (() => {
    if (kind === "package_alert") {
      return {
        kind,
        alertId,
        action: action as "ignored" | "mapped",
        mappingTarget,
        note,
      } satisfies AlertResolution;
    }
    if (kind === "customer_alert") {
      return {
        kind,
        alertId,
        action: action as "ignored" | "mapped" | "create_alias",
        mappingTarget,
        note,
      } satisfies AlertResolution;
    }
    return {
      kind,
      alertId,
      action: action as "acknowledged" | "ignored",
      note,
    } satisfies AlertResolution;
  })();

  try {
    const result = await resolveAlert(getPool(), resolution, email);
    if (result.ok) {
      return NextResponse.json(result, { status: 200 });
    }
    const notFoundReasons = new Set([
      "alert_not_pending_or_not_found",
      "alert_update_failed",
    ]);
    const status = notFoundReasons.has(result.reason) ? 404 : 400;
    return NextResponse.json(result, { status });
  } catch (err) {
    console.error("[alerts] unexpected error:", err);
    return NextResponse.json(
      { ok: false, reason: "internal_error" },
      { status: 500 }
    );
  }
}
