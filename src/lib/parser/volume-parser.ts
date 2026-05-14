/**
 * Parser for U1DYNAMICS_VOLUME_*.xlsx files.
 *
 * TypeScript port of the validated Python parser, tested against 32 source
 * files (Jan 2023 → Mar 2026, with the Jan-Jul 2024 gap). It captures:
 *   - per-customer × per-package rows
 *   - validation of the source TOTAL row vs the reconstructed sum
 *   - a discrepancy flag (FY2024 Sep/Nov/Dec sub-report by -450 gal because
 *     TERRA is missing from the source file's TOTAL formula)
 */
import ExcelJS from "exceljs";
import { createHash } from "crypto";

export const CUSTOMER_KEYS = [
  "ULTRACHEM",
  "LUBRIMAR",
  "SUN COAST RESOURCES",
  "KEY PERFORMANCE",
  "TERRA DISTRIBUTORS",
] as const;

export const PACKAGE_KEYS = [
  "LITER OIL", "LITER COOL",
  "GAL OIL", "GAL COOL", "GAL WW",
  "JUG OIL", "JUG COOL",
  "PAIL OIL", "PAIL COOL",
  "JERRYCAN OIL", "JERRYCAN COOL",
  "DRUM OIL", "DRUM COOL",
  "TOTE OIL", "TOTE COOL",
  "BOX OIL", "BOX COOL", "BOX WW",
  "BULK OIL", "BULK COOL",
  "DEF",
] as const;

export type VolumeFactRow = {
  customer_key: string;
  package_key: string;
  gallons: number;
};

export type ParsedVolumeFile = {
  rows: VolumeFactRow[];
  computed_customer_sum: number;
  source_total_row: number | null;
  has_total_discrepancy: boolean;
  discrepancy_amount: number | null;
  file_hash: string;
};

// Helper: pull a number out of an ExcelJS cell value, which may be a
// primitive or a formula object with { result, formula }.
function cellNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") {
    const n = Number(value);
    return isNaN(n) ? 0 : n;
  }
  if (typeof value === "object" && value !== null && "result" in value) {
    const r = (value as { result: unknown }).result;
    if (typeof r === "number") return r;
    const n = Number(r);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

export async function parseVolumeFile(
  buffer: Buffer
): Promise<ParsedVolumeFile> {
  const workbook = new ExcelJS.Workbook();
  // exceljs.load expects a Buffer; Node 22 types now declare it as
  // Buffer<ArrayBufferLike> which differs — the cast is safe here.
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  // Find the SUMMARY sheet (its exact name varies per month:
  // "SUMMARY JAN 25", "SUMMARY DECEMBER 2025", "SUMMARY MARCH 2026", etc.)
  const summarySheet = workbook.worksheets.find((s) =>
    s.name.toUpperCase().startsWith("SUMMARY")
  );
  if (!summarySheet) {
    throw new Error("No sheet with a SUMMARY prefix found in the workbook");
  }

  // Find the CHANNEL header row (package columns) and each customer row
  let headerRow: ExcelJS.Row | null = null;
  let totalRow: ExcelJS.Row | null = null;
  const customerRows = new Map<string, ExcelJS.Row>();

  summarySheet.eachRow((row: ExcelJS.Row) => {
    const first = row.getCell(1).value;
    if (first === "CHANNEL" && !headerRow) {
      headerRow = row;
      return;
    }
    if (headerRow && first !== null && first !== undefined) {
      const label = String(first).trim().toUpperCase();
      for (const cust of CUSTOMER_KEYS) {
        if (label.startsWith(cust) && !customerRows.has(cust)) {
          customerRows.set(cust, row);
          break;
        }
      }
      if (label === "TOTAL" && !totalRow) {
        totalRow = row;
      }
    }
  });

  if (!headerRow) {
    throw new Error("No CHANNEL header row found in the SUMMARY sheet");
  }
  const header: ExcelJS.Row = headerRow;

  // Build header → column-index map
  const colIdx = new Map<string, number>();
  header.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    if (cell.value !== null && cell.value !== undefined) {
      colIdx.set(String(cell.value).trim().toUpperCase(), colNumber);
    }
  });

  // Extract facts
  const rows: VolumeFactRow[] = [];
  let computed_customer_sum = 0;

  for (const customerKey of CUSTOMER_KEYS) {
    const row = customerRows.get(customerKey);
    if (!row) continue;

    for (const packageKey of PACKAGE_KEYS) {
      const colNum = colIdx.get(packageKey);
      if (!colNum) continue;

      const gallons = cellNumber(row.getCell(colNum).value);

      if (gallons > 0) {
        rows.push({ customer_key: customerKey, package_key: packageKey, gallons });
        computed_customer_sum += gallons;
      }
    }
  }

  // Read the source TOTAL row (for validation)
  let source_total_row: number | null = null;
  if (totalRow) {
    const t: ExcelJS.Row = totalRow;
    const totalCol = colIdx.get("TOTAL");
    if (totalCol) {
      source_total_row = cellNumber(t.getCell(totalCol).value);
    }
  }

  // Detect discrepancy (0.5 gal threshold absorbs floating-point rounding)
  const has_total_discrepancy =
    source_total_row !== null &&
    Math.abs(source_total_row - computed_customer_sum) > 0.5;

  const discrepancy_amount =
    source_total_row !== null
      ? Math.round((source_total_row - computed_customer_sum) * 1000) / 1000
      : null;

  const file_hash = createHash("sha256").update(buffer).digest("hex");

  return {
    rows,
    computed_customer_sum,
    source_total_row,
    has_total_discrepancy,
    discrepancy_amount,
    file_hash,
  };
}
