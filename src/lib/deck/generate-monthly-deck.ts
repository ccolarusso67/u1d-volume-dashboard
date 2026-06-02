/**
 * src/lib/deck/generate-monthly-deck.ts
 *
 * PR 004B + PR 004C — PowerPoint board deck generator.
 *
 * Pure function: BoardPeriodView → Buffer.
 *
 *   - No DB access. Caller loads the view + gates readiness.
 *   - Refuses unready or unlocked input as a defensive second gate.
 *   - 16:9 wide layout (13.33" × 7.5"). Module-scoped helpers keep slide
 *     code declarative and avoid copy-pasted shape arithmetic.
 *
 * PR 004C polish:
 *   - Optional logo on cover + closing (env-configurable path)
 *   - Speaker notes on every content slide
 *   - Alternating row banding on top-customers + top-packages tables
 *   - Per-slide page numbers (X / 10) in the footer
 *   - Cleaner cover hierarchy with a thin divider above provenance cards
 *   - "Generated at" timestamp on cover
 *   - Polished closing slide with logo + tagline
 *
 * Slide structure (10 slides):
 *   1.  Cover                       — period, version, locked metadata
 *   2.  Executive snapshot          — 6 metric cards (2 rows × 3 cols)
 *   3.  Month-over-month            — large numbers + comparison bar
 *   4.  Top customers               — table (top 10, banded)
 *   5.  Top packages                — table (top 10, banded)
 *   6.  Operations narrative        — 3 sections (capacity / supply / quality)
 *   7.  Initiatives & risks         — 2 sections
 *   8.  Close quality & alerts      — 5 stat cards
 *   9.  Lock history & provenance   — audit detail
 *   10. Closing                     — branded summary
 */
import PptxGenJS from "pptxgenjs";
import { existsSync, readFileSync } from "fs";
import path from "path";
import type { BoardPeriodView } from "../board/types";
import { SECTION_LABELS } from "../operator-notes/types";
import {
  formatGallons, formatPct, formatDelta,
  truncateText, formatDate, formatDateTime,
} from "./format";

// ---------------------------------------------------------------------------
// Brand — hex without '#' for pptxgenjs.
// ---------------------------------------------------------------------------

const BRAND = {
  navy:        "003C71",
  navyDeep:    "002647",
  red:         "E1261C",
  darkText:    "1F2937",
  bodyText:    "374151",
  mutedText:   "6B7280",
  borderGray:  "D1D5DB",
  lightGray:   "F3F4F6",
  banding:     "F9FAFB",      // PR 004C — slightly lighter than lightGray for table rows
  positive:    "047857",
  warn:        "B45309",
  white:       "FFFFFF",
};

const FONT_TITLE = "Georgia";
const FONT_BODY = "Calibri";

// 16:9 wide layout: 13.33" x 7.5"
const SLIDE_W = 13.33;
const MARGIN_X = 0.5;
const HEADER_Y = 0.4;
const FOOTER_Y = 7.05;
const TOTAL_CONTENT_SLIDES = 10;

const SECTION_LIMITS: Record<string, number> = {
  capacity_production: 500,
  supply_chain: 500,
  quality_incidents: 500,
  initiatives: 700,
  risks: 700,
};

// ---------------------------------------------------------------------------
// PR 004C — optional logo support
//
// Loaded once per process. If env var U1D_DECK_LOGO_PATH is set, use it;
// otherwise default to public/u1d-logo.png in the project root. Missing
// file is fine — falls back to text-only cover.
// ---------------------------------------------------------------------------

type LogoData = { dataUrl: string } | null;
let _cachedLogo: LogoData | undefined;

function loadOptionalLogo(): LogoData {
  if (_cachedLogo !== undefined) return _cachedLogo;
  const candidate =
    process.env.U1D_DECK_LOGO_PATH ||
    path.join(process.cwd(), "public", "u1d-logo.png");
  if (!existsSync(candidate)) {
    _cachedLogo = null;
    return null;
  }
  try {
    const buf = readFileSync(candidate);
    const mime = candidate.toLowerCase().endsWith(".jpg") ||
                 candidate.toLowerCase().endsWith(".jpeg")
      ? "image/jpeg"
      : "image/png";
    _cachedLogo = { dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
    return _cachedLogo;
  } catch {
    _cachedLogo = null;
    return null;
  }
}

/** Test-only escape hatch so a fixture logo can be swapped in. */
export function __resetLogoCacheForTests(): void {
  _cachedLogo = undefined;
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function addTitle(slide: PptxGenJS.Slide, title: string, subtitle?: string) {
  slide.addText(title, {
    x: MARGIN_X, y: HEADER_Y, w: SLIDE_W - MARGIN_X * 2, h: 0.55,
    fontFace: FONT_TITLE, fontSize: 28, bold: true, color: BRAND.navy,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: MARGIN_X, y: HEADER_Y + 0.55, w: SLIDE_W - MARGIN_X * 2, h: 0.35,
      fontFace: FONT_BODY, fontSize: 13, italic: true, color: BRAND.mutedText,
    });
  }
  // PR 004C — thin red accent under the title for hierarchy.
  slide.addShape("rect", {
    x: MARGIN_X, y: HEADER_Y + 0.96, w: 0.5, h: 0.04,
    fill: { color: BRAND.red }, line: { type: "none" },
  });
}

function addFooter(slide: PptxGenJS.Slide, board: BoardPeriodView, pageNo?: number) {
  const left =
    `U1Dynamics Manufacturing LLC · ${board.period.label} · ` +
    `Locked ${formatDate(board.period.locked_at)} by ${board.period.locked_by ?? "—"}`;
  slide.addText(left, {
    x: MARGIN_X, y: FOOTER_Y, w: SLIDE_W - MARGIN_X * 2 - 1.5, h: 0.3,
    fontFace: FONT_BODY, fontSize: 9, color: BRAND.mutedText,
  });
  if (pageNo) {
    slide.addText(`${pageNo} / ${TOTAL_CONTENT_SLIDES}`, {
      x: SLIDE_W - MARGIN_X - 1.5, y: FOOTER_Y, w: 1.5, h: 0.3,
      fontFace: FONT_BODY, fontSize: 9, color: BRAND.mutedText,
      align: "right",
    });
  }
}

type MetricCardOpts = {
  x: number; y: number; w: number; h: number;
  label: string; value: string; sub?: string;
  tone?: "navy" | "ok" | "warn";
};

function addMetricCard(slide: PptxGenJS.Slide, o: MetricCardOpts) {
  const accent =
    o.tone === "ok" ? BRAND.positive
    : o.tone === "warn" ? BRAND.warn
    : BRAND.navy;
  slide.addShape("rect", {
    x: o.x, y: o.y, w: o.w, h: o.h,
    fill: { color: BRAND.white },
    line: { color: BRAND.borderGray, width: 0.5 },
  });
  slide.addShape("rect", {
    x: o.x, y: o.y, w: o.w, h: 0.06,
    fill: { color: accent }, line: { type: "none" },
  });
  slide.addText(o.label.toUpperCase(), {
    x: o.x + 0.15, y: o.y + 0.12, w: o.w - 0.3, h: 0.3,
    fontFace: FONT_BODY, fontSize: 9, color: BRAND.mutedText, bold: true,
    charSpacing: 1,
  });
  slide.addText(o.value, {
    x: o.x + 0.15, y: o.y + 0.45, w: o.w - 0.3, h: 0.75,
    fontFace: FONT_TITLE, fontSize: 22, bold: true, color: BRAND.navy,
  });
  if (o.sub) {
    slide.addText(o.sub, {
      x: o.x + 0.15, y: o.y + o.h - 0.4, w: o.w - 0.3, h: 0.3,
      fontFace: FONT_BODY, fontSize: 9, italic: true, color: BRAND.mutedText,
    });
  }
}

type SectionBoxOpts = {
  x: number; y: number; w: number; h: number;
  title: string;
  body: string;
  tone?: "navy" | "warn";
};

function addSectionBox(slide: PptxGenJS.Slide, o: SectionBoxOpts) {
  const accent = o.tone === "warn" ? BRAND.warn : BRAND.navy;
  slide.addShape("rect", {
    x: o.x, y: o.y, w: o.w, h: o.h,
    fill: { color: BRAND.lightGray },
    line: { color: BRAND.borderGray, width: 0.5 },
  });
  slide.addShape("rect", {
    x: o.x, y: o.y, w: 0.07, h: o.h,
    fill: { color: accent }, line: { type: "none" },
  });
  slide.addText(o.title.toUpperCase(), {
    x: o.x + 0.2, y: o.y + 0.1, w: o.w - 0.3, h: 0.3,
    fontFace: FONT_BODY, fontSize: 10, bold: true, color: accent,
    charSpacing: 1,
  });
  const body = o.body && o.body.trim().length > 0 ? o.body : "—";
  slide.addText(body, {
    x: o.x + 0.2, y: o.y + 0.45, w: o.w - 0.35, h: o.h - 0.55,
    fontFace: FONT_BODY, fontSize: 11, color: BRAND.bodyText,
    valign: "top",
  });
}

type TableHeader = { text: string; align?: "left" | "right" | "center" };

/**
 * Build pptxgenjs table rows from typed inputs.
 *
 * PR 004C — `banded` enables alternating row backgrounds (white / lightGray)
 * on data rows. Header is always navy with white text.
 */
function buildTableRows(
  headers: TableHeader[],
  rows: Array<Array<{ text: string; bold?: boolean; align?: "left" | "right" | "center"; color?: string }>>,
  banded = false
): PptxGenJS.TableRow[] {
  const headerRow: PptxGenJS.TableRow = headers.map((h) => ({
    text: h.text,
    options: {
      bold: true,
      color: BRAND.white,
      fill: { color: BRAND.navy },
      fontFace: FONT_BODY,
      fontSize: 10,
      align: h.align ?? "left",
    },
  }));
  const dataRows: PptxGenJS.TableRow[] = rows.map((r, rowIdx) => {
    const bandedFill = banded && rowIdx % 2 === 1 ? BRAND.banding : undefined;
    return r.map((cell) => ({
      text: cell.text,
      options: {
        bold: !!cell.bold,
        color: cell.color ?? BRAND.darkText,
        fontFace: FONT_BODY,
        fontSize: 10,
        align: cell.align ?? "left",
        fill: bandedFill ? { color: bandedFill } : undefined,
      },
    }));
  });
  return [headerRow, ...dataRows];
}

/**
 * PR 004C — attach a presenter script to a slide. Multi-line strings render
 * cleanly in PowerPoint's Notes pane and Keynote's Presenter View.
 */
function addSpeakerNotes(slide: PptxGenJS.Slide, notes: string) {
  const cleaned = notes.replace(/[ \t]+\n/g, "\n").trim();
  if (cleaned.length === 0) return;
  slide.addNotes(cleaned);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class DeckNotReadyError extends Error {
  readonly blockers: string[];
  constructor(blockers: string[]) {
    super(
      `Cannot generate deck: period is not board-ready. Blockers: ${blockers.join(", ") || "unknown"}`
    );
    this.name = "DeckNotReadyError";
    this.blockers = blockers;
  }
}

export async function generateMonthlyDeck(
  board: BoardPeriodView
): Promise<Buffer> {
  if (!board.readiness.ready || board.period.status !== "locked") {
    throw new DeckNotReadyError(board.readiness.blockers);
  }

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "U1Dynamics Board Reporting";
  pptx.company = "U1Dynamics Manufacturing LLC";
  pptx.title = `U1D Board Report — ${board.period.label}`;
  pptx.subject = "Monthly board operating report";

  const logo = loadOptionalLogo();

  buildCoverSlide(pptx, board, logo);
  buildSnapshotSlide(pptx, board);
  buildMoMSlide(pptx, board);
  buildTopCustomersSlide(pptx, board);
  buildTopPackagesSlide(pptx, board);
  buildOperationsNarrativeSlide(pptx, board);
  buildInitiativesRisksSlide(pptx, board);
  buildCloseQualitySlide(pptx, board);
  buildLockHistoryProvenanceSlide(pptx, board);
  buildClosingSlide(pptx, board, logo);

  const output = await pptx.write({ outputType: "nodebuffer", compression: true });
  if (Buffer.isBuffer(output)) return output;
  if (output instanceof Uint8Array) return Buffer.from(output);
  if (typeof output === "string") return Buffer.from(output, "binary");
  if (output instanceof ArrayBuffer) return Buffer.from(output);
  throw new Error("generateMonthlyDeck: unexpected output type from pptx.write()");
}

export function deckFilename(board: BoardPeriodView): string {
  const yyyy = String(board.period.year).padStart(4, "0");
  const mm = String(board.period.month).padStart(2, "0");
  return `U1D_Board_Report_${yyyy}_${mm}.pptx`;
}

// ---------------------------------------------------------------------------
// Slide builders
// ---------------------------------------------------------------------------

function buildCoverSlide(pptx: PptxGenJS, board: BoardPeriodView, logo: LogoData) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.white };

  // Navy band.
  slide.addShape("rect", {
    x: 0, y: 0, w: SLIDE_W, h: 1.7,
    fill: { color: BRAND.navy }, line: { type: "none" },
  });
  // Red accent stripe.
  slide.addShape("rect", {
    x: 0, y: 1.7, w: SLIDE_W, h: 0.08,
    fill: { color: BRAND.red }, line: { type: "none" },
  });

  // Optional logo on the left of the navy band.
  if (logo) {
    slide.addImage({
      data: logo.dataUrl,
      x: MARGIN_X, y: 0.35, w: 1.0, h: 1.0,
      sizing: { type: "contain", w: 1.0, h: 1.0 },
    });
  }

  const wordmarkX = logo ? MARGIN_X + 1.2 : MARGIN_X;
  slide.addText("U1DYNAMICS MANUFACTURING LLC", {
    x: wordmarkX, y: 0.45, w: SLIDE_W - wordmarkX - MARGIN_X, h: 0.3,
    fontFace: FONT_BODY, fontSize: 10, color: BRAND.white,
    charSpacing: 4, bold: true,
  });
  slide.addText("Monthly Board Report", {
    x: wordmarkX, y: 0.75, w: SLIDE_W - wordmarkX - MARGIN_X, h: 0.7,
    fontFace: FONT_TITLE, fontSize: 32, bold: true, color: BRAND.white,
  });

  // Period text — large and centered.
  slide.addText(board.period.label, {
    x: MARGIN_X, y: 2.3, w: SLIDE_W - MARGIN_X * 2, h: 0.9,
    fontFace: FONT_TITLE, fontSize: 56, bold: true, color: BRAND.navy,
  });
  slide.addText("U1Dynamics / Ultra1Plus Operating Review", {
    x: MARGIN_X, y: 3.3, w: SLIDE_W - MARGIN_X * 2, h: 0.4,
    fontFace: FONT_BODY, fontSize: 16, italic: true, color: BRAND.mutedText,
  });

  // PR 004C — divider line above the provenance cards for visual hierarchy.
  slide.addShape("line", {
    x: MARGIN_X, y: 4.2, w: SLIDE_W - MARGIN_X * 2, h: 0,
    line: { color: BRAND.borderGray, width: 0.5 },
  });

  // Provenance cards.
  const cardY = 4.4;
  const cardW = (SLIDE_W - MARGIN_X * 2 - 0.4) / 3;
  addMetricCard(slide, {
    x: MARGIN_X, y: cardY, w: cardW, h: 1.5,
    label: "Period locked",
    value: formatDate(board.period.locked_at),
    sub: `by ${board.period.locked_by ?? "—"}`,
  });
  addMetricCard(slide, {
    x: MARGIN_X + cardW + 0.2, y: cardY, w: cardW, h: 1.5,
    label: "Active version",
    value: board.activeFile ? `v${board.activeFile.version_no}` : "—",
    sub: board.activeFile?.filename ?? "—",
  });
  addMetricCard(slide, {
    x: MARGIN_X + (cardW + 0.2) * 2, y: cardY, w: cardW, h: 1.5,
    label: "File hash",
    value: board.activeFile?.file_hash_prefix ?? "—",
    sub: "first 8 chars · sha256",
  });

  // PR 004C — generation timestamp on the right of the footer.
  slide.addText("Generated from locked period data · Confidential — board distribution only", {
    x: MARGIN_X, y: 6.65, w: SLIDE_W - MARGIN_X * 2 - 3.0, h: 0.3,
    fontFace: FONT_BODY, fontSize: 10, italic: true, color: BRAND.mutedText,
  });
  slide.addText(`Generated ${formatDateTime(new Date().toISOString())}`, {
    x: SLIDE_W - MARGIN_X - 3.0, y: 6.65, w: 3.0, h: 0.3,
    fontFace: FONT_BODY, fontSize: 9, italic: true, color: BRAND.mutedText,
    align: "right",
  });

  addSpeakerNotes(slide,
    `Cover slide for the ${board.period.label} monthly operating review.\n` +
    `Period was locked on ${formatDate(board.period.locked_at)} by ` +
    `${board.period.locked_by ?? "the admin team"}.\n` +
    `This deck is generated automatically from the locked monthly close data ` +
    `in the U1D Board Intelligence application. All numbers are pulled from ` +
    `the active version (v${board.activeFile?.version_no ?? "—"}) of the ` +
    `uploaded monthly file. Source of truth: u1d_ops Postgres schema.`
  );
}

function buildSnapshotSlide(pptx: PptxGenJS, board: BoardPeriodView) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.white };
  addTitle(slide, "Executive snapshot", `${board.period.label} · locked monthly view`);

  const h = board.headlineMetrics;
  const cardW = (SLIDE_W - MARGIN_X * 2 - 0.4) / 3;
  const cardH = 1.65;
  const rowY1 = 1.7;
  const rowY2 = rowY1 + cardH + 0.25;
  const cards: Array<MetricCardOpts> = [
    {
      x: MARGIN_X, y: rowY1, w: cardW, h: cardH,
      label: "Total gallons", value: formatGallons(h.total_gallons), sub: "this month",
    },
    {
      x: MARGIN_X + cardW + 0.2, y: rowY1, w: cardW, h: cardH,
      label: "Month over month",
      value: formatPct(h.month_over_month_delta_pct),
      sub:
        h.prior_month_total_gallons !== null
          ? `${formatDelta(h.month_over_month_delta_gallons)} vs prior`
          : "no prior locked month",
      tone:
        h.month_over_month_delta_pct === null ? "navy"
        : h.month_over_month_delta_pct >= 0 ? "ok" : "warn",
    },
    {
      x: MARGIN_X + (cardW + 0.2) * 2, y: rowY1, w: cardW, h: cardH,
      label: "Customers", value: String(h.customer_count), sub: "active this period",
    },
    {
      x: MARGIN_X, y: rowY2, w: cardW, h: cardH,
      label: "Package types", value: String(h.package_count), sub: "distinct",
    },
    {
      x: MARGIN_X + cardW + 0.2, y: rowY2, w: cardW, h: cardH,
      label: "Volume rows", value: String(h.fact_row_count), sub: "customer × package",
    },
    {
      x: MARGIN_X + (cardW + 0.2) * 2, y: rowY2, w: cardW, h: cardH,
      label: "Alerts resolved",
      value: String(board.alertSummary.resolved_alerts_total),
      sub: "during close · 0 pending",
      tone: "ok",
    },
  ];
  cards.forEach((c) => addMetricCard(slide, c));
  addFooter(slide, board, 2);

  const momScript = h.prior_month_total_gallons !== null
    ? `Month-over-month volume moved by ${formatPct(h.month_over_month_delta_pct)} ` +
      `(${formatDelta(h.month_over_month_delta_gallons)}).`
    : `No prior locked month is available for comparison.`;
  addSpeakerNotes(slide,
    `${board.period.label} total volume was ${formatGallons(h.total_gallons)} ` +
    `across ${h.customer_count} customer${h.customer_count === 1 ? "" : "s"} and ` +
    `${h.package_count} package type${h.package_count === 1 ? "" : "s"}.\n` +
    `${momScript}\n` +
    `${board.alertSummary.resolved_alerts_total} alert(s) were resolved during the ` +
    `monthly close. Zero pending alerts remain at lock time.`
  );
}

function buildMoMSlide(pptx: PptxGenJS, board: BoardPeriodView) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.white };
  addTitle(slide, "Month-over-month performance", `${board.period.label} vs prior locked month`);

  const h = board.headlineMetrics;
  const hasPrior = h.prior_month_total_gallons !== null;

  slide.addText(formatGallons(h.total_gallons), {
    x: MARGIN_X, y: 1.7, w: 5.5, h: 1.2,
    fontFace: FONT_TITLE, fontSize: 56, bold: true, color: BRAND.navy,
  });
  slide.addText("this month", {
    x: MARGIN_X, y: 2.85, w: 5.5, h: 0.35,
    fontFace: FONT_BODY, fontSize: 13, italic: true, color: BRAND.mutedText,
  });

  if (hasPrior) {
    slide.addText(formatGallons(h.prior_month_total_gallons), {
      x: MARGIN_X + 6.5, y: 1.7, w: 5.5, h: 1.2,
      fontFace: FONT_TITLE, fontSize: 40, bold: true, color: BRAND.mutedText,
    });
    slide.addText("prior month (locked)", {
      x: MARGIN_X + 6.5, y: 2.85, w: 5.5, h: 0.35,
      fontFace: FONT_BODY, fontSize: 13, italic: true, color: BRAND.mutedText,
    });

    const max = Math.max(h.total_gallons, h.prior_month_total_gallons ?? 0);
    const barX = MARGIN_X;
    const barW = SLIDE_W - MARGIN_X * 2;
    const labelW = 1.2;
    slide.addText("Current", {
      x: barX, y: 4.0, w: labelW, h: 0.3,
      fontFace: FONT_BODY, fontSize: 11, color: BRAND.darkText,
    });
    slide.addShape("rect", {
      x: barX + labelW, y: 4.05, w: barW - labelW, h: 0.25,
      fill: { color: BRAND.lightGray }, line: { type: "none" },
    });
    slide.addShape("rect", {
      x: barX + labelW, y: 4.05,
      w: (barW - labelW) * (h.total_gallons / Math.max(max, 1)),
      h: 0.25, fill: { color: BRAND.navy }, line: { type: "none" },
    });
    slide.addText("Prior", {
      x: barX, y: 4.45, w: labelW, h: 0.3,
      fontFace: FONT_BODY, fontSize: 11, color: BRAND.darkText,
    });
    slide.addShape("rect", {
      x: barX + labelW, y: 4.5, w: barW - labelW, h: 0.25,
      fill: { color: BRAND.lightGray }, line: { type: "none" },
    });
    slide.addShape("rect", {
      x: barX + labelW, y: 4.5,
      w: (barW - labelW) * ((h.prior_month_total_gallons ?? 0) / Math.max(max, 1)),
      h: 0.25, fill: { color: BRAND.mutedText }, line: { type: "none" },
    });

    const deltaTone =
      (h.month_over_month_delta_pct ?? 0) >= 0 ? BRAND.positive : BRAND.red;
    slide.addText(
      `${formatPct(h.month_over_month_delta_pct)}  ·  ${formatDelta(h.month_over_month_delta_gallons)}`,
      {
        x: MARGIN_X, y: 5.2, w: SLIDE_W - MARGIN_X * 2, h: 0.7,
        fontFace: FONT_TITLE, fontSize: 32, bold: true, color: deltaTone,
      }
    );
    slide.addText("month-over-month change", {
      x: MARGIN_X, y: 5.95, w: SLIDE_W - MARGIN_X * 2, h: 0.3,
      fontFace: FONT_BODY, fontSize: 12, italic: true, color: BRAND.mutedText,
    });
  } else {
    slide.addText("No locked prior month available", {
      x: MARGIN_X, y: 4.0, w: SLIDE_W - MARGIN_X * 2, h: 0.5,
      fontFace: FONT_BODY, fontSize: 16, italic: true, color: BRAND.mutedText,
    });
    slide.addText(
      "A month-over-month delta requires a prior calendar month with a locked active file. " +
      "Lock the prior period from /admin/periods to enable this comparison.",
      {
        x: MARGIN_X, y: 4.4, w: SLIDE_W - MARGIN_X * 2, h: 0.6,
        fontFace: FONT_BODY, fontSize: 11, color: BRAND.bodyText,
      }
    );
  }

  addFooter(slide, board, 3);
  addSpeakerNotes(slide, hasPrior
    ? `Compared to the prior locked month, total volume moved by ` +
      `${formatPct(h.month_over_month_delta_pct)} (${formatDelta(h.month_over_month_delta_gallons)}). ` +
      `Use the comparison bars to anchor the magnitude of the change for the board.`
    : `No prior locked month is in the dataset. Mention this is the first locked period or ` +
      `that the prior month is still in review.`);
}

function buildTopCustomersSlide(pptx: PptxGenJS, board: BoardPeriodView) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.white };
  addTitle(slide, "Top customers", `${board.period.label} · top ${board.topCustomers.length}`);

  const headers: TableHeader[] = [
    { text: "#", align: "right" },
    { text: "Customer" },
    { text: "Gallons", align: "right" },
    { text: "Share", align: "right" },
    { text: "MoM", align: "right" },
  ];
  const rows = board.topCustomers.map((c, i) => [
    { text: String(i + 1), align: "right" as const },
    { text: c.customer_name, bold: true },
    { text: formatGallons(c.gallons), align: "right" as const },
    { text: c.share_pct !== null ? formatPct(c.share_pct) : "—", align: "right" as const, color: BRAND.bodyText },
    {
      text: c.delta_pct !== null ? formatPct(c.delta_pct) : "—",
      align: "right" as const,
      color: c.delta_pct === null ? BRAND.mutedText
           : c.delta_pct >= 0 ? BRAND.positive
           : BRAND.red,
    },
  ]);
  if (rows.length === 0) {
    slide.addText("No customer rows available for this period.", {
      x: MARGIN_X, y: 1.7, w: SLIDE_W - MARGIN_X * 2, h: 0.5,
      fontFace: FONT_BODY, fontSize: 13, italic: true, color: BRAND.mutedText,
    });
  } else {
    // PR 004C — banded rows for readability.
    slide.addTable(buildTableRows(headers, rows, true), {
      x: MARGIN_X, y: 1.6, w: SLIDE_W - MARGIN_X * 2,
      colW: [0.7, 5.5, 2.0, 1.5, 1.5],
      rowH: 0.42,
      border: { type: "solid", pt: 0.5, color: BRAND.borderGray },
    });
  }
  addFooter(slide, board, 4);

  const topName = board.topCustomers[0]?.customer_name ?? "—";
  const topShare = board.topCustomers[0]?.share_pct;
  addSpeakerNotes(slide,
    `${board.topCustomers.length} customer(s) contributed to this month's volume.\n` +
    `${topName} leads the period` +
    (topShare !== null && topShare !== undefined ? ` at ${formatPct(topShare)} of the month.` : `.`) +
    `\nGreen MoM%% = up vs prior. Red = down. Em-dash = no prior locked month.`
  );
}

function buildTopPackagesSlide(pptx: PptxGenJS, board: BoardPeriodView) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.white };
  addTitle(slide, "Top packages", `${board.period.label} · top ${board.topPackages.length}`);

  const headers: TableHeader[] = [
    { text: "#", align: "right" },
    { text: "Package" },
    { text: "Gallons", align: "right" },
    { text: "Share", align: "right" },
    { text: "MoM", align: "right" },
  ];
  const rows = board.topPackages.map((p, i) => [
    { text: String(i + 1), align: "right" as const },
    { text: p.package_label, bold: true },
    { text: formatGallons(p.gallons), align: "right" as const },
    { text: p.share_pct !== null ? formatPct(p.share_pct) : "—", align: "right" as const, color: BRAND.bodyText },
    {
      text: p.delta_pct !== null ? formatPct(p.delta_pct) : "—",
      align: "right" as const,
      color: p.delta_pct === null ? BRAND.mutedText
           : p.delta_pct >= 0 ? BRAND.positive
           : BRAND.red,
    },
  ]);
  if (rows.length === 0) {
    slide.addText("No package rows available for this period.", {
      x: MARGIN_X, y: 1.7, w: SLIDE_W - MARGIN_X * 2, h: 0.5,
      fontFace: FONT_BODY, fontSize: 13, italic: true, color: BRAND.mutedText,
    });
  } else {
    slide.addTable(buildTableRows(headers, rows, true), {
      x: MARGIN_X, y: 1.6, w: SLIDE_W - MARGIN_X * 2,
      colW: [0.7, 5.5, 2.0, 1.5, 1.5],
      rowH: 0.42,
      border: { type: "solid", pt: 0.5, color: BRAND.borderGray },
    });
  }
  addFooter(slide, board, 5);

  const topPkg = board.topPackages[0]?.package_label ?? "—";
  addSpeakerNotes(slide,
    `${board.topPackages.length} package type(s) moved this month.\n` +
    `${topPkg} was the strongest single package. Highlight any package whose MoM%% ` +
    `is materially different from total volume MoM%%.`
  );
}

function buildOperationsNarrativeSlide(pptx: PptxGenJS, board: BoardPeriodView) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.white };
  addTitle(slide, "Operations narrative", "Capacity · Supply chain · Quality");

  const n = board.operatorNotes;
  const boxW = (SLIDE_W - MARGIN_X * 2 - 0.4) / 3;
  const boxH = 4.8;
  const boxY = 1.7;
  addSectionBox(slide, {
    x: MARGIN_X, y: boxY, w: boxW, h: boxH,
    title: SECTION_LABELS.capacity_production,
    body: truncateText(n?.capacity_production ?? "", SECTION_LIMITS.capacity_production),
  });
  addSectionBox(slide, {
    x: MARGIN_X + boxW + 0.2, y: boxY, w: boxW, h: boxH,
    title: SECTION_LABELS.supply_chain,
    body: truncateText(n?.supply_chain ?? "", SECTION_LIMITS.supply_chain),
  });
  addSectionBox(slide, {
    x: MARGIN_X + (boxW + 0.2) * 2, y: boxY, w: boxW, h: boxH,
    title: SECTION_LABELS.quality_incidents,
    body: truncateText(n?.quality_incidents ?? "", SECTION_LIMITS.quality_incidents),
  });
  addFooter(slide, board, 6);

  addSpeakerNotes(slide,
    `Operator-authored narrative for the ${board.period.label} close.\n` +
    `Capacity, supply chain, and quality columns were each authored at close time and ` +
    `marked complete on ${formatDate(n?.completed_at ?? null)} by ${n?.completed_by ?? "—"}.\n` +
    `Long entries are truncated for slide fit; full text is preserved in the database.`
  );
}

function buildInitiativesRisksSlide(pptx: PptxGenJS, board: BoardPeriodView) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.white };
  addTitle(slide, "Initiatives & risks", "Strategic priorities · management attention");

  const n = board.operatorNotes;
  const boxW = (SLIDE_W - MARGIN_X * 2 - 0.3) / 2;
  const boxH = 4.8;
  addSectionBox(slide, {
    x: MARGIN_X, y: 1.7, w: boxW, h: boxH,
    title: SECTION_LABELS.initiatives,
    body: truncateText(n?.initiatives ?? "", SECTION_LIMITS.initiatives),
  });
  addSectionBox(slide, {
    x: MARGIN_X + boxW + 0.3, y: 1.7, w: boxW, h: boxH,
    title: SECTION_LABELS.risks,
    body: truncateText(n?.risks ?? "", SECTION_LIMITS.risks),
    tone: "warn",
  });
  addFooter(slide, board, 7);

  addSpeakerNotes(slide,
    `Strategic initiatives and risks for board attention.\n` +
    `The risks section uses an amber accent to flag items needing decision or owner action. ` +
    `Walk through each bullet briefly; defer detailed Q&A to the appendix when present.`
  );
}

function buildCloseQualitySlide(pptx: PptxGenJS, board: BoardPeriodView) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.white };
  addTitle(slide, "Close quality & alerts", "Alerts surfaced and resolved during the close");

  const a = board.alertSummary;
  const cardW = (SLIDE_W - MARGIN_X * 2 - 0.4 * 4) / 5;
  const cardY = 2.4;
  const items: Array<MetricCardOpts> = [
    { x: MARGIN_X,                                y: cardY, w: cardW, h: 1.7,
      label: "Package alerts",       value: String(a.package_alerts_total) },
    { x: MARGIN_X + (cardW + 0.4) * 1,             y: cardY, w: cardW, h: 1.7,
      label: "Customer alerts",      value: String(a.customer_alerts_total) },
    { x: MARGIN_X + (cardW + 0.4) * 2,             y: cardY, w: cardW, h: 1.7,
      label: "Data quality alerts",  value: String(a.data_quality_alerts_total) },
    { x: MARGIN_X + (cardW + 0.4) * 3,             y: cardY, w: cardW, h: 1.7,
      label: "Resolved",             value: String(a.resolved_alerts_total), tone: "ok" },
    { x: MARGIN_X + (cardW + 0.4) * 4,             y: cardY, w: cardW, h: 1.7,
      label: "Pending",              value: String(a.pending_alerts_total),
      tone: a.pending_alerts_total === 0 ? "ok" : "warn" },
  ];
  items.forEach((c) => addMetricCard(slide, c));

  slide.addText(
    "Locked periods must have zero pending alerts. Counts include the active file only " +
    "and are sourced from u1d_ops.package_alerts / customer_alerts / data_quality_alerts.",
    {
      x: MARGIN_X, y: 4.5, w: SLIDE_W - MARGIN_X * 2, h: 0.6,
      fontFace: FONT_BODY, fontSize: 11, italic: true, color: BRAND.mutedText,
    }
  );
  addFooter(slide, board, 8);

  addSpeakerNotes(slide,
    `Close quality summary. ${a.package_alerts_total} package, ${a.customer_alerts_total} ` +
    `customer, and ${a.data_quality_alerts_total} data-quality alert(s) were detected during ` +
    `the parse step. ${a.resolved_alerts_total} were resolved and ${a.pending_alerts_total} ` +
    `remain pending.\n` +
    `By contract a locked period must show zero pending — this is the defensibility marker.`
  );
}

function buildLockHistoryProvenanceSlide(pptx: PptxGenJS, board: BoardPeriodView) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.white };
  addTitle(slide, "Lock history & data provenance", "Defensibility detail");

  const headers: TableHeader[] = [
    { text: "Event" },
    { text: "At" },
    { text: "By" },
    { text: "Version", align: "right" },
  ];
  const rows = board.lockHistory.slice(0, 6).map((e) => [
    { text: e.event_type.toUpperCase(), bold: true,
      color: e.event_type === "locked" ? BRAND.positive : BRAND.warn },
    { text: formatDateTime(e.event_at) },
    { text: e.event_by },
    { text: e.version_no !== null ? `v${e.version_no}` : "—", align: "right" as const },
  ]);
  if (rows.length === 0) {
    slide.addText("No lock events recorded.", {
      x: MARGIN_X, y: 1.8, w: 6.5, h: 0.4,
      fontFace: FONT_BODY, fontSize: 12, italic: true, color: BRAND.mutedText,
    });
  } else {
    slide.addTable(buildTableRows(headers, rows, true), {
      x: MARGIN_X, y: 1.6, w: 6.5,
      colW: [1.2, 2.4, 1.9, 1.0],
      rowH: 0.4,
      border: { type: "solid", pt: 0.5, color: BRAND.borderGray },
    });
  }

  const provX = MARGIN_X + 7.0;
  const provW = SLIDE_W - MARGIN_X - provX;
  slide.addShape("rect", {
    x: provX, y: 1.6, w: provW, h: 4.8,
    fill: { color: BRAND.lightGray },
    line: { color: BRAND.borderGray, width: 0.5 },
  });
  slide.addText("DATA PROVENANCE", {
    x: provX + 0.2, y: 1.7, w: provW - 0.4, h: 0.3,
    fontFace: FONT_BODY, fontSize: 10, bold: true, color: BRAND.navy, charSpacing: 1,
  });
  const lines: Array<[string, string]> = [
    ["Active file ID", String(board.activeFile?.file_id ?? "—")],
    ["Filename", board.activeFile?.filename ?? "—"],
    ["Version", board.activeFile ? `v${board.activeFile.version_no}` : "—"],
    ["File hash prefix", board.activeFile?.file_hash_prefix ?? "—"],
    ["Uploaded at", formatDateTime(board.activeFile?.uploaded_at ?? null)],
    ["Uploaded by", board.activeFile?.uploaded_by ?? "—"],
    ["Locked at", formatDateTime(board.period.locked_at)],
    ["Locked by", board.period.locked_by ?? "—"],
    ["Discrepancy", board.activeFile?.has_total_discrepancy ? "flagged" : "none"],
  ];
  lines.forEach((pair, i) => {
    const lineY = 2.1 + i * 0.35;
    slide.addText(pair[0].toUpperCase(), {
      x: provX + 0.2, y: lineY, w: 1.6, h: 0.3,
      fontFace: FONT_BODY, fontSize: 8, color: BRAND.mutedText, charSpacing: 1,
    });
    slide.addText(pair[1], {
      x: provX + 1.9, y: lineY, w: provW - 2.1, h: 0.3,
      fontFace: FONT_BODY, fontSize: 11, color: BRAND.darkText,
    });
  });

  addFooter(slide, board, 9);

  const reopens = board.lockHistory.filter(e => e.event_type === "reopened").length;
  const reopenScript = reopens === 0
    ? `This period was locked once and never reopened.`
    : `This period was reopened ${reopens === 1 ? "once" : `${reopens} times`} ` +
      `before reaching its current locked state.`;
  addSpeakerNotes(slide,
    `${reopenScript}\nProvenance: active file v${board.activeFile?.version_no ?? "—"} ` +
    `(hash ${board.activeFile?.file_hash_prefix ?? "—"}). Locked by ` +
    `${board.period.locked_by ?? "—"} on ${formatDate(board.period.locked_at)}.\n` +
    `This is the slide auditors will care about.`
  );
}

function buildClosingSlide(pptx: PptxGenJS, board: BoardPeriodView, logo: LogoData) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.navy };

  slide.addShape("rect", {
    x: 0, y: 3.5, w: SLIDE_W, h: 0.08,
    fill: { color: BRAND.red }, line: { type: "none" },
  });

  // PR 004C — small logo centered at the top if available.
  if (logo) {
    slide.addImage({
      data: logo.dataUrl,
      x: (SLIDE_W - 1.2) / 2, y: 0.8, w: 1.2, h: 1.2,
      sizing: { type: "contain", w: 1.2, h: 1.2 },
    });
  }

  slide.addText("Board-ready operating view", {
    x: MARGIN_X, y: 2.2, w: SLIDE_W - MARGIN_X * 2, h: 0.8,
    fontFace: FONT_TITLE, fontSize: 36, bold: true, color: BRAND.white,
    align: "center",
  });
  slide.addText("Prepared from locked monthly close data", {
    x: MARGIN_X, y: 3.0, w: SLIDE_W - MARGIN_X * 2, h: 0.4,
    fontFace: FONT_BODY, fontSize: 16, italic: true, color: BRAND.white,
    align: "center",
  });
  slide.addText(`${board.period.label}  ·  Version ${board.activeFile?.version_no ?? "—"}`, {
    x: MARGIN_X, y: 3.8, w: SLIDE_W - MARGIN_X * 2, h: 0.4,
    fontFace: FONT_BODY, fontSize: 14, color: BRAND.white,
    align: "center",
  });
  slide.addText("Appendix expansion available in future version", {
    x: MARGIN_X, y: 5.3, w: SLIDE_W - MARGIN_X * 2, h: 0.4,
    fontFace: FONT_BODY, fontSize: 11, italic: true, color: BRAND.white,
    align: "center", charSpacing: 1,
  });

  // PR 004C — Prepared-by block + confidentiality footer.
  slide.addText(
    `Prepared by U1Dynamics Board Reporting · Locked by ${board.period.locked_by ?? "—"} on ${formatDate(board.period.locked_at)}`,
    {
      x: MARGIN_X, y: 6.4, w: SLIDE_W - MARGIN_X * 2, h: 0.3,
      fontFace: FONT_BODY, fontSize: 10, color: BRAND.white,
      align: "center", italic: true,
    }
  );
  slide.addText("U1Dynamics Manufacturing LLC  ·  Confidential — board distribution only", {
    x: MARGIN_X, y: 6.95, w: SLIDE_W - MARGIN_X * 2, h: 0.3,
    fontFace: FONT_BODY, fontSize: 9, italic: true, color: BRAND.white,
    align: "center", charSpacing: 1,
  });

  addSpeakerNotes(slide,
    `Closing slide. The deck is generated from locked Postgres data only — there is ` +
    `nothing to refresh after this point. Distribute as the board-of-record artifact ` +
    `for ${board.period.label}.`
  );
}
