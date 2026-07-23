import type {
  AnalysisMetric,
  AnalysisPeer,
  SecurityAnalysisResponse,
} from "../contracts";

export type DcfAssumptions = {
  cashFlowGrowth: number;
  discountRate: number;
  terminalGrowth: number;
};

export type DcfProjection = {
  year: number;
  cashFlow: number;
  discountFactor: number;
  presentValue: number;
};

export type DcfModel = {
  projections: DcfProjection[];
  presentValueOfForecast: number;
  presentValueOfTerminal: number;
  enterpriseValue: number;
  equityValue: number;
  shares: number;
  perShare: number;
};

type DcfInputs = {
  startingCashFlow: number;
  cash: number;
  debt: number;
  shares: number;
};

export type RelativeMeasure = {
  id: "pe" | "ps" | "pb";
  label: string;
  companyMultiple: number | null;
  peerMedian: number | null;
  denominatorPerShare: number | null;
  impliedValue: number | null;
  premiumDiscount: number | null;
};

export type ValuationScenario = {
  label: "Conservative" | "Base" | "Optimistic";
  value: number;
};

export type DcfValuation = {
  kind: "dcf";
  assumptions: DcfAssumptions;
  model: DcfModel | null;
  price: number | null;
  baseValue: number | null;
  gap: number | null;
  opportunity: string;
  scenarios: ValuationScenario[];
  modelVersion: typeof VALUATION_MODEL_VERSION;
};

export type RelativeValuation = {
  kind: "relative";
  measures: RelativeMeasure[];
  relativeValue: number | null;
  price: number | null;
  baseValue: number | null;
  gap: number | null;
  opportunity: string;
  scenarios: ValuationScenario[];
  aggregation: "mean-positive-implied-values";
  modelVersion: typeof VALUATION_MODEL_VERSION;
};

export type SecurityValuation = DcfValuation | RelativeValuation;

export const VALUATION_MODEL_VERSION = "2026-07-23.1";

export const DEFAULT_DCF_ASSUMPTIONS: DcfAssumptions = {
  cashFlowGrowth: 8,
  discountRate: 9,
  terminalGrowth: 3,
};

const finitePositive = (value: number) =>
  Number.isFinite(value) && value > 0;

export function calculateCashFlowValue(
  inputs: DcfInputs,
  assumptions: DcfAssumptions,
): DcfModel | null {
  if (
    !finitePositive(inputs.startingCashFlow) ||
    !finitePositive(inputs.shares) ||
    !Number.isFinite(inputs.cash) ||
    !Number.isFinite(inputs.debt)
  ) {
    return null;
  }

  const growth = assumptions.cashFlowGrowth / 100;
  const discount = assumptions.discountRate / 100;
  const terminalGrowth = assumptions.terminalGrowth / 100;
  if (
    !Number.isFinite(growth) ||
    !Number.isFinite(discount) ||
    !Number.isFinite(terminalGrowth) ||
    discount <= terminalGrowth ||
    discount <= -1 ||
    growth <= -1
  ) {
    return null;
  }

  const projections = Array.from({ length: 5 }, (_, index) => {
    const year = index + 1;
    const cashFlow = inputs.startingCashFlow * (1 + growth) ** year;
    const discountFactor = 1 / (1 + discount) ** year;
    return {
      year,
      cashFlow,
      discountFactor,
      presentValue: cashFlow * discountFactor,
    };
  });
  const finalCashFlow = projections[projections.length - 1].cashFlow;
  const terminalValue =
    (finalCashFlow * (1 + terminalGrowth)) /
    (discount - terminalGrowth);
  const presentValueOfForecast = projections.reduce(
    (sum, projection) => sum + projection.presentValue,
    0,
  );
  const presentValueOfTerminal =
    terminalValue / (1 + discount) ** projections.length;
  const enterpriseValue = presentValueOfForecast + presentValueOfTerminal;
  const equityValue = enterpriseValue + inputs.cash - inputs.debt;
  if (!finitePositive(equityValue)) return null;

  return {
    projections,
    presentValueOfForecast,
    presentValueOfTerminal,
    enterpriseValue,
    equityValue,
    shares: inputs.shares,
    perShare: equityValue / inputs.shares,
  };
}

export function medianPositive(
  values: Array<number | null>,
): number | null {
  const sorted = values
    .filter(
      (value): value is number =>
        value !== null && Number.isFinite(value) && value > 0,
    )
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[midpoint]
    : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

export function meanPositive(
  values: Array<number | null>,
): number | null {
  const usable = values.filter(
    (value): value is number =>
      value !== null && Number.isFinite(value) && value > 0,
  );
  return usable.length
    ? usable.reduce((sum, value) => sum + value, 0) / usable.length
    : null;
}

export function valuationScenarios(
  baseValue: number | null,
): ValuationScenario[] {
  return baseValue !== null && Number.isFinite(baseValue) && baseValue > 0
    ? [
        { label: "Conservative", value: baseValue * 0.8 },
        { label: "Base", value: baseValue },
        { label: "Optimistic", value: baseValue * 1.2 },
      ]
    : [];
}

export function analysisMetricNumber(
  metrics: Record<string, AnalysisMetric> | undefined,
  key: string,
): number | null {
  const value = metrics?.[key]?.value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[,$%×]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function positiveNumber(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

export function calculateDcfFromMetrics(
  metrics: Record<string, AnalysisMetric>,
  assumptions: DcfAssumptions,
): DcfModel | null {
  const startingCashFlow = positiveNumber(
    analysisMetricNumber(metrics, "freeCashFlow"),
  );
  const price = positiveNumber(analysisMetricNumber(metrics, "price"));
  const marketCap = positiveNumber(
    analysisMetricNumber(metrics, "marketCap"),
  );
  if (startingCashFlow === null || price === null || marketCap === null) {
    return null;
  }

  const cash = analysisMetricNumber(metrics, "cash");
  const debt = analysisMetricNumber(metrics, "debt");
  if (cash === null || debt === null) return null;
  const reportedShares = positiveNumber(
    analysisMetricNumber(metrics, "sharesOutstanding"),
  );
  const inferredShares = marketCap / price;
  const shares =
    reportedShares !== null &&
    reportedShares > inferredShares / 100 &&
    reportedShares < inferredShares * 100
      ? reportedShares
      : inferredShares;
  return calculateCashFlowValue(
    { startingCashFlow, cash, debt, shares },
    assumptions,
  );
}

function peerMetric(peer: AnalysisPeer, key: string): number | null {
  return analysisMetricNumber(peer.metrics, key);
}

export function calculateRelativeMeasures(
  data: Pick<SecurityAnalysisResponse, "metrics" | "peers">,
): RelativeMeasure[] {
  const price = positiveNumber(analysisMetricNumber(data.metrics, "price"));
  const marketCap = positiveNumber(
    analysisMetricNumber(data.metrics, "marketCap"),
  );
  const reportedShares = positiveNumber(
    analysisMetricNumber(data.metrics, "sharesOutstanding"),
  );
  const shares =
    reportedShares ??
    (price !== null && marketCap !== null ? marketCap / price : null);
  const revenue = positiveNumber(
    analysisMetricNumber(data.metrics, "revenue"),
  );
  const eps = positiveNumber(analysisMetricNumber(data.metrics, "eps"));
  const bookValuePerShare = positiveNumber(
    analysisMetricNumber(data.metrics, "bookValuePerShare"),
  );

  const definitions: Array<{
    id: RelativeMeasure["id"];
    label: string;
    denominator: number | null;
  }> = [
    { id: "pe", label: "Price / earnings", denominator: eps },
    {
      id: "ps",
      label: "Price / sales",
      denominator:
        revenue !== null && shares !== null && shares > 0
          ? revenue / shares
          : null,
    },
    {
      id: "pb",
      label: "Price / book",
      denominator: bookValuePerShare,
    },
  ];

  return definitions.map(({ id, label, denominator }) => {
    const peerMedian = medianPositive(
      data.peers.map((peer) => peerMetric(peer, id)),
    );
    const companyMultiple = positiveNumber(
      analysisMetricNumber(data.metrics, id),
    );
    return {
      id,
      label,
      companyMultiple,
      peerMedian,
      denominatorPerShare: denominator,
      impliedValue:
        peerMedian !== null && denominator !== null
          ? peerMedian * denominator
          : null,
      premiumDiscount:
        companyMultiple !== null && peerMedian !== null
          ? companyMultiple / peerMedian - 1
          : null,
    };
  });
}

export function opportunityLabel(gap: number | null): string {
  if (gap === null) return "Needs more evidence";
  if (gap >= 0.2) return "Wide margin of safety";
  if (gap >= 0) return "Potential opportunity";
  if (gap >= -0.1) return "Near fair value";
  return "Price leads the evidence";
}

function valuationEnvelope(
  price: number | null,
  baseValue: number | null,
) {
  const gap =
    price !== null && baseValue !== null && price > 0
      ? baseValue / price - 1
      : null;
  return {
    price,
    baseValue,
    gap,
    opportunity: opportunityLabel(gap),
    scenarios: valuationScenarios(baseValue),
  };
}

export function calculateDcfValuation(
  metrics: Record<string, AnalysisMetric>,
  assumptions: DcfAssumptions = DEFAULT_DCF_ASSUMPTIONS,
): DcfValuation {
  const model = calculateDcfFromMetrics(metrics, assumptions);
  const price = positiveNumber(analysisMetricNumber(metrics, "price"));
  const baseValue = model?.perShare ?? null;
  return {
    kind: "dcf",
    assumptions,
    model,
    ...valuationEnvelope(price, baseValue),
    modelVersion: VALUATION_MODEL_VERSION,
  };
}

export function calculateRelativeValuation(
  data: Pick<SecurityAnalysisResponse, "metrics" | "peers">,
): RelativeValuation {
  const measures = calculateRelativeMeasures(data);
  const relativeValue = meanPositive(
    measures.map((measure) => measure.impliedValue),
  );
  const price = positiveNumber(analysisMetricNumber(data.metrics, "price"));
  return {
    kind: "relative",
    measures,
    relativeValue,
    ...valuationEnvelope(price, relativeValue),
    aggregation: "mean-positive-implied-values",
    modelVersion: VALUATION_MODEL_VERSION,
  };
}
