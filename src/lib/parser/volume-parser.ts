/**
 * src/lib/parser/volume-parser.ts
 *
 * Parser for U1DYNAMICS_VOLUME_*.xlsx files.
 *
 * TypeScript port of the validated Python parser, tested against 32 source
 * files (Jan 2023 -> Mar 2026, with the Jan-Jul 2024 gap). It captures:
 *   - per-customer x per-package rows
 *   - validation of the source TOTAL row vs the reconstructed sum
 *   - a discrepancy flag (FY2024 Sep/Nov/Dec sub-report by -450 gal because
 *     TERRA is missing from the source file's TOTAL formula)
 *
 * PR 002 — Board Accuracy Hotfix:
 *   - TOTE WW recognised in the SUMMARY column header set.
 *   - Customer matching no longer uses startsWith(). Labels are uppercased
 *     then looked up in a canonicalization map compatible with the
 *     u1d_ops.customer_aliases table (raw_label CHECK is UPPER(raw_label)).
 *   - Unknown packages and customers are no longer silently dropped. The
 *     parser returns them in `warnings.unknownPackages` / `unknownCustomers`
 *     so the upload route can persist them to package_alerts / customer_alerts
 *     and block the period from advancing to `locked`.
 */
import ExcelJS from "exceljs";
import { MONTH_TOKENS } from "./month-tokens";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Canonical catalog (kept in sync with db/migrations/002_seed_catalogs.sql
// and 006_data_fixes.sql).
// ---------------------------------------------------------------------------

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
  "TOTE OIL", "TOTE COOL", "TOTE WW",
  "BOX OIL", "BOX COOL", "BOX WW",
  "BULK OIL", "BULK COOL",
  "DEF",
] as const;

/** SUMMARY columns that are not package buckets and must not be reported as unknown packages. */
const SUMMARY_NON_PACKAGE_COLUMNS = new Set<string>([
  "CHANNEL",
  "TOTAL",
  "MP GREASE",
  "MARINE BOAT",
  "VOL DELTA",
  "VOL DELTA %",
  "",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VolumeFactRow = {
  customer_key: string;
  package_key: string;
  gallons: number;
};

export type UnknownLabelSource =
  | "SUMMARY"           // appeared as a column header or row label in the SUMMARY sheet
  | "CUSTOMER_DETAIL";  // appeared as a simplified PRESENTATION on a customer detail tab

export type UnknownLabel = {
  raw_label: string;            // as observed (uppercased + trimmed)
  source: UnknownLabelSource;
  gallons_observed: number;     // best-effort: gallons attached to this label in this file
};

export type ParseWarnings = {
  unknownPackages: UnknownLabel[];
  unknownCustomers: UnknownLabel[];
};

export type PeriodInfo = {
  year: number;
  month: number;
  source: "CELL_A1" | "SHEET_NAME";
};

export type ParsedVolumeFile = {
  period: PeriodInfo;
  rows: VolumeFactRow[];
  computed_customer_sum: number;
  source_total_row: number | null;
  has_total_discrepancy: boolean;
  discrepancy_amount: number | null;
  file_hash: string;
  warnings: ParseWarnings;
};

export type ParseOptions = {
  /**
   * UPPERCASE raw label -> canonical customer_key. Loaded from
   * u1d_ops.customer_aliases at call time by the upload route.
   *
   * If not provided, defaults to an identity map of CUSTOMER_KEYS, which
   * keeps the parser usable in tests/dev without a DB but means the
   * legacy variants (SUNCOAST, KEYPERFOR, TERRA) will surface as
   * unknownCustomers — the desired behavior.
   */
  customerAliases?: ReadonlyMap<string, string>;

  /**
   * UPPERCASE set of known package_keys. Loaded from u1d_ops.packages at
   * call time. If not provided, falls back to the static PACKAGE_KEYS.
   */
  knownPackages?: ReadonlySet<string>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function normalizeLabel(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim().toUpperCase();
}

function defaultCustomerAliases(): Map<string, string> {
  // Identity map — only canonical CUSTOMER_KEYS are recognised. Variant
  // labels surface as unknownCustomers warnings.
  return new Map(CUSTOMER_KEYS.map((k) => [k, k]));
}

function defaultKnownPackages(): Set<string> {
  return new Set<string>(PACKAGE_KEYS);
}

// ---------------------------------------------------------------------------

function readPeriodFromCellA1(sheet: ExcelJS.Worksheet): PeriodInfo | null {
  const raw = sheet.getCell(1, 1).value;
  // ExcelJS surfaces date cells as JS Date when the cell carries a numFmt
  if (raw instanceof Date) {
    return {
      year: raw.getUTCFullYear(),
      month: raw.getUTCMonth() + 1,
      source: "CELL_A1",
    };
  }
  // Sometimes the date arrives as { result: Date } when stored in a formula
  if (
    typeof raw === "object" &&
    raw !== null &&
    "result" in raw &&
    (raw as { result: unknown }).result instanceof Date
  ) {
    const d = (raw as { result: Date }).result;
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      source: "CELL_A1",
    };
  }
  return null;
}

function readPeriodFromSheetName(sheetName: string): PeriodInfo | null {
  // Expected pattern: "SUMMARY <MONTH_TOKEN> <YY_OR_YYYY>"
  const parts = sheetName.toUpperCase().split(/\s+/).filter(Boolean);
  if (parts.length < 3 || parts[0] !== "SUMMARY") return null;
  const monthToken = parts[parts.length - 2];
  const yearStr = parts[parts.length - 1];
  const month = MONTH_TOKENS[monthToken];
  if (!month) return null;
  let year = parseInt(yearStr, 10);
  if (isNaN(year)) return null;
  if (year < 100) year += 2000; // 23 -> 2023
  if (year < 2020 || year > 2100) return null;
  return { year, month, source: "SHEET_NAME" };
}

// Main parser
// ---------------------------------------------------------------------------

export async function parseVolumeFile(
  buffer: Buffer,
  options?: ParseOptions
): Promise<ParsedVolumeFile> {
  const customerAliases = options?.customerAliases ?? defaultCustomerAliases();
  const knownPackages = options?.knownPackages ?? defaultKnownPackages();

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const summarySheet = workbook.worksheets.find((s) =>
    s.name.toUpperCase().startsWith("SUMMARY")
  );
  if (!summarySheet) {
    throw new Error("No sheet with a SUMMARY prefix found in the workbook");
  }

  // Extract period: cell A1 first, fall back to sheet name, throw if neither.
  const period =
    readPeriodFromCellA1(summarySheet) ??
    readPeriodFromSheetName(summarySheet.name);
  if (!period) {
    throw new Error(
      `Cannot determine period: SUMMARY sheet A1 is not a Date and sheet name "${summarySheet.name}" does not match the "SUMMARY <MONTH> <YEAR>" pattern`
    );
  }

  // Locate header row + each non-empty body row in the SUMMARY sheet.
  let headerRow: ExcelJS.Row | null = null;
  let totalRow: ExcelJS.Row | null = null;
  const bodyRows: { rawLabel: string; row: ExcelJS.Row }[] = [];

  summarySheet.eachRow((row: ExcelJS.Row) => {
    const first = row.getCell(1).value;
    if (first === "CHANNEL" && !headerRow) {
      headerRow = row;
      return;
    }
    if (!headerRow) return;
    const label = normalizeLabel(first);
    if (!label) return;
    if (label === "TOTAL") {
      if (!totalRow) totalRow = row;
      return;
    }
    bodyRows.push({ rawLabel: label, row });
  });

  if (!headerRow) {
    throw new Error("No CHANNEL header row found in the SUMMARY sheet");
  }
  const header: ExcelJS.Row = headerRow;

  // Build header -> column-index map AND classify each header as a known
  // package, a known non-package, or an unknown package candidate.
  const packageColumns: { packageKey: string; colNum: number }[] = [];
  const unknownPackageColumns: { rawLabel: string; colNum: number }[] = [];
  let totalCol: number | undefined;

  header.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const label = normalizeLabel(cell.value);
    if (!label) return;
    if (label === "TOTAL") {
      totalCol = colNumber;
      return;
    }
    if (SUMMARY_NON_PACKAGE_COLUMNS.has(label)) return;
    if (knownPackages.has(label)) {
      packageColumns.push({ packageKey: label, colNum: colNumber });
    } else {
      unknownPackageColumns.push({ rawLabel: label, colNum: colNumber });
    }
  });

  // ------------------------------------------------------------------------
  // Walk the body rows: canonicalize customer label, emit facts for known
  // package columns, accumulate gallons_observed for unknown columns and
  // unknown customers.
  // ------------------------------------------------------------------------

  const rows: VolumeFactRow[] = [];
  let computed_customer_sum = 0;

  // raw_label -> running total of gallons attached to it (for warnings)
  const unknownCustomerTotals = new Map<string, number>();
  const unknownPackageTotals = new Map<string, number>(); // SUMMARY-source only

  for (const { rawLabel, row } of bodyRows) {
    const canonicalCustomer = customerAliases.get(rawLabel);

    if (canonicalCustomer) {
      // Known customer — emit facts for all known package columns.
      for (const { packageKey, colNum } of packageColumns) {
        const gallons = cellNumber(row.getCell(colNum).value);
        if (gallons > 0) {
          rows.push({
            customer_key: canonicalCustomer,
            package_key: packageKey,
            gallons,
          });
          computed_customer_sum += gallons;
        }
      }
      // Attribute unknown-package gallons that this customer had.
      for (const { rawLabel: pkgLabel, colNum } of unknownPackageColumns) {
        const gallons = cellNumber(row.getCell(colNum).value);
        if (gallons > 0) {
          unknownPackageTotals.set(
            pkgLabel,
            (unknownPackageTotals.get(pkgLabel) ?? 0) + gallons
          );
        }
      }
    } else {
      // Unknown customer — accumulate every numeric cell so we can report
      // total gallons attached to this label.
      let rowSum = 0;
      for (const { colNum } of packageColumns) {
        rowSum += cellNumber(row.getCell(colNum).value);
      }
      for (const { colNum } of unknownPackageColumns) {
        rowSum += cellNumber(row.getCell(colNum).value);
      }
      unknownCustomerTotals.set(
        rawLabel,
        (unknownCustomerTotals.get(rawLabel) ?? 0) + rowSum
      );
    }
  }

  // ------------------------------------------------------------------------
  // Read the source TOTAL row (validation only — DB always uses the
  // reconstructed sum).
  // ------------------------------------------------------------------------

  let source_total_row: number | null = null;
  if (totalRow && totalCol) {
    const t: ExcelJS.Row = totalRow;
    source_total_row = cellNumber(t.getCell(totalCol).value);
  }

  const has_total_discrepancy =
    source_total_row !== null &&
    Math.abs(source_total_row - computed_customer_sum) > 0.5;
  const discrepancy_amount =
    source_total_row !== null
      ? Math.round((source_total_row - computed_customer_sum) * 1000) / 1000
      : null;

  // ------------------------------------------------------------------------
  // Scan customer detail tabs (any worksheet whose canonicalized name is a
  // known customer) for additional unknown packages — the simplified
  // PRESENTATION value in column 5 must match the SUMMARY column header set.
  //
  // Limitations (documented as future scope, see PR 002 deliverables):
  //   - SKU and CONVERSION sheets are NOT scanned in PR 002. Their package
  //     identifiers live in a different namespace (presentation-with-size,
  //     e.g. "PAIL OIL (5G)") that would always look "unknown" against the
  //     simplified PACKAGE_KEYS catalog. Future work: load the CONVERSION
  //     sheet as the per-file authority on detail->simplified mapping.
  // ------------------------------------------------------------------------

  const detailUnknownPackageTotals = new Map<string, number>();
  for (const ws of workbook.worksheets) {
    const wsLabel = normalizeLabel(ws.name);
    if (!customerAliases.has(wsLabel)) continue;
    // We trust the column layout from the validated template:
    //   col 1 = PRODUCT, col 2 = QTY, col 3 = SKU,
    //   col 4 = PRESENTATION (full, e.g. "PAIL OIL (5G)"),
    //   col 5 = PRESENTATION (simplified, e.g. "PAIL OIL"),
    //   col 6 = CONVERSION, col 7 = GALLONS
    const headerCell = normalizeLabel(ws.getCell(1, 1).value);
    if (headerCell !== "PRODUCT") continue; // wrong shape — skip defensively

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // skip header
      const simplifiedPresentation = normalizeLabel(row.getCell(5).value);
      if (!simplifiedPresentation) return;
      if (knownPackages.has(simplifiedPresentation)) return;
      const gallons = cellNumber(row.getCell(7).value);
      detailUnknownPackageTotals.set(
        simplifiedPresentation,
        (detailUnknownPackageTotals.get(simplifiedPresentation) ?? 0) + gallons
      );
    });
  }

  // ------------------------------------------------------------------------
  // Assemble warnings.
  // ------------------------------------------------------------------------

  const unknownPackages: UnknownLabel[] = [];
  for (const [raw_label, gallons_observed] of unknownPackageTotals) {
    unknownPackages.push({ raw_label, source: "SUMMARY", gallons_observed });
  }
  for (const [raw_label, gallons_observed] of detailUnknownPackageTotals) {
    unknownPackages.push({
      raw_label,
      source: "CUSTOMER_DETAIL",
      gallons_observed,
    });
  }

  const unknownCustomers: UnknownLabel[] = [];
  for (const [raw_label, gallons_observed] of unknownCustomerTotals) {
    unknownCustomers.push({
      raw_label,
      source: "SUMMARY",
      gallons_observed,
    });
  }

  const file_hash = createHash("sha256").update(buffer).digest("hex");

  return {
    period,
    rows,
    computed_customer_sum,
    source_total_row,
    has_total_discrepancy,
    discrepancy_amount,
    file_hash,
    warnings: { unknownPackages, unknownCustomers },
  };
}
