/**
 * src/lib/board/financial-types.ts
 *
 * Board-level financial data contract. Values are nullable unless the
 * finance connector actually supplies them.
 */

export type BoardFinancialAvailability = "available" | "not_configured" | "unavailable";

export type ForecastVarianceFlag = "favorable" | "unfavorable" | "flat";

export type BoardPnlSummary = {
  period: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number | null;
  operatingExpenses: number | null;
  netIncome: number | null;
  reportBasis: string | null;
  snapshotAt: string | null;
};

export type BoardForecastActual = {
  forecastCost: number;
  actualCost: number;
  varianceDollars: number;
  variancePct: number | null;
  flag: ForecastVarianceFlag;
};

export type BoardFinancialMonthlyRow = {
  period: string;
  label: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number | null;
};

export type BoardFinancialLayer = {
  companyId: string;
  pnl: BoardPnlSummary | null;
  forecastActual: BoardForecastActual | null;
  monthlyTrend: BoardFinancialMonthlyRow[];
  source: {
    pnlStatus: BoardFinancialAvailability;
    forecastStatus: BoardFinancialAvailability;
    financeApiConfigured: boolean;
    notes: string[];
  };
};
