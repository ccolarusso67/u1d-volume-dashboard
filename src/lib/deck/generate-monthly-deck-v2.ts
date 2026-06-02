/**
 * src/lib/deck/generate-monthly-deck-v2.ts
 *
 * PR 012B — Board Operating Review deck (v2).
 *
 * Pure function: BoardExecutiveDashboard → Buffer.
 *
 * Reshapes the deck from a "volume highlight reel" (v1, PR 004B/C) into
 * an operating review with money + decision-card framing on every section.
 *
 * Slide structure (10 slides, anchored by Decision-for-Management framing):
 *   1.  Cover
 *   2.  Decision for Management         — board's central question
 *   3.  At a Glance                     — volume row + money row
 *   4.  Volume Detail                   — trends, MoM/YoY, concentration
 *   5.  Revenue & Margin Detail         — monthly P&L from canonical QB
 *   6.  Cash & Working Capital          — AR/AP aging + net position
 *   7.  Customer Intelligence           — by gallons only (disclosure footnote)
 *   8.  Operational Narrative           — operator notes capacity/supply/quality
 *   9.  Management Attention            — initiatives + risks
 *   10. Close Quality & Audit + Data Integrity disclosure
 *
 * Per-slide Decision Cards auto-generate from decision-cards.ts thresholds.
 * Slides 1, 8, 10 skip the decision card (no ask).
 *
 * v1 (generate-monthly-deck.ts) is preserved untouched for backward compat
 * during the rollover.
 */
import PptxGenJS from "pptxgenjs";
import { existsSync } from "fs";
import path from "path";
import type {
  BoardExecutiveDashboard,
  BoardFinanceOverlay,
} from "../board/executive-types";
import {
  getVolumeDecisionCard,
  getMarginDecisionCard,
  getCashDecisionCard,
  getCustomerDecisionCard,
} from "../board/decision-cards";
import { SECTION_LABELS } from "../operator-notes/types";
import {
  addDecisionCard,
  addKpiTwoRow,
  addAgingBuckets,
  DECK_BRAND as B,
  DECK_FONT_TITLE as FT,
  DECK_FONT_BODY as FB,
} from "./layouts";
import {
  formatGallons, formatDelta,
  formatDate, formatDateTime,
} from "./format";

const SLIDE_W = 13.33;
const MARGIN_X = 0.5;
const TOTAL_SLIDES = 10;

// ---------- public ----------

export async function generateMonthlyDeckV2(
  view: BoardExecutiveDashboard
): Promise<Buffer> {
  if (view.period.status !== "locked") {
    throw new Error(
      `generateMonthlyDeckV2: refuses to render unlocked period (status=${view.period.status})`
    );
  }
  if (!view.readiness.ready) {
    throw new Error(
      `generateMonthlyDeckV2: refuses to render unready period (blockers=${view.readiness.blockers.join(",")})`
    );
  }

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "U1Dynamics Manufacturing LLC";
  pptx.company = "Ultra1Plus / Ultrachem";
  pptx.title = `U1Dynamics Board Operating Review — ${view.period.label}`;

  const logo = loadOptionalLogo();
  const finance = view.finance;

  // Pre-compute decision cards for slides that need them.
  const dcVolume = getVolumeDecisionCard(view);
  const dcMargin = getMarginDecisionCard(view);
  const dcCash   = getCashDecisionCard(view);
  const dcCustomer = getCustomerDecisionCard(view);

  buildCoverV2(pptx, view, logo);
  buildDecisionSlide(pptx, view, finance);
  buildAtAGlance(pptx, view, finance);
  buildVolumeDetail(pptx, view, dcVolume);
  buildRevenueMarginDetail(pptx, view, finance, dcMargin);
  buildCashWorkingCapital(pptx, view, finance, dcCash);
  buildCustomerIntelligence(pptx, view, dcCustomer);
  buildOperationalNarrative(pptx, view);
  buildManagementAttention(pptx, view);
  buildCloseQualityAudit(pptx, view, finance);

  // pptxgenjs returns ArrayBuffer in node — wrap to Node Buffer.
  const buf = await pptx.write({ outputType: "nodebuffer" }) as unknown as Buffer;
  return buf;
}

export function deckFilenameV2(view: BoardExecutiveDashboard): string {
  const yy = view.period.year;
  const mm = String(view.period.month).padStart(2, "0");
  return `U1Dynamics_Board_Report_${yy}_${mm}.pptx`;
}

// ---------- shared helpers ----------

type LogoData = { path: string | null; ext: "png" | "jpg" | null };

function loadOptionalLogo(): LogoData {
  const p = process.env.U1D_DECK_LOGO_PATH;
  if (!p) return { path: null, ext: null };
  try {
    if (!existsSync(p)) return { path: null, ext: null };
    const ext = path.extname(p).toLowerCase();
    if (ext === ".png") return { path: p, ext: "png" };
    if (ext === ".jpg" || ext === ".jpeg") return { path: p, ext: "jpg" };
    return { path: null, ext: null };
  } catch {
    return { path: null, ext: null };
  }
}

function addHeroBand(slide: PptxGenJS.Slide, eyebrow: string, title: string, subtitle?: string) {
  // Navy band 0..1.05
  slide.addShape("rect", {
    x: 0, y: 0, w: SLIDE_W, h: 1.05,
    fill: { color: B.navy }, line: { color: B.navy, width: 0 },
  });
  // Red accent stripe at bottom of band
  slide.addShape("rect", {
    x: 0, y: 1.05, w: SLIDE_W, h: 0.05,
    fill: { color: B.red }, line: { color: B.red, width: 0 },
  });
  slide.addText(eyebrow, {
    x: MARGIN_X, y: 0.18, w: SLIDE_W - MARGIN_X * 2, h: 0.25,
    fontFace: FB, fontSize: 9, bold: true, color: B.white, charSpacing: 2,
  });
  slide.addText(title, {
    x: MARGIN_X, y: 0.40, w: SLIDE_W - MARGIN_X * 2, h: 0.42,
    fontFace: FT, fontSize: 24, bold: true, color: B.white,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: MARGIN_X, y: 0.78, w: SLIDE_W - MARGIN_X * 2, h: 0.22,
      fontFace: FB, fontSize: 11, italic: true, color: B.white,
    });
  }
}

function addFooter(slide: PptxGenJS.Slide, view: BoardExecutiveDashboard, pageNo: number) {
  const lockTxt = view.period.locked_at
    ? `Locked ${formatDate(view.period.locked_at)} · ${view.period.locked_by ?? "—"}`
    : "Unlocked";
  slide.addText(
    `U1Dynamics Manufacturing LLC · ${view.period.label} · ${lockTxt}`,
    {
      x: MARGIN_X, y: 7.15, w: SLIDE_W - MARGIN_X * 2 - 0.7, h: 0.25,
      fontFace: FB, fontSize: 8, color: B.mutedText,
    }
  );
  slide.addText(`${pageNo} / ${TOTAL_SLIDES}`, {
    x: SLIDE_W - MARGIN_X - 0.7, y: 7.15, w: 0.7, h: 0.25,
    fontFace: FB, fontSize: 8, color: B.mutedText, align: "right",
  });
}

function addSpeakerNotes(slide: PptxGenJS.Slide, notes: string) {
  if (notes.trim()) slide.addNotes(notes);
}

function moneyShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function pctOf(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// ---------- slide 1: Cover ----------

function buildCoverV2(pptx: PptxGenJS, view: BoardExecutiveDashboard, logo: LogoData) {
  const slide = pptx.addSlide();
  slide.background = { color: B.white };

  // Full-bleed navy band on the top half
  slide.addShape("rect", {
    x: 0, y: 0, w: SLIDE_W, h: 4.0,
    fill: { color: B.navy }, line: { color: B.navy, width: 0 },
  });
  slide.addShape("rect", {
    x: 0, y: 4.0, w: SLIDE_W, h: 0.06,
    fill: { color: B.red }, line: { color: B.red, width: 0 },
  });

  if (logo.path && logo.ext) {
    slide.addImage({ path: logo.path, x: MARGIN_X, y: 0.5, w: 1.2, h: 1.2 });
  }

  slide.addText("U1DYNAMICS MANUFACTURING LLC", {
    x: MARGIN_X + (logo.path ? 1.5 : 0), y: 0.85, w: SLIDE_W - MARGIN_X * 2 - 1.5, h: 0.3,
    fontFace: FB, fontSize: 11, bold: true, color: B.white, charSpacing: 3,
  });
  slide.addText("Board Operating Review", {
    x: MARGIN_X + (logo.path ? 1.5 : 0), y: 1.25, w: SLIDE_W - MARGIN_X * 2 - 1.5, h: 0.7,
    fontFace: FT, fontSize: 40, bold: true, color: B.white,
  });
  slide.addText(view.period.label, {
    x: MARGIN_X + (logo.path ? 1.5 : 0), y: 2.05, w: SLIDE_W - MARGIN_X * 2 - 1.5, h: 0.45,
    fontFace: FT, fontSize: 26, color: B.white,
  });
  slide.addText(
    view.period.locked_at
      ? `Locked ${formatDateTime(view.period.locked_at)} · ${view.period.locked_by ?? "—"} · v${view.activeFile?.version_no ?? "—"}`
      : "Locked period required to ship deck",
    {
      x: MARGIN_X + (logo.path ? 1.5 : 0), y: 2.55, w: SLIDE_W - MARGIN_X * 2 - 1.5, h: 0.25,
      fontFace: FB, fontSize: 11, italic: true, color: B.white,
    }
  );

  // Lower half — quick narrative pull-quote
  const totalGal = view.currentMetrics.total_gallons;
  const yoyText = view.priorYear?.delta_pct !== undefined && view.priorYear?.delta_pct !== null
    ? formatDelta(view.priorYear.delta_pct)
    : "no prior-year baseline";
  const finText = view.finance?.trailing_12m
    ? `Trailing 12M revenue ${moneyShort(view.finance.trailing_12m.income)} · gross margin ${pctOf(view.finance.trailing_12m.gross_margin_pct)} · net income ${moneyShort(view.finance.trailing_12m.net_income)}.`
    : "Financial overlay not available for this period — see slide 10 for disclosure.";

  slide.addText(
    `${formatGallons(totalGal)} gallons this month · YoY ${yoyText}.\n${finText}`,
    {
      x: MARGIN_X, y: 4.5, w: SLIDE_W - MARGIN_X * 2, h: 1.8,
      fontFace: FT, fontSize: 18, italic: true, color: B.darkText, valign: "top",
    }
  );

  slide.addText(`Generated ${formatDateTime(new Date().toISOString())}`, {
    x: MARGIN_X, y: 7.15, w: SLIDE_W - MARGIN_X * 2, h: 0.25,
    fontFace: FB, fontSize: 8, color: B.mutedText,
  });
}

// ---------- slide 2: Decision for Management ----------

function buildDecisionSlide(
  pptx: PptxGenJS,
  view: BoardExecutiveDashboard,
  finance: BoardFinanceOverlay | null
) {
  const slide = pptx.addSlide();
  slide.background = { color: B.white };
  addHeroBand(slide, "U1DYNAMICS MANUFACTURING LLC", "The decision in front of you", view.period.label);

  const volumePct = view.priorYear?.delta_pct;
  const totalGal = view.currentMetrics.total_gallons;

  let body: string;
  if (finance) {
    const gm = pctOf(finance.trailing_12m.gross_margin_pct);
    const ni = moneyShort(finance.trailing_12m.net_income);
    const rev = moneyShort(finance.trailing_12m.income);
    const vol = volumePct !== null && volumePct !== undefined ? formatDelta(volumePct) : "with no prior-year baseline";
    body =
      `U1Dynamics processed ${formatGallons(totalGal)} gallons in ${view.period.label} (${vol} YoY). ` +
      `Trailing 12-month revenue ${rev}; gross margin holds at ${gm}; net income ${ni}. ` +
      `The path to break-even requires a board decision on which lever to pull: ` +
      `(a) scale to absorb fixed costs, (b) external-account pricing discipline, ` +
      `(c) intercompany transfer pricing recalibration, or (d) operating-cost reduction. ` +
      `Each subsequent slide ends with a "Decision for Management" card framing what's being asked.`;
  } else {
    body =
      `U1Dynamics processed ${formatGallons(totalGal)} gallons in ${view.period.label}. ` +
      `Volume detail follows. Financial overlay is not available for this period (see slide 10). ` +
      `Subsequent slides ask the board to confirm the operational decisions visible from the volume data.`;
  }

  slide.addText(body, {
    x: MARGIN_X, y: 1.4, w: SLIDE_W - MARGIN_X * 2, h: 3.5,
    fontFace: FT, fontSize: 16, color: B.darkText, valign: "top",
  });

  // 4 headline KPIs across the bottom
  const tiles: { label: string; value: string; sub: string }[] = [
    { label: "VOLUME (this month)", value: formatGallons(totalGal), sub: `${view.currentMetrics.customer_count} customers · ${view.currentMetrics.package_count} packages` },
    { label: "VOLUME YoY", value: volumePct !== null && volumePct !== undefined ? formatDelta(volumePct) : "—", sub: view.priorYear ? `vs ${formatGallons(view.priorYear.total_gallons)} gal prior year` : "no prior year locked" },
    { label: "REVENUE (12M)", value: finance ? moneyShort(finance.trailing_12m.income) : "—", sub: finance ? `${finance.trailing_12m.months_included} months` : "no finance data" },
    { label: "GROSS MARGIN (12M)", value: finance ? pctOf(finance.trailing_12m.gross_margin_pct) : "—", sub: finance ? `net income ${moneyShort(finance.trailing_12m.net_income)}` : "—" },
  ];

  const tileY = 5.05;
  const tileH = 1.0;
  const tileW = (SLIDE_W - MARGIN_X * 2 - 0.18 * 3) / 4;
  tiles.forEach((t, i) => {
    const tx = MARGIN_X + i * (tileW + 0.18);
    slide.addShape("rect", { x: tx, y: tileY, w: tileW, h: tileH,
      fill: { color: B.lightGray }, line: { color: B.border, width: 0.5 } });
    slide.addText(t.label, { x: tx + 0.15, y: tileY + 0.1, w: tileW - 0.3, h: 0.22,
      fontFace: FB, fontSize: 8, bold: true, color: B.mutedText, charSpacing: 1.5 });
    slide.addText(t.value, { x: tx + 0.15, y: tileY + 0.3, w: tileW - 0.3, h: 0.4,
      fontFace: FT, fontSize: 18, bold: true, color: B.navy });
    slide.addText(t.sub, { x: tx + 0.15, y: tileY + 0.72, w: tileW - 0.3, h: 0.22,
      fontFace: FB, fontSize: 8, italic: true, color: B.mutedText });
  });

  addFooter(slide, view, 2);
  addSpeakerNotes(slide, finance
    ? `Open with the decision. Walk through volume (slide 4), margin (slide 5), cash (slide 6) before asking for the board's read.`
    : `Open with the decision. Financial overlay pending — flag on slide 10 and walk through volume detail.`);
}

// ---------- slide 3: At a Glance ----------

function buildAtAGlance(
  pptx: PptxGenJS,
  view: BoardExecutiveDashboard,
  finance: BoardFinanceOverlay | null
) {
  const slide = pptx.addSlide();
  slide.background = { color: B.white };
  addHeroBand(slide, "AT A GLANCE", view.period.label,
    finance ? "Volume from operations · money from QuickBooks canonical P&L."
            : "Volume from operations. Financial overlay not configured.");

  const volumeRow = [
    { label: "TOTAL GALLONS", value: formatGallons(view.currentMetrics.total_gallons),
      sub: "this month", tone: "navy" as const },
    { label: "MONTH OVER MONTH", value: view.priorMonth?.delta_pct !== null && view.priorMonth?.delta_pct !== undefined ? formatDelta(view.priorMonth.delta_pct) : "—",
      sub: view.priorMonth ? `vs ${formatGallons(view.priorMonth.total_gallons)} gal` : "no prior month locked",
      tone: (view.priorMonth?.delta_pct ?? 0) >= 0 ? "ok" as const : "warn" as const },
    { label: "YEAR OVER YEAR", value: view.priorYear?.delta_pct !== null && view.priorYear?.delta_pct !== undefined ? formatDelta(view.priorYear.delta_pct) : "—",
      sub: view.priorYear ? `vs ${formatGallons(view.priorYear.total_gallons)} gal prior year` : "no prior year locked",
      tone: (view.priorYear?.delta_pct ?? 0) >= 0 ? "ok" as const : "warn" as const },
    { label: "YTD GALLONS", value: formatGallons(view.ytd.current_year_gallons),
      sub: view.ytd.prior_year_gallons !== null && view.ytd.delta_pct !== null ? `${formatDelta(view.ytd.delta_pct)} vs prior YTD` : "no prior YTD",
      tone: "navy" as const },
  ];

  const moneyRow = finance
    ? [
        { label: "REVENUE (12M)", value: moneyShort(finance.trailing_12m.income),
          sub: `${finance.trailing_12m.months_included}/12 months`, tone: "navy" as const },
        { label: "GROSS MARGIN (12M)", value: pctOf(finance.trailing_12m.gross_margin_pct),
          sub: `${moneyShort(finance.trailing_12m.gross_profit)} gross profit`,
          tone: finance.trailing_12m.gross_margin_pct >= 0.25 ? "ok" as const : "warn" as const },
        { label: "NET INCOME (12M)", value: moneyShort(finance.trailing_12m.net_income),
          sub: pctOf(finance.trailing_12m.net_margin_pct) + " net margin",
          tone: finance.trailing_12m.net_income >= 0 ? "ok" as const : "warn" as const },
        { label: "WORKING CAPITAL", value: moneyShort(finance.working_capital.net_position),
          sub: `AR ${moneyShort(finance.working_capital.total_ar)} · AP ${moneyShort(finance.working_capital.total_ap)}`,
          tone: finance.working_capital.net_position >= 0 ? "ok" as const : "warn" as const },
      ]
    : [];

  addKpiTwoRow(slide, { volumeRow, moneyRow, y: 1.3, h: 4.4 });
  addFooter(slide, view, 3);
  addSpeakerNotes(slide,
    "Reads top-down: volume momentum first (row 1), then the money story (row 2). " +
    "Flag any tile that diverges from the others — e.g. volume up but revenue flat = mix shift to lower-priced channels."
  );
}

// ---------- slide 4: Volume Detail ----------

function buildVolumeDetail(
  pptx: PptxGenJS,
  view: BoardExecutiveDashboard,
  dc: ReturnType<typeof getVolumeDecisionCard>
) {
  const slide = pptx.addSlide();
  slide.background = { color: B.white };
  addHeroBand(slide, "VOLUME DETAIL", `${view.period.label} · trends and comparisons`);

  // Mini KPI strip
  const kpiY = 1.3;
  const kpiH = 0.95;
  const kpiW = (SLIDE_W - MARGIN_X * 2 - 0.18 * 2) / 3;
  const kpis = [
    { label: "THIS MONTH", value: formatGallons(view.currentMetrics.total_gallons) },
    { label: "PRIOR MONTH", value: view.priorMonth ? formatGallons(view.priorMonth.total_gallons) : "—" },
    { label: "SAME MONTH PRIOR YEAR", value: view.priorYear ? formatGallons(view.priorYear.total_gallons) : "—" },
  ];
  kpis.forEach((k, i) => {
    const x = MARGIN_X + i * (kpiW + 0.18);
    slide.addShape("rect", { x, y: kpiY, w: kpiW, h: kpiH,
      fill: { color: B.lightGray }, line: { color: B.border, width: 0.5 } });
    slide.addText(k.label, { x: x + 0.18, y: kpiY + 0.12, w: kpiW - 0.36, h: 0.22,
      fontFace: FB, fontSize: 9, bold: true, color: B.mutedText, charSpacing: 1.5 });
    slide.addText(k.value, { x: x + 0.18, y: kpiY + 0.34, w: kpiW - 0.36, h: 0.55,
      fontFace: FT, fontSize: 24, bold: true, color: B.navy });
  });

  // 12-month trend bars
  const chartY = 2.45;
  const chartH = 3.0;
  slide.addText("LAST 12 MONTHS", {
    x: MARGIN_X, y: chartY, w: SLIDE_W - MARGIN_X * 2, h: 0.25,
    fontFace: FB, fontSize: 9, bold: true, color: B.mutedText, charSpacing: 1.5,
  });
  const trend = view.trend12.length ? view.trend12 : view.trend6;
  const max = trend.reduce((m, r) => Math.max(m, r.total_gallons), 1);
  const barAreaY = chartY + 0.3;
  const barAreaH = chartH - 0.6;
  const barW = (SLIDE_W - MARGIN_X * 2) / Math.max(1, trend.length) - 0.05;
  trend.forEach((r, i) => {
    const x = MARGIN_X + i * (barW + 0.05);
    const h = (r.total_gallons / max) * barAreaH;
    const y = barAreaY + (barAreaH - h);
    slide.addShape("rect", {
      x, y, w: barW, h: Math.max(0.02, h),
      fill: { color: r.is_locked ? B.navy : B.lightGray },
      line: { color: r.is_locked ? B.navy : B.mutedText, width: 0.5 },
    });
    slide.addText(monthShort(r.period_month), {
      x: x - 0.05, y: barAreaY + barAreaH + 0.05, w: barW + 0.1, h: 0.2,
      fontFace: FB, fontSize: 7, color: B.mutedText, align: "center",
    });
  });

  addDecisionCard(slide, { body: dc.body, tone: dc.tone, y: 5.85 });
  addFooter(slide, view, 4);
  addSpeakerNotes(slide,
    "Trend shows whether this month is part of a pattern or a one-off. Navy = locked period; gray outline = unlocked (data not in YTD).");
}

// ---------- slide 5: Revenue & Margin Detail ----------

function buildRevenueMarginDetail(
  pptx: PptxGenJS,
  view: BoardExecutiveDashboard,
  finance: BoardFinanceOverlay | null,
  dc: ReturnType<typeof getMarginDecisionCard>
) {
  const slide = pptx.addSlide();
  slide.background = { color: B.white };
  addHeroBand(slide, "REVENUE & MARGIN", view.period.label,
    finance ? "Source: QuickBooks canonical P&L (monthly_pnl, accrual basis)." : undefined);

  if (!finance) {
    slide.addText("Financial overlay not configured for this period.\nSee slide 10 for the data-integrity disclosure.", {
      x: MARGIN_X, y: 3.0, w: SLIDE_W - MARGIN_X * 2, h: 1.5,
      fontFace: FT, fontSize: 16, italic: true, color: B.mutedText, align: "center", valign: "middle",
    });
    addFooter(slide, view, 5);
    return;
  }

  // 4 KPI cards
  const kpiY = 1.3;
  const kpiH = 1.05;
  const tileW = (SLIDE_W - MARGIN_X * 2 - 0.18 * 3) / 4;
  const tiles = [
    { label: "REVENUE", value: moneyShort(finance.trailing_12m.income), sub: "trailing 12 months" },
    { label: "COGS", value: moneyShort(finance.trailing_12m.cogs), sub: pctOf(finance.trailing_12m.cogs / Math.max(1, finance.trailing_12m.income)) + " of revenue" },
    { label: "GROSS PROFIT", value: moneyShort(finance.trailing_12m.gross_profit), sub: pctOf(finance.trailing_12m.gross_margin_pct) + " margin" },
    { label: "NET INCOME", value: moneyShort(finance.trailing_12m.net_income), sub: pctOf(finance.trailing_12m.net_margin_pct) + " net margin" },
  ];
  tiles.forEach((t, i) => {
    const x = MARGIN_X + i * (tileW + 0.18);
    const accent = i === 3 && finance.trailing_12m.net_income < 0 ? B.urgent
                  : i === 2 && finance.trailing_12m.gross_margin_pct < 0.25 ? B.warn
                  : B.navy;
    slide.addShape("rect", { x, y: kpiY, w: tileW, h: kpiH,
      fill: { color: B.white }, line: { color: B.border, width: 0.5 } });
    slide.addShape("rect", { x, y: kpiY, w: tileW, h: 0.06,
      fill: { color: accent }, line: { color: accent, width: 0 } });
    slide.addText(t.label, { x: x + 0.15, y: kpiY + 0.16, w: tileW - 0.3, h: 0.22,
      fontFace: FB, fontSize: 9, bold: true, color: B.mutedText, charSpacing: 1.5 });
    slide.addText(t.value, { x: x + 0.15, y: kpiY + 0.4, w: tileW - 0.3, h: 0.45,
      fontFace: FT, fontSize: 22, bold: true, color: B.navy });
    slide.addText(t.sub, { x: x + 0.15, y: kpiY + 0.78, w: tileW - 0.3, h: 0.25,
      fontFace: FB, fontSize: 9, italic: true, color: B.mutedText });
  });

  // Monthly revenue bar chart
  const chartY = 2.5;
  const chartH = 3.2;
  slide.addText("MONTHLY REVENUE — LAST 12", {
    x: MARGIN_X, y: chartY, w: SLIDE_W - MARGIN_X * 2, h: 0.25,
    fontFace: FB, fontSize: 9, bold: true, color: B.mutedText, charSpacing: 1.5,
  });
  const trend = finance.pnl_trend;
  if (trend.length > 0) {
    const max = trend.reduce((m, r) => Math.max(m, Number(r.income)), 1);
    const barAreaY = chartY + 0.3;
    const barAreaH = chartH - 0.6;
    const barW = (SLIDE_W - MARGIN_X * 2) / Math.max(1, trend.length) - 0.05;
    trend.forEach((r, i) => {
      const x = MARGIN_X + i * (barW + 0.05);
      const h = (Number(r.income) / max) * barAreaH;
      const y = barAreaY + (barAreaH - h);
      slide.addShape("rect", {
        x, y, w: barW, h: Math.max(0.02, h),
        fill: { color: B.navy }, line: { color: B.navy, width: 0 },
      });
      const lbl = r.month.slice(5, 7) + "/" + r.month.slice(2, 4);
      slide.addText(lbl, {
        x: x - 0.05, y: barAreaY + barAreaH + 0.05, w: barW + 0.1, h: 0.2,
        fontFace: FB, fontSize: 7, color: B.mutedText, align: "center",
      });
    });
  } else {
    slide.addText("No trend data available.", {
      x: MARGIN_X, y: chartY + 0.4, w: SLIDE_W - MARGIN_X * 2, h: 0.3,
      fontFace: FB, fontSize: 11, italic: true, color: B.mutedText,
    });
  }

  if (dc) addDecisionCard(slide, { body: dc.body, tone: dc.tone, y: 5.85 });
  addFooter(slide, view, 5);
  addSpeakerNotes(slide,
    `Revenue from QuickBooks ProfitAndLossStandard report — the canonical number. Distinct from invoice-line aggregations until data-pipeline verification completes (slide 10).`);
}

// ---------- slide 6: Cash & Working Capital ----------

function buildCashWorkingCapital(
  pptx: PptxGenJS,
  view: BoardExecutiveDashboard,
  finance: BoardFinanceOverlay | null,
  dc: ReturnType<typeof getCashDecisionCard>
) {
  const slide = pptx.addSlide();
  slide.background = { color: B.white };
  addHeroBand(slide, "CASH & WORKING CAPITAL", view.period.label,
    finance ? "Source: v_latest_ar_aging + v_latest_ap_aging (QuickBooks aging reports)." : undefined);

  if (!finance || (finance.working_capital.total_ar === 0 && finance.working_capital.total_ap === 0)) {
    slide.addText("Aging data not available.\nSee slide 10 for the data-integrity disclosure.", {
      x: MARGIN_X, y: 3.0, w: SLIDE_W - MARGIN_X * 2, h: 1.5,
      fontFace: FT, fontSize: 16, italic: true, color: B.mutedText, align: "center", valign: "middle",
    });
    addFooter(slide, view, 6);
    return;
  }

  const wc = finance.working_capital;

  // Net-position tile (large, full-width)
  const npY = 1.3;
  const npH = 1.0;
  slide.addShape("rect", { x: MARGIN_X, y: npY, w: SLIDE_W - MARGIN_X * 2, h: npH,
    fill: { color: B.lightGray }, line: { color: B.border, width: 0.5 } });
  slide.addText("NET WORKING CAPITAL POSITION", {
    x: MARGIN_X + 0.2, y: npY + 0.1, w: 5, h: 0.25,
    fontFace: FB, fontSize: 9, bold: true, color: B.mutedText, charSpacing: 1.5,
  });
  slide.addText(moneyShort(wc.net_position), {
    x: MARGIN_X + 0.2, y: npY + 0.32, w: 5, h: 0.6,
    fontFace: FT, fontSize: 30, bold: true,
    color: wc.net_position >= 0 ? B.ok : B.urgent,
  });
  slide.addText(
    `AR ${moneyShort(wc.total_ar)}   ·   AP ${moneyShort(wc.total_ap)}` +
    (wc.ap_to_ar_ratio !== null ? `   ·   AP/AR ${wc.ap_to_ar_ratio.toFixed(2)}×` : ""),
    {
      x: SLIDE_W / 2, y: npY + 0.32, w: SLIDE_W / 2 - MARGIN_X - 0.2, h: 0.6,
      fontFace: FT, fontSize: 16, color: B.darkText, align: "right", valign: "middle",
    }
  );

  // Two aging cards side by side
  const cardY = 2.5;
  const cardH = 3.25;
  const cardW = (SLIDE_W - MARGIN_X * 2 - 0.3) / 2;
  addAgingBuckets(slide, {
    title: "ACCOUNTS RECEIVABLE",
    buckets: [
      { label: "Current", value: wc.ar_aging.current_bucket, color: B.ok },
      { label: "1–30", value: wc.ar_aging.days_1_30, color: B.navy },
      { label: "31–60", value: wc.ar_aging.days_31_60, color: B.warn },
      { label: "61–90", value: wc.ar_aging.days_61_90, color: B.warn },
      { label: "90+", value: wc.ar_aging.days_91_plus, color: B.urgent },
    ],
    topConcentration: wc.ar_top_concentration ?? undefined,
    x: MARGIN_X, y: cardY, w: cardW, h: cardH,
  });
  addAgingBuckets(slide, {
    title: "ACCOUNTS PAYABLE",
    buckets: [
      { label: "Current", value: wc.ap_aging.current_bucket, color: B.ok },
      { label: "1–30", value: wc.ap_aging.days_1_30, color: B.navy },
      { label: "31–60", value: wc.ap_aging.days_31_60, color: B.warn },
      { label: "61–90", value: wc.ap_aging.days_61_90, color: B.warn },
      { label: "90+", value: wc.ap_aging.days_91_plus, color: B.urgent },
    ],
    topConcentration: wc.ap_top_concentration ?? undefined,
    x: MARGIN_X + cardW + 0.3, y: cardY, w: cardW, h: cardH,
  });

  if (dc) addDecisionCard(slide, { body: dc.body, tone: dc.tone, y: 5.85 });
  addFooter(slide, view, 6);
  addSpeakerNotes(slide,
    "Working capital position is the single most important cash signal. AP running materially above AR means operations are funded by vendor credit.");
}

// ---------- slide 7: Customer Intelligence (volume only) ----------

function buildCustomerIntelligence(
  pptx: PptxGenJS,
  view: BoardExecutiveDashboard,
  dc: ReturnType<typeof getCustomerDecisionCard>
) {
  const slide = pptx.addSlide();
  slide.background = { color: B.white };
  addHeroBand(slide, "CUSTOMER INTELLIGENCE", view.period.label,
    "Volume-based view only · per-customer revenue analysis pending data-pipeline verification (slide 10).");

  // Concentration strip
  const cY = 1.3;
  const cH = 1.05;
  const cells = [
    { label: "TOP CUSTOMER", value: view.customerConcentration.top_customer_share !== null ? pctOf(view.customerConcentration.top_customer_share) : "—",
      sub: view.customerConcentration.top_customer_name ?? "—" },
    { label: "TOP 5 SHARE", value: view.customerConcentration.top5_share !== null ? pctOf(view.customerConcentration.top5_share) : "—", sub: "combined" },
    { label: "INTERCOMPANY", value: view.customerConcentration.intercompany_share !== null ? pctOf(view.customerConcentration.intercompany_share) : "—", sub: "of total gallons" },
    { label: "EXTERNAL", value: view.customerConcentration.external_share !== null ? pctOf(view.customerConcentration.external_share) : "—", sub: "non-intercompany" },
  ];
  const tileW = (SLIDE_W - MARGIN_X * 2 - 0.18 * 3) / 4;
  cells.forEach((t, i) => {
    const x = MARGIN_X + i * (tileW + 0.18);
    slide.addShape("rect", { x, y: cY, w: tileW, h: cH,
      fill: { color: B.lightGray }, line: { color: B.border, width: 0.5 } });
    slide.addText(t.label, { x: x + 0.15, y: cY + 0.12, w: tileW - 0.3, h: 0.22,
      fontFace: FB, fontSize: 9, bold: true, color: B.mutedText, charSpacing: 1.5 });
    slide.addText(t.value, { x: x + 0.15, y: cY + 0.34, w: tileW - 0.3, h: 0.45,
      fontFace: FT, fontSize: 22, bold: true, color: B.navy });
    slide.addText(t.sub, { x: x + 0.15, y: cY + 0.78, w: tileW - 0.3, h: 0.22,
      fontFace: FB, fontSize: 8, italic: true, color: B.mutedText });
  });

  // Top customers table
  const tableY = 2.55;
  slide.addText("TOP CUSTOMERS — BY GALLONS", {
    x: MARGIN_X, y: tableY, w: SLIDE_W - MARGIN_X * 2, h: 0.25,
    fontFace: FB, fontSize: 9, bold: true, color: B.mutedText, charSpacing: 1.5,
  });

  const rowsToShow = view.topCustomers.slice(0, 8);
  const headerRow: PptxGenJS.TableRow = [
    { text: "#",        options: { bold: true, color: B.mutedText, fill: { color: B.lightGray } } },
    { text: "Customer", options: { bold: true, color: B.mutedText, fill: { color: B.lightGray } } },
    { text: "Gallons",  options: { bold: true, color: B.mutedText, fill: { color: B.lightGray }, align: "right" } },
    { text: "Share",    options: { bold: true, color: B.mutedText, fill: { color: B.lightGray }, align: "right" } },
    { text: "MoM",      options: { bold: true, color: B.mutedText, fill: { color: B.lightGray }, align: "right" } },
    { text: "YoY",      options: { bold: true, color: B.mutedText, fill: { color: B.lightGray }, align: "right" } },
  ];
  const bodyRows: PptxGenJS.TableRow[] = rowsToShow.map((r, i) => {
    const banding = i % 2 === 1 ? { fill: { color: B.banding } } : {};
    return [
      { text: String(i + 1), options: { color: B.mutedText, ...banding } },
      { text: r.customer_name + (r.is_intercompany ? "  (intercomp.)" : ""), options: { color: B.darkText, ...banding } },
      { text: formatGallons(r.gallons), options: { align: "right", ...banding } },
      { text: r.share_pct !== null ? pctOf(r.share_pct) : "—", options: { align: "right", ...banding } },
      { text: r.mom_delta_pct !== null ? formatDelta(r.mom_delta_pct) : "—",
        options: { align: "right", color: (r.mom_delta_pct ?? 0) >= 0 ? B.ok : B.urgent, ...banding } },
      { text: r.yoy_delta_pct !== null ? formatDelta(r.yoy_delta_pct) : "—",
        options: { align: "right", color: (r.yoy_delta_pct ?? 0) >= 0 ? B.ok : B.urgent, ...banding } },
    ];
  });
  slide.addTable([headerRow, ...bodyRows], {
    x: MARGIN_X, y: tableY + 0.3, w: SLIDE_W - MARGIN_X * 2,
    fontFace: FB, fontSize: 9,
    colW: [0.4, 5.5, 1.5, 1.0, 1.0, 1.0],
    rowH: 0.28,
    border: { type: "solid", pt: 0.5, color: B.border },
  });

  addDecisionCard(slide, { body: dc.body, tone: dc.tone, y: 5.85 });
  addFooter(slide, view, 7);
  addSpeakerNotes(slide,
    "Volume-only customer view. Per-customer revenue and margin pending QuickBooks invoice-line reconciliation (see slide 10).");
}

// ---------- slide 8: Operational Narrative ----------

function buildOperationalNarrative(pptx: PptxGenJS, view: BoardExecutiveDashboard) {
  const slide = pptx.addSlide();
  slide.background = { color: B.white };
  addHeroBand(slide, "OPERATIONAL NARRATIVE", view.period.label, "Operator-authored notes for this close.");

  const colW = (SLIDE_W - MARGIN_X * 2 - 0.4) / 3;
  const sections = [
    { key: "capacity_production", label: SECTION_LABELS.capacity_production },
    { key: "supply_chain",        label: SECTION_LABELS.supply_chain },
    { key: "quality_incidents",   label: SECTION_LABELS.quality_incidents },
  ] as const;
  sections.forEach((s, i) => {
    const x = MARGIN_X + i * (colW + 0.2);
    slide.addShape("rect", { x, y: 1.3, w: colW, h: 5.6,
      fill: { color: B.white }, line: { color: B.border, width: 0.5 } });
    slide.addShape("rect", { x, y: 1.3, w: colW, h: 0.06,
      fill: { color: B.navy }, line: { color: B.navy, width: 0 } });
    slide.addText(s.label, { x: x + 0.18, y: 1.45, w: colW - 0.36, h: 0.3,
      fontFace: FB, fontSize: 10, bold: true, color: B.navy, charSpacing: 1.5 });
    const note = view.operatorNotes ? (view.operatorNotes as Record<string, string>)[s.key] : "";
    slide.addText(note || "—", {
      x: x + 0.18, y: 1.85, w: colW - 0.36, h: 4.9,
      fontFace: FB, fontSize: 10, color: B.bodyText, valign: "top",
    });
  });

  addFooter(slide, view, 8);
  addSpeakerNotes(slide, "Operator-authored monthly narrative. No decision card on this slide — context only.");
}

// ---------- slide 9: Management Attention ----------

function buildManagementAttention(pptx: PptxGenJS, view: BoardExecutiveDashboard) {
  const slide = pptx.addSlide();
  slide.background = { color: B.white };
  addHeroBand(slide, "MANAGEMENT ATTENTION", view.period.label, "Initiatives + risks for the board's awareness.");

  const colW = (SLIDE_W - MARGIN_X * 2 - 0.3) / 2;
  const sections = [
    { key: "initiatives", label: SECTION_LABELS.initiatives, accent: B.navy },
    { key: "risks",       label: SECTION_LABELS.risks,       accent: B.warn },
  ] as const;
  sections.forEach((s, i) => {
    const x = MARGIN_X + i * (colW + 0.3);
    slide.addShape("rect", { x, y: 1.3, w: colW, h: 5.6,
      fill: { color: B.white }, line: { color: B.border, width: 0.5 } });
    slide.addShape("rect", { x, y: 1.3, w: 0.08, h: 5.6,
      fill: { color: s.accent }, line: { color: s.accent, width: 0 } });
    slide.addText(s.label, { x: x + 0.25, y: 1.45, w: colW - 0.45, h: 0.3,
      fontFace: FB, fontSize: 10, bold: true, color: s.accent, charSpacing: 1.5 });
    const note = view.operatorNotes ? (view.operatorNotes as Record<string, string>)[s.key] : "";
    slide.addText(note || "—", {
      x: x + 0.25, y: 1.85, w: colW - 0.45, h: 4.9,
      fontFace: FB, fontSize: 11, color: B.bodyText, valign: "top",
    });
  });

  addFooter(slide, view, 9);
  addSpeakerNotes(slide, "Strategic agenda for the board. Operator override of auto-decision-cards lands here in PR 012C.");
}

// ---------- slide 10: Close Quality & Audit + Data Integrity ----------

function buildCloseQualityAudit(
  pptx: PptxGenJS,
  view: BoardExecutiveDashboard,
  finance: BoardFinanceOverlay | null
) {
  const slide = pptx.addSlide();
  slide.background = { color: B.white };
  addHeroBand(slide, "CLOSE QUALITY & DATA INTEGRITY", view.period.label,
    "Audit trail + disclosure of what's verified vs pending.");

  // Top row — 5 stat cards
  const stripY = 1.3;
  const stripH = 1.05;
  const stripW = (SLIDE_W - MARGIN_X * 2 - 0.15 * 4) / 5;
  const stats = [
    { label: "ALERTS RESOLVED",     value: String(view.alertSummary.resolved_alerts_total) },
    { label: "PACKAGE ALERTS",      value: String(view.alertSummary.package_alerts_total) },
    { label: "CUSTOMER ALERTS",     value: String(view.alertSummary.customer_alerts_total) },
    { label: "DATA QUALITY ALERTS", value: String(view.alertSummary.data_quality_alerts_total) },
    { label: "REOPENS",             value: String(view.reopenCount) },
  ];
  stats.forEach((s, i) => {
    const x = MARGIN_X + i * (stripW + 0.15);
    slide.addShape("rect", { x, y: stripY, w: stripW, h: stripH,
      fill: { color: B.lightGray }, line: { color: B.border, width: 0.5 } });
    slide.addText(s.label, { x: x + 0.12, y: stripY + 0.12, w: stripW - 0.24, h: 0.4,
      fontFace: FB, fontSize: 8, bold: true, color: B.mutedText, charSpacing: 1.2 });
    slide.addText(s.value, { x: x + 0.12, y: stripY + 0.45, w: stripW - 0.24, h: 0.5,
      fontFace: FT, fontSize: 22, bold: true, color: B.navy });
  });

  // Data integrity disclosure box
  const dY = 2.55;
  const dH = 3.3;
  slide.addShape("rect", { x: MARGIN_X, y: dY, w: SLIDE_W - MARGIN_X * 2, h: dH,
    fill: { color: B.lightGray }, line: { color: B.border, width: 0.5 } });
  slide.addText("DATA INTEGRITY DISCLOSURE", {
    x: MARGIN_X + 0.2, y: dY + 0.12, w: SLIDE_W - MARGIN_X * 2 - 0.4, h: 0.28,
    fontFace: FB, fontSize: 10, bold: true, color: B.navy, charSpacing: 1.5,
  });

  const lines: string[] = [
    `• Volume metrics (gallons, customer count, package count, intercompany / external split) sourced from U1Dynamics' own validated and locked dataset. Authoritative.`,
  ];
  if (finance) {
    lines.push(
      `• Revenue, COGS, gross margin, net income sourced from QuickBooks canonical P&L (monthly_pnl table, accrual basis). Authoritative.`,
      `• AR / AP aging sourced from QuickBooks aging reports (v_latest_ar_aging / v_latest_ap_aging views). Authoritative.`,
      `• Data freshness: ${finance.sync_assessment.worst_status === "ok" ? "All 12 finance sync jobs current." : finance.sync_assessment.worst_status === "stale" ? `${finance.sync_assessment.jobs_stale} of ${finance.sync_assessment.total_jobs} sync jobs stale (>24h).` : `${finance.sync_assessment.jobs_error} sync job(s) in error state — investigate before relying on numbers.`}`,
      `• Per-customer revenue, per-product margin, channel-mix dollar splits, and intercompany variance are PENDING data-pipeline verification (invoice-line reconciliation in progress on the connector). Volume-side per-customer analysis remains authoritative — see slide 7.`,
    );
  } else {
    lines.push(
      `• Financial overlay (revenue, margin, working capital) NOT AVAILABLE for this period. Cause: U1D_FINANCE_DATABASE_URL not configured, finance database unreachable, or no synced data yet for this period.`,
      `• Per-customer revenue and margin analyses are deferred until the data pipeline is verified.`,
    );
  }
  if (view.activeFile) {
    lines.push(
      `• Active file: ${view.activeFile.filename} (v${view.activeFile.version_no}, hash ${view.activeFile.file_hash_prefix}). Uploaded ${formatDateTime(view.activeFile.uploaded_at)} by ${view.activeFile.uploaded_by ?? "—"}. Locked ${formatDateTime(view.period.locked_at ?? "")} by ${view.period.locked_by ?? "—"}.`
    );
  }
  if (view.activeFile?.has_total_discrepancy) {
    lines.push(`• Source TOTAL row flagged with discrepancy. Volume facts use the reconstructed per-customer sum, not the source TOTAL.`);
  }

  slide.addText(lines.join("\n\n"), {
    x: MARGIN_X + 0.2, y: dY + 0.45, w: SLIDE_W - MARGIN_X * 2 - 0.4, h: dH - 0.6,
    fontFace: FB, fontSize: 9, color: B.bodyText, valign: "top",
  });

  addFooter(slide, view, 10);
  addSpeakerNotes(slide,
    "Walk the disclosure aloud. The point is what's verified vs pending. This earns the right to ask the board for decisions on the upstream slides.");
}

// ---------- misc ----------

function monthShort(m: number): string {
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1] ?? `M${m}`;
}
