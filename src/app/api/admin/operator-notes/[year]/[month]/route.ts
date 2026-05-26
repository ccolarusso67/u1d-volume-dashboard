/**
 * src/app/api/admin/operator-notes/[year]/[month]/route.ts
 *
 * PR 003E — Operator notes CRUD endpoint.
 *
 * GET  → returns the full OperatorNotes JSON (sections + completion state).
 * POST → upserts. Body:
 *   {
 *     mode: "draft" | "mark_complete" | "reopen",
 *     sections?: {
 *       capacity_production?: string | null,
 *       supply_chain?: string | null,
 *       quality_incidents?: string | null,
 *       initiatives?: string | null,
 *       risks?: string | null
 *     }
 *   }
 *
 * Both methods require an admin session.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireAdminSession } from "@/lib/auth/require-admin";
import { getPool } from "@/lib/db-pool";
import { getOperatorNotes } from "@/lib/operator-notes/get-operator-notes";
import { saveOperatorNotes } from "@/lib/operator-notes/save-operator-notes";
import { SECTION_KEYS } from "@/lib/operator-notes/types";
import type { SaveMode, SectionUpdates, SectionKey } from "@/lib/operator-notes/types";

type Params = { year: string; month: string };

async function parsePathParams(p: Promise<Params>): Promise<{ year: number; month: number } | null> {
  const { year: y, month: m } = await p;
  const year = parseInt(y, 10);
  const month = parseInt(m, 10);
  if (
    !Number.isInteger(year) || year < 2020 || year > 2100 ||
    !Number.isInteger(month) || month < 1 || month > 12
  ) {
    return null;
  }
  return { year, month };
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<Params> }
) {
  const a = await requireAdminSession(() => auth());
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });

  const ym = await parsePathParams(context.params);
  if (!ym) {
    return NextResponse.json(
      { ok: false, reason: "invalid_path_params" },
      { status: 400 }
    );
  }
  try {
    const notes = await getOperatorNotes(getPool(), ym.year, ym.month);
    return NextResponse.json({ ok: true, notes }, { status: 200 });
  } catch (err) {
    console.error("[operator-notes:GET] error:", err);
    return NextResponse.json(
      { ok: false, reason: "internal_error" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<Params> }
) {
  const a = await requireAdminSession(() => auth());
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });
  const email = a.session.user?.email;
  if (!email) {
    return NextResponse.json(
      { ok: false, reason: "no_email" },
      { status: 400 }
    );
  }

  const ym = await parsePathParams(context.params);
  if (!ym) {
    return NextResponse.json(
      { ok: false, reason: "invalid_path_params" },
      { status: 400 }
    );
  }

  let body: { mode?: unknown; sections?: unknown };
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_body" },
      { status: 400 }
    );
  }

  const mode = body.mode;
  if (mode !== "draft" && mode !== "mark_complete" && mode !== "reopen") {
    return NextResponse.json(
      { ok: false, reason: "invalid_mode" },
      { status: 400 }
    );
  }

  // Whitelist + sanitize the sections object.
  const incoming = (body.sections ?? {}) as Record<string, unknown>;
  const updates: SectionUpdates = {};
  for (const k of SECTION_KEYS as readonly SectionKey[]) {
    if (Object.prototype.hasOwnProperty.call(incoming, k)) {
      const v = incoming[k];
      if (v === null || typeof v === "string") {
        updates[k] = v;
      } else {
        return NextResponse.json(
          { ok: false, reason: "invalid_section_value", section: k },
          { status: 400 }
        );
      }
    }
  }

  try {
    const result = await saveOperatorNotes(
      getPool(),
      ym.year,
      ym.month,
      updates,
      email,
      mode as SaveMode
    );
    if (!result.ok) {
      const status = result.reason === "sections_incomplete" ? 409 : 400;
      return NextResponse.json(result, { status });
    }
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[operator-notes:POST] error:", err);
    return NextResponse.json(
      { ok: false, reason: "internal_error" },
      { status: 500 }
    );
  }
}
