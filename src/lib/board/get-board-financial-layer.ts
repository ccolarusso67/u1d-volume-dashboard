/**
 * src/lib/board/get-board-financial-layer.ts
 *
 * Optional bridge from the U1D board report to the existing finance
 * dashboard / QuickBooks snapshot API. When the bridge is not configured,
 * this returns structured empty states rather than invented financial data.
 */
import type {
  BoardFinancialLayer,
  BoardFinancialMonthlyRow,
  BoardForecastActual,
  BoardPnlSummary,
} from "./financial-types";

const DEFAULT_U1DYNAMICS_COMPANY_ID = "u1dynamics";
const FINANCE_FETCH_TIMEOUT_MS = 2_500;

type FetchLike = typeof fetch;

type GetBoardFinancialLayerOptions = {
  apiBaseUrl?: string | null;
  companyId?: string | null;
  fetcher?: FetchLike;
};

type RawPnlPayload = {
  monthly?: unknown;
};

type RawPnlRow = Record<string, unknown>;

export function calculateForecastVariance(
  forecastCost: number | null | undefined,
  actualCost: number | null | undefined
): BoardForecastActual | null {
  if (!isFiniteNumber(forecastCost) || !isFiniteNumber(actualCost)) return null;

  const varianceDollars = actualCost - forecastCost;
  return {
    forecastCost,
    actualCost,
    varianceDollars,
    variancePct: forecastCost !== 0 ? varianceDollars / forecastCost : null,
    flag: actualCost < forecastCost ? "favorable" : actualCost > forecastCost ? "unfavorable" : "flat",
  };
}

export async function getBoardFinancialLayer(
  year: number,
  month: number,
  options?: GetBoardFinancialLayerOptions
): Promise<BoardFinancialLayer> {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new RangeError(`getBoardFinancialLayer: invalid year ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`getBoardFinancialLayer: invalid month ${month}`);
  }

  const companyId = normalized(options?.companyId ?? process.env.U1D_FINANCE_COMPANY_ID)
    ?? DEFAULT_U1DYNAMICS_COMPANY_ID;
  const apiBaseUrl = normalized(options?.apiBaseUrl ?? process.env.U1D_FINANCE_API_BASE_URL);
  const baseLayer = emptyLayer(companyId, apiBaseUrl !== null);

  if (!apiBaseUrl) return baseLayer;

  try {
    const pnlUrl = new URL("api/pnl", ensureTrailingSlash(apiBaseUrl));
    pnlUrl.searchParams.set("company_id", companyId);

    const response = await (options?.fetcher ?? fetch)(pnlUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(FINANCE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        ...baseLayer,
        source: {
          ...baseLayer.source,
          pnlStatus: "unavailable",
          notes: [
            ...baseLayer.source.notes,
            `Finance P&L endpoint returned HTTP ${response.status}.`,
          ],
        },
      };
    }

    const payload = await response.json() as RawPnlPayload;
    const rows = Array.isArray(payload.monthly) ? payload.monthly as RawPnlRow[] : [];
    const monthlyTrend = rows
      .map(toMonthlyRow)
      .filter((row): row is BoardFinancialMonthlyRow => row !== null);
    const targetPeriod = periodKey(year, month);
    const targetRow = rows.find((row) => monthKey(row.month) === targetPeriod) ?? null;
    const pnl = targetRow ? toPnlSummary(targetRow, targetPeriod) : null;

    return {
      companyId,
      pnl,
      forecastActual: null,
      monthlyTrend,
      source: {
        pnlStatus: pnl ? "available" : "unavailable",
        forecastStatus: "not_configured",
        financeApiConfigured: true,
        notes: [
          "Finance API bridge is configured for the existing QuickBooks snapshot dashboard.",
          ...(pnl ? [] : [`No U1Dynamics P&L row was returned for ${targetPeriod}.`]),
          "Forecast vs actual cost data source is not configured in the current connector contract.",
        ],
      },
    };
  } catch (error) {
    return {
      ...baseLayer,
      source: {
        ...baseLayer.source,
        pnlStatus: "unavailable",
        notes: [
          ...baseLayer.source.notes,
          error instanceof Error
            ? `Finance P&L endpoint could not be read: ${error.message}`
            : "Finance P&L endpoint could not be read.",
        ],
      },
    };
  }
}

function emptyLayer(companyId: string, financeApiConfigured: boolean): BoardFinancialLayer {
  return {
    companyId,
    pnl: null,
    forecastActual: null,
    monthlyTrend: [],
    source: {
      pnlStatus: financeApiConfigured ? "unavailable" : "not_configured",
      forecastStatus: "not_configured",
      financeApiConfigured,
      notes: financeApiConfigured
        ? ["Finance API bridge is configured, but no U1Dynamics P&L data has been loaded yet."]
        : ["Finance API bridge is not configured for this dashboard deployment."],
    },
  };
}

function toMonthlyRow(row: RawPnlRow): BoardFinancialMonthlyRow | null {
  const period = monthKey(row.month);
  if (!period) return null;

  const revenue = num(row.income ?? row.revenue);
  const cogs = num(row.cogs);
  const grossProfit = num(row.gross_profit ?? row.grossProfit ?? revenue - cogs);
  return {
    period,
    label: typeof row.label === "string" && row.label.trim() ? row.label : period,
    revenue,
    cogs,
    grossProfit,
    grossMarginPct: revenue !== 0 ? grossProfit / revenue : null,
  };
}

function toPnlSummary(row: RawPnlRow, period: string): BoardPnlSummary {
  const monthly = toMonthlyRow(row);
  const revenue = monthly?.revenue ?? num(row.income ?? row.revenue);
  const cogs = monthly?.cogs ?? num(row.cogs);
  const grossProfit = monthly?.grossProfit ?? num(row.gross_profit ?? row.grossProfit ?? revenue - cogs);
  const fullPnlSnapshot = hasOwn(row, "report_basis") || hasOwn(row, "snapshot_at");

  return {
    period,
    revenue,
    cogs,
    grossProfit,
    grossMarginPct: revenue !== 0 ? grossProfit / revenue : null,
    operatingExpenses: fullPnlSnapshot && isNumericLike(row.operating_expenses)
      ? num(row.operating_expenses)
      : null,
    netIncome: fullPnlSnapshot && isNumericLike(row.net_income)
      ? num(row.net_income)
      : null,
    reportBasis: typeof row.report_basis === "string" ? row.report_basis : null,
    snapshotAt: typeof row.snapshot_at === "string" ? row.snapshot_at : null,
  };
}

function monthKey(value: unknown): string | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.valueOf())) return null;
  return periodKey(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function isNumericLike(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  return Number.isFinite(Number(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasOwn(row: RawPnlRow, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, key);
}

function normalized(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
