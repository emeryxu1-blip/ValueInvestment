import type {
  AnalysisMetric,
  AnalysisValue,
} from "../contracts";
import type {
  NormalizedSnapshotRow,
  NormalizedValue,
} from "../ainvest/normalize";

const METRIC_LABELS: Record<string, string> = {
  company: "Company",
  price: "Market price",
  changePercent: "Daily change",
  marketCap: "Market capitalization",
  sector: "Sector",
  industry: "Industry",
  sectorGroupCode: "Sector group code",
  sectorCode: "Industry code",
  companyAnalysisNetMargin: "Operating-company applicability margin",
  fairValueModule: "Cash-flow valuation",
  revenue: "Revenue",
  netIncome: "Net income",
  freeCashFlow: "Free cash flow",
  operatingCashFlow: "Operating cash flow",
  debt: "Debt",
  cash: "Cash and short-term investments",
  sharesOutstanding: "Shares outstanding",
  eps: "Earnings per share",
  earningsRevenueModule: "Revenue and earnings history",
  pe: "Price to earnings",
  pb: "Price to book",
  ps: "Price to sales",
  pcf: "Price to cash flow",
  pfcf: "Price to free cash flow",
  peg: "Price/earnings to growth",
  enterpriseValue: "Enterprise value",
  evEbitda: "Enterprise value to EBITDA",
  evEbit: "Enterprise value to EBIT",
  evRevenue: "Enterprise value to revenue",
  evFcf: "Enterprise value to free cash flow",
  bookValuePerShare: "Book value per share",
  ebitda: "EBITDA",
  ebit: "EBIT",
  pastScore: "Past performance score",
  grossMargin: "Gross margin",
  operatingMargin: "Operating margin",
  netMargin: "Net margin",
  ebitMargin: "EBIT margin",
  ebitdaMargin: "EBITDA margin",
  freeCashFlowMargin: "Free cash flow margin",
  roe: "Return on equity",
  roa: "Return on assets",
  roic: "Return on invested capital",
  assetTurnover: "Asset turnover",
  grossProfit: "Gross profit",
  revenueBreakdownModule: "Revenue and expense breakdown",
};

function toAnalysisValue(value: unknown): AnalysisValue {
  if (value === undefined) return null;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(toAnalysisValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toAnalysisValue(item)]),
    );
  }
  return null;
}

export function analysisMetricFromNormalized(
  requestId: string,
  normalized: NormalizedValue | undefined,
): AnalysisMetric {
  if (!normalized) {
    return {
      label: METRIC_LABELS[requestId] ?? requestId,
      value: null,
      asOf: null,
      valueType: null,
      unit: null,
      rawUnit: null,
      reason: "The requested metric was not returned.",
    };
  }
  return {
    label: METRIC_LABELS[requestId] ?? requestId,
    value: toAnalysisValue(normalized.value),
    asOf: normalized.asOf,
    valueType: normalized.valueType,
    unit: normalized.unit,
    rawUnit: normalized.rawUnit,
    ...(normalized.value == null
      ? { reason: "The requested metric has no current value." }
      : {}),
  };
}

export function analysisMetricsFromRow(
  row: NormalizedSnapshotRow,
): Record<string, AnalysisMetric> {
  return Object.fromEntries(
    Object.entries(row.values).map(([requestId, value]) => [
      requestId,
      analysisMetricFromNormalized(requestId, value),
    ]),
  );
}
