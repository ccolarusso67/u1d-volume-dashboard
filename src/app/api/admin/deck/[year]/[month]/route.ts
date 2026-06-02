/**
 * src/app/api/admin/deck/[year]/[month]/route.ts
 *
 * PR 004B — GET /api/admin/deck/:year/:month
 *
 * Streams a downloadable .pptx of the board deck for a locked, board-ready
 * period. Admin-only. Refuses unready/unlocked periods with 409 + blockers.
 *
 * Why GET instead of POST: this endpoint is functionally a file download
 * triggered by a click on the board dashboard ("Generate board deck"
 * anchor). Browsers handle <a href>...</a> downloads more cleanly via
 * GET, including respecting the Content-Disposition filename. The
 * underlying operation is read-only (no DB writes).
 *
 * Status matrix:
 *   200 — .pptx returned
 *   400 — invalid year/month
 *   401 — no session
 *   403 — not admin
 *   409 — period not ready (returns JSON, not pptx)
 *   500 — unexpected
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireAdminSession } from "@/lib/auth/require-admin";
import { getPool } from "@/lib/db-pool";
import { getBoardExecutiveDashboard } from "@/lib/board/get-board-executive-dashboard";
import {
  generateMonthlyDeckV2,
  deckFilenameV2,
} from "@/lib/deck/generate-monthly-deck-v2";

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
      { ok: false, error: "invalid_path_params" },
      { status: 400 }
    );
  }

  let view: Awaited<ReturnType<typeof getBoardExecutiveDashboard>>;
  try {
    view = await getBoardExecutiveDashboard(getPool(), year, month);
  } catch (err) {
    console.error("[deck] getBoardExecutiveDashboard failed:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }

  // Readiness gate — the generator also gates defensively, but we want
  // a clean 409 + JSON contract here rather than letting the generator
  // throw on a non-locked period.
  if (!view.readiness.ready || view.period.status !== "locked") {
    return NextResponse.json(
      {
        ok: false,
        error: "period_not_ready",
        blockers: view.readiness.blockers,
      },
      { status: 409 }
    );
  }

  try {
    const buffer = await generateMonthlyDeckV2(view);
    const filename = deckFilenameV2(view);

    return new NextResponse(
      // `body` accepts a Buffer in Next.js route handlers (Node runtime).
      buffer as unknown as BodyInit,
      {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": String(buffer.length),
          // Discourage intermediate caches from holding board artifacts.
          "Cache-Control": "private, no-store, max-age=0",
        },
      }
    );
  } catch (err) {
    console.error("[deck] generation failed:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}
