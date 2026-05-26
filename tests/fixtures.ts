/**
 * tests/fixtures.ts
 *
 * Synthetic SUMMARY-shaped workbook builder so parser tests don't depend on
 * any real client-confidential .xlsx. Mirrors the column order and row
 * structure of the production U1DYNAMICS_VOLUME_*.xlsx template.
 */
import ExcelJS from "exceljs";

export const FIXTURE_PACKAGE_HEADER = [
  "CHANNEL",
  // 22 package columns matching PACKAGE_KEYS after PR 002
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
  "TOTAL",
] as const;

export type FixtureCustomerRow = {
  /** label written into column A (intentionally non-canonical for some tests). */
  label: string;
  /** package column header -> gallons */
  values: Record<string, number>;
};

export type FixtureOptions = {
  /** Sheet name; defaults to "SUMMARY MAR 26". */
  summarySheetName?: string;
  /** Body rows in order. Each row gets a TOTAL filled in automatically. */
  customers: FixtureCustomerRow[];
  /** Optional extra headers (e.g. "MP Grease", "Vol Delta") appended after TOTAL. */
  extraHeaders?: string[];
  /**
   * Optional customer detail tabs to include. Each tab name is the tab's
   * worksheet name (typically a short customer alias like "SUNCOAST").
   * Each entry is a list of (presentation_simplified, gallons) rows.
   */
  customerDetailTabs?: Array<{
    sheetName: string;
    rows: Array<{ presentation_simplified: string; gallons: number }>;
  }>;
};

/**
 * Build an in-memory .xlsx buffer that mimics the production SUMMARY layout.
 */
export async function buildSyntheticVolumeXlsx(opts: FixtureOptions): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(opts.summarySheetName ?? "SUMMARY MAR 26");

  // Row 1: a date cell at A1 (matches the real workbook quirk)
  sheet.getCell(1, 1).value = new Date("2026-03-01");

  // Row 2: header
  const header = [
    ...FIXTURE_PACKAGE_HEADER,
    ...(opts.extraHeaders ?? []),
  ];
  header.forEach((h, i) => {
    sheet.getCell(2, i + 1).value = h;
  });

  // Body rows: one per customer
  let row = 3;
  // Aggregate per-package totals for the TOTAL row at the end
  const totals: Record<string, number> = {};

  for (const cust of opts.customers) {
    sheet.getCell(row, 1).value = cust.label;
    let custTotal = 0;
    for (let c = 1; c < FIXTURE_PACKAGE_HEADER.length - 1; c++) {
      // c is 1-indexed offset; -1 because last column is TOTAL itself
      const headerLabel = FIXTURE_PACKAGE_HEADER[c]; // skip CHANNEL at index 0
      const v = cust.values[headerLabel] ?? 0;
      sheet.getCell(row, c + 1).value = v;
      custTotal += v;
      totals[headerLabel] = (totals[headerLabel] ?? 0) + v;
      // Also handle extra columns referenced by name
    }
    // TOTAL column (last in FIXTURE_PACKAGE_HEADER)
    sheet.getCell(row, FIXTURE_PACKAGE_HEADER.length).value = custTotal;
    row++;
  }

  // TOTAL row
  sheet.getCell(row, 1).value = "TOTAL";
  let grandTotal = 0;
  for (let c = 1; c < FIXTURE_PACKAGE_HEADER.length - 1; c++) {
    const headerLabel = FIXTURE_PACKAGE_HEADER[c];
    const v = totals[headerLabel] ?? 0;
    sheet.getCell(row, c + 1).value = v;
    grandTotal += v;
  }
  sheet.getCell(row, FIXTURE_PACKAGE_HEADER.length).value = grandTotal;

  // Optional customer-detail tabs
  for (const tab of opts.customerDetailTabs ?? []) {
    const ds = wb.addWorksheet(tab.sheetName);
    const detailHeader = [
      "PRODUCT", "QTY", "SKU", "PRESENTATION", "PRESENTATION", "CONVERSION", "GALLONS",
    ];
    detailHeader.forEach((h, i) => {
      ds.getCell(1, i + 1).value = h;
    });
    tab.rows.forEach((r, i) => {
      const rowIdx = i + 2;
      ds.getCell(rowIdx, 1).value = `SKU-${i + 1}`;
      ds.getCell(rowIdx, 2).value = 1;
      ds.getCell(rowIdx, 3).value = `SKU-${i + 1}`;
      ds.getCell(rowIdx, 4).value = r.presentation_simplified;
      ds.getCell(rowIdx, 5).value = r.presentation_simplified;
      ds.getCell(rowIdx, 6).value = r.gallons;
      ds.getCell(rowIdx, 7).value = r.gallons;
    });
  }

  const arrayBuf = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuf as ArrayBuffer);
}
