/**
 * src/lib/deck/layouts.ts
 *
 * PR 012B — slide layout primitives shared by the v2 deck generator.
 *
 * Three helpers:
 *   - addDecisionCard      → bottom-of-slide "Decision for Management" panel
 *   - addKpiTwoRow         → executive snapshot with separate VOLUME / MONEY rows
 *   - addAgingBuckets      → AR/AP aging bar chart + top-concentration tile
 *
 * Keep these pure (no DB / IO). They take a pptxgenjs Slide + opts and
 * draw shapes. Brand constants + font names are imported from the shared
 * deck-brand module so v1 and v2 stay aligned.
 */
import type PptxGenJS from "pptxgenjs";
import type { DecisionTone } from "../board/decision-cards";

// ---- Shared brand (subset; v1 has its own copy) ----

export const DECK_BRAND = {
  navy:     "003C71",
  navyDeep: "002647",
  red:      "E1261C",
  ok:       "047857",
  warn:     "B45309",
  urgent:   "B91C1C",
  darkText: "1F2937",
  bodyText: "374151",
  mutedText:"6B7280",
  lightGray:"F3F4F6",
  border:   "D1D5DB",
  banding:  "F9FAFB",
  white:    "FFFFFF",
} as const;

export const DECK_FONT_TITLE = "Georgia";
export const DECK_FONT_BODY = "Calibri";

// ---------------------------------------------------------------------------
// addDecisionCard — anchored at the bottom of a slide
// ---------------------------------------------------------------------------

export type AddDecisionCardOpts = {
  body: string;
  tone?: DecisionTone;
  /** Top of the card in inches. Defaults to 5.85 (leaves room above for chart). */
  y?: number;
  /** Card height in inches. Defaults to 0.95. */
  h?: number;
  /** Margin from slide edges in inches. Defaults to 0.5. */
  marginX?: number;
};

export function addDecisionCard(slide: PptxGenJS.Slide, o: AddDecisionCardOpts): void {
  const y = o.y ?? 5.85;
  const h = o.h ?? 0.95;
  const marginX = o.marginX ?? 0.5;
  const w = 13.33 - marginX * 2;

  const accent =
    o.tone === "urgent" ? DECK_BRAND.urgent
      : o.tone === "attention" ? DECK_BRAND.warn
      : DECK_BRAND.navy;

  // Card background
  slide.addShape("rect", {
    x: marginX, y, w, h,
    fill: { color: DECK_BRAND.lightGray },
    line: { color: DECK_BRAND.border, width: 0.5 },
  });
  // Left accent stripe (navy / amber / red)
  slide.addShape("rect", {
    x: marginX, y, w: 0.08, h,
    fill: { color: accent }, line: { color: accent, width: 0 },
  });
  // Eyebrow label
  slide.addText("DECISION FOR MANAGEMENT", {
    x: marginX + 0.25, y: y + 0.08, w: w - 0.4, h: 0.22,
    fontFace: DECK_FONT_BODY, fontSize: 9, bold: true,
    color: accent, charSpacing: 2,
  });
  // Body
  slide.addText(o.body, {
    x: marginX + 0.25, y: y + 0.32, w: w - 0.4, h: h - 0.36,
    fontFace: DECK_FONT_TITLE, fontSize: 12, italic: true,
    color: DECK_BRAND.darkText, valign: "top",
  });
}

// ---------------------------------------------------------------------------
// addKpiTwoRow — two-row executive snapshot (volume / money)
// ---------------------------------------------------------------------------

export type KpiTile = {
  label: string;
  value: string;
  sub?: string;
  /** Visual accent color hint. Defaults to navy. */
  tone?: "navy" | "ok" | "warn" | "red" | "neutral";
};

export type AddKpiTwoRowOpts = {
  /** Top of the grid. Default 1.3 (under hero band). */
  y?: number;
  /** Total grid height. Default 4.0 (two rows × ~1.85 each + gap). */
  h?: number;
  /** Margin from slide edges. Default 0.5. */
  marginX?: number;
  volumeRow: KpiTile[];     // 4 tiles
  moneyRow: KpiTile[];      // 4 tiles (use empty `[]` to suppress when no finance)
  /** Row labels printed above each row. */
  rowLabels?: { volume: string; money: string };
};

const TONE_ACCENT: Record<NonNullable<KpiTile["tone"]>, string> = {
  navy: DECK_BRAND.navy,
  ok: DECK_BRAND.ok,
  warn: DECK_BRAND.warn,
  red: DECK_BRAND.urgent,
  neutral: DECK_BRAND.mutedText,
};

export function addKpiTwoRow(slide: PptxGenJS.Slide, o: AddKpiTwoRowOpts): void {
  const y = o.y ?? 1.3;
  const h = o.h ?? 4.0;
  const marginX = o.marginX ?? 0.5;
  const labels = o.rowLabels ?? { volume: "VOLUME (THIS MONTH)", money: "MONEY (TRAILING 12 MONTHS)" };

  const totalW = 13.33 - marginX * 2;
  const hasMoney = o.moneyRow.length > 0;
  const rowGap = 0.18;
  const labelH = 0.22;
  const rowH = hasMoney ? (h - 2 * labelH - rowGap) / 2 : h - labelH;
  const tileW = (totalW - 3 * 0.18) / 4; // 4 tiles, 3 gaps of 0.18"

  // Volume row label
  slide.addText(labels.volume, {
    x: marginX, y, w: totalW, h: labelH,
    fontFace: DECK_FONT_BODY, fontSize: 9, bold: true,
    color: DECK_BRAND.mutedText, charSpacing: 2,
  });
  drawTileRow(slide, o.volumeRow.slice(0, 4), marginX, y + labelH, tileW, rowH);

  if (hasMoney) {
    const moneyY = y + labelH + rowH + rowGap;
    slide.addText(labels.money, {
      x: marginX, y: moneyY, w: totalW, h: labelH,
      fontFace: DECK_FONT_BODY, fontSize: 9, bold: true,
      color: DECK_BRAND.mutedText, charSpacing: 2,
    });
    drawTileRow(slide, o.moneyRow.slice(0, 4), marginX, moneyY + labelH, tileW, rowH);
  }
}

function drawTileRow(
  slide: PptxGenJS.Slide,
  tiles: KpiTile[],
  startX: number, y: number, w: number, h: number
): void {
  const gap = 0.18;
  tiles.forEach((tile, i) => {
    const x = startX + i * (w + gap);
    const accent = TONE_ACCENT[tile.tone ?? "navy"];

    // Card
    slide.addShape("rect", {
      x, y, w, h,
      fill: { color: DECK_BRAND.white },
      line: { color: DECK_BRAND.border, width: 0.5 },
    });
    // Top accent stripe
    slide.addShape("rect", {
      x, y, w, h: 0.06,
      fill: { color: accent }, line: { color: accent, width: 0 },
    });
    // Label
    slide.addText(tile.label, {
      x: x + 0.15, y: y + 0.18, w: w - 0.3, h: 0.25,
      fontFace: DECK_FONT_BODY, fontSize: 9, bold: true,
      color: DECK_BRAND.mutedText, charSpacing: 1.5,
    });
    // Value
    slide.addText(tile.value, {
      x: x + 0.15, y: y + 0.46, w: w - 0.3, h: 0.85,
      fontFace: DECK_FONT_TITLE, fontSize: 28, bold: true,
      color: DECK_BRAND.navy, valign: "top",
    });
    // Sub
    if (tile.sub) {
      slide.addText(tile.sub, {
        x: x + 0.15, y: y + h - 0.42, w: w - 0.3, h: 0.32,
        fontFace: DECK_FONT_BODY, fontSize: 10, italic: true,
        color: DECK_BRAND.mutedText, valign: "top",
      });
    }
  });
}

// ---------------------------------------------------------------------------
// addAgingBuckets — AR or AP aging visual
// ---------------------------------------------------------------------------

export type AgingBucket = {
  label: string;      // "Current", "1-30", "31-60", "61-90", "90+"
  value: number;      // dollars
  color?: string;     // hex without '#'; defaults to navy
};

export type AddAgingBucketsOpts = {
  title: string;       // "AR aging" or "AP aging"
  buckets: AgingBucket[];
  topConcentration?: { name: string; share_pct: number; balance: number };
  x: number; y: number; w: number; h: number;
};

export function addAgingBuckets(slide: PptxGenJS.Slide, o: AddAgingBucketsOpts): void {
  const { x, y, w, h, title, buckets, topConcentration } = o;
  // Card shell
  slide.addShape("rect", {
    x, y, w, h,
    fill: { color: DECK_BRAND.white },
    line: { color: DECK_BRAND.border, width: 0.5 },
  });
  // Title
  slide.addText(title, {
    x: x + 0.18, y: y + 0.12, w: w - 0.36, h: 0.3,
    fontFace: DECK_FONT_TITLE, fontSize: 14, bold: true,
    color: DECK_BRAND.navy,
  });
  // Total
  const total = buckets.reduce((s, b) => s + b.value, 0);
  slide.addText(`Total ${formatUsd(total)}`, {
    x: x + 0.18, y: y + 0.42, w: w - 0.36, h: 0.22,
    fontFace: DECK_FONT_BODY, fontSize: 10, italic: true,
    color: DECK_BRAND.mutedText,
  });

  // Bars
  const barsY = y + 0.74;
  const barsH = h - 0.74 - (topConcentration ? 0.6 : 0.2);
  const max = Math.max(1, ...buckets.map((b) => b.value));
  const barGap = 0.06;
  const barW = (w - 0.36 - barGap * (buckets.length - 1)) / buckets.length;

  buckets.forEach((b, i) => {
    const bx = x + 0.18 + i * (barW + barGap);
    const barFracH = b.value > 0 ? (b.value / max) * (barsH - 0.4) : 0;
    const barY = barsY + (barsH - 0.4 - barFracH);
    // Bar
    if (barFracH > 0) {
      slide.addShape("rect", {
        x: bx, y: barY, w: barW, h: barFracH,
        fill: { color: b.color ?? DECK_BRAND.navy },
        line: { color: b.color ?? DECK_BRAND.navy, width: 0 },
      });
    }
    // Value above bar
    if (b.value > 0) {
      slide.addText(formatUsd(b.value), {
        x: bx - 0.05, y: barY - 0.22, w: barW + 0.1, h: 0.18,
        fontFace: DECK_FONT_BODY, fontSize: 8,
        color: DECK_BRAND.darkText, align: "center",
      });
    }
    // Label below bars
    slide.addText(b.label, {
      x: bx - 0.05, y: barsY + barsH - 0.32, w: barW + 0.1, h: 0.2,
      fontFace: DECK_FONT_BODY, fontSize: 9,
      color: DECK_BRAND.mutedText, align: "center",
    });
  });

  // Top concentration footer
  if (topConcentration) {
    slide.addText(
      `Top: ${truncate(topConcentration.name, 28)} — ${formatUsd(topConcentration.balance)} (${(topConcentration.share_pct * 100).toFixed(0)}%)`,
      {
        x: x + 0.18, y: y + h - 0.5, w: w - 0.36, h: 0.32,
        fontFace: DECK_FONT_BODY, fontSize: 9,
        color: DECK_BRAND.bodyText, italic: true,
      }
    );
  }
}

// ---------- internal helpers ----------

function formatUsd(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
