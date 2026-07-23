import type {
  FinancialBridge,
  FinancialPeriod,
  PeersResponse,
  SecuritySummaryResponse,
} from "../contracts";
import { buildCashFlowBridge } from "./bridges.ts";
import type { ProfitabilitySnapshot } from "./profitability";

export type QualityTone = "positive" | "watch" | "neutral" | "unavailable";
export type MetricTone = "positive" | "negative" | "neutral";

export type ProfitabilityPoint = {
  period: string;
  revenue: number | null;
  netIncome: number | null;
  netMargin: number | null;
};

export type ScoreComponent = {
  label: string;
  value: number;
  earned: number;
  maximum: number;
  explanation: string;
};

export type DiligenceCheck = {
  label: string;
  detail: string;
  tone: QualityTone;
};

export type OpportunitySignal = {
  title: string;
  detail: string;
  tone: Exclude<QualityTone, "unavailable">;
};

export type PeerEconomics = {
  symbol: string;
  company: string;
  netMargin: number | null;
  returnOnEquity: number | null;
};

export type BusinessQualityAnalysis = {
  currentPeriod: string;
  revenue: number | null;
  grossProfit: number | null;
  ebit: number | null;
  ebitda: number | null;
  netIncome: number | null;
  freeCashFlow: number | null;
  operatingCashFlow: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  ebitMargin: number | null;
  ebitdaMargin: number | null;
  freeCashFlowMargin: number | null;
  cashConversion: number | null;
  returnOnEquity: number | null;
  returnOnInvestedCapital: number | null;
  returnOnAssets: number | null;
  assetTurnover: number | null;
  cashReturnOnEnterpriseValue: number | null;
  earningsYield: number | null;
  freeCashFlowYield: number | null;
  netDebt: number | null;
  netDebtToFreeCashFlow: number | null;
  revenueGrowth: number | null;
  netIncomeGrowth: number | null;
  marginTrend: number | null;
  earningsConsistency: number | null;
  score: number | null;
  scoreLabel: string;
  scoreComponents: ScoreComponent[];
  diligence: DiligenceCheck[];
  opportunities: OpportunitySignal[];
  trend: ProfitabilityPoint[];
  earningsBridge: FinancialBridge | null;
  marginTones: {
    gross: MetricTone;
    operating: MetricTone;
    net: MetricTone;
    freeCashFlow: MetricTone;
  };
  returnInterpretations: {
    equity: string;
    investedCapital: string;
    assets: string;
    cashEnterpriseValue: string;
  };
};

export const BUSINESS_QUALITY_MODEL_VERSION = "2026-07-23.1";

const isFiniteNumber = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

export const safeDivide = (
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null => {
  if (
    !isFiniteNumber(numerator) ||
    !isFiniteNumber(denominator) ||
    denominator === 0
  ) {
    return null;
  }
  return numerator / denominator;
};

const metricValue = (
  summary: SecuritySummaryResponse,
  key: string,
): number | null => {
  const fundamentals = summary.fundamentals as unknown as Record<
    string,
    { value: number | null }
  >;
  return fundamentals[key]?.value ?? null;
};

const latestCompletePeriod = (
  periods: FinancialPeriod[],
): FinancialPeriod | null => {
  for (let index = periods.length - 1; index >= 0; index -= 1) {
    const period = periods[index];
    if (isFiniteNumber(period.revenue) || isFiniteNumber(period.netIncome)) {
      return period;
    }
  }
  return null;
};

const periodYear = (period: string): number | null => {
  const match = period.match(/\b(19|20)\d{2}\b/);
  if (!match) return null;
  const year = Number(match[0]);
  return Number.isFinite(year) ? year : null;
};

const annualizedGrowth = (
  points: Array<{ period: string; value: number | null }>,
): number | null => {
  const usable = points.filter(
    (point): point is { period: string; value: number } =>
      isFiniteNumber(point.value) && point.value > 0,
  );
  if (usable.length < 2) return null;
  const first = usable[0];
  const last = usable.at(-1)!;
  const firstYear = periodYear(first.period);
  const lastYear = periodYear(last.period);
  const elapsed =
    firstYear !== null && lastYear !== null && lastYear > firstYear
      ? lastYear - firstYear
      : usable.length - 1;
  if (elapsed < 1 || first.value <= 0 || last.value <= 0) return null;
  return Math.pow(last.value / first.value, 1 / elapsed) - 1;
};

const average = (values: number[]): number | null =>
  values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null;

const marginTone = (value: number | null): MetricTone =>
  value === null ? "neutral" : value > 0 ? "positive" : "negative";

const returnInterpretations = (options: {
  returnOnEquity: number | null;
  returnOnInvestedCapital: number | null;
  returnOnAssets: number | null;
}) => ({
  equity:
    options.returnOnEquity === null
      ? "Shareholders’ equity return was not returned."
      : options.returnOnEquity >= 0.2
        ? "A high return can signal attractive economics; verify that leverage is not doing the work."
        : "Compare with the company’s cost of equity and reinvestment needs.",
  investedCapital:
    options.returnOnInvestedCapital === null
      ? "Operating profit after tax and invested capital are required."
      : options.returnOnInvestedCapital >= 0.15
        ? "A return above 15% can support compounding when reinvestment opportunities persist."
        : "Compare this return with the company’s cost of capital and its direction over time.",
  assets:
    options.returnOnAssets === null
      ? "Average total assets are required for a defensible calculation."
      : "Asset-heavy businesses usually earn lower returns, so compare with close operating peers.",
  cashEnterpriseValue:
    "A valuation-oriented cash yield, not a substitute for return on invested capital.",
});

export function medianFinite(
  values: Array<number | null>,
): number | null {
  const usable = values
    .filter(isFiniteNumber)
    .sort((left, right) => left - right);
  if (usable.length === 0) return null;
  const midpoint = Math.floor(usable.length / 2);
  return usable.length % 2
    ? usable[midpoint]
    : (usable[midpoint - 1] + usable[midpoint]) / 2;
}

const scoreLabel = (score: number | null) => {
  if (score === null) return "Not enough data";
  if (score >= 80) return "Exceptional economics";
  if (score >= 65) return "Strong economics";
  if (score >= 50) return "Resilient economics";
  if (score >= 35) return "Mixed economics";
  return "Fragile economics";
};

const scoreComponent = (
  label: string,
  value: number | null,
  target: number,
  maximum: number,
  explanation: string,
): ScoreComponent | null => {
  if (!isFiniteNumber(value)) return null;
  return {
    label,
    value,
    earned: clamp(value / target) * maximum,
    maximum,
    explanation,
  };
};

const check = (
  label: string,
  value: number | null,
  pass: (value: number) => boolean,
  passDetail: string,
  watchDetail: string,
  unavailableDetail: string,
): DiligenceCheck => {
  if (!isFiniteNumber(value)) {
    return {
      label,
      detail: unavailableDetail,
      tone: "unavailable",
    };
  }
  return pass(value)
    ? { label, detail: passDetail, tone: "positive" }
    : { label, detail: watchDetail, tone: "watch" };
};

const calculateOpportunities = (options: {
  score: number | null;
  marginTrend: number | null;
  earningsYield: number | null;
  freeCashFlowYield: number | null;
  netDebtToFreeCashFlow: number | null;
}): OpportunitySignal[] => {
  const signals: OpportunitySignal[] = [];
  const valuationYield =
    options.freeCashFlowYield ?? options.earningsYield;

  if (options.score !== null && valuationYield !== null) {
    if (options.score >= 65 && valuationYield >= 0.04) {
      signals.push({
        title: "Quality with valuation support",
        detail:
          "Strong operating economics coincide with at least a 4% earnings or free-cash-flow yield. Verify that normalized cash generation can persist.",
        tone: "positive",
      });
    } else if (options.score >= 65) {
      signals.push({
        title: "Quality appears well recognized",
        detail:
          "The business-quality score is strong, while the current yield is modest. The opportunity depends more heavily on durable growth.",
        tone: "neutral",
      });
    } else if (valuationYield >= 0.06) {
      signals.push({
        title: "Yield needs a quality explanation",
        detail:
          "The current yield looks optically attractive, but the economics are mixed. Test whether the weakness is temporary or structural.",
        tone: "watch",
      });
    } else {
      signals.push({
        title: "No clear quality-and-price overlap",
        detail:
          "Neither operating quality nor the current yield creates a strong standalone signal. Demand a wider margin of safety.",
        tone: "neutral",
      });
    }
  } else {
    signals.push({
      title: "Complete the quality-and-price check",
      detail:
        "Available figures are not sufficient to pair business quality with a current earnings or free-cash-flow yield.",
      tone: "neutral",
    });
  }

  if (options.marginTrend !== null) {
    if (options.marginTrend >= 0.02) {
      signals.push({
        title: "Margins are expanding",
        detail:
          "The latest net margin is at least two percentage points above the preceding average. Check whether pricing, mix, or temporary costs drove the change.",
        tone: "positive",
      });
    } else if (options.marginTrend <= -0.02) {
      signals.push({
        title: "Margin pressure needs diagnosis",
        detail:
          "The latest net margin is at least two percentage points below the preceding average. Distinguish reinvestment from loss of pricing power.",
        tone: "watch",
      });
    } else {
      signals.push({
        title: "Margins look broadly stable",
        detail:
          "The latest net margin sits within two percentage points of the preceding average, a useful starting point for normalization.",
        tone: "neutral",
      });
    }
  }

  if (options.netDebtToFreeCashFlow !== null) {
    if (options.netDebtToFreeCashFlow <= 1.5) {
      signals.push({
        title: "Cash generation supports flexibility",
        detail:
          "Net debt is no more than 1.5 times current free cash flow, leaving more room for reinvestment or owner returns.",
        tone: "positive",
      });
    } else if (options.netDebtToFreeCashFlow > 3) {
      signals.push({
        title: "Leverage can dilute compounding",
        detail:
          "Net debt exceeds three times current free cash flow. Stress-test cash generation before assigning a quality premium.",
        tone: "watch",
      });
    }
  }

  return signals.slice(0, 3);
};

export function calculatePeerEconomics(
  peers: PeersResponse["peers"],
): PeerEconomics[] {
  return peers.slice(0, 8).map((peer) => ({
    symbol: peer.symbol,
    company: peer.company.value ?? peer.symbol,
    netMargin:
      peer.pe.value !== null &&
      peer.pe.value > 0 &&
      peer.ps.value !== null &&
      peer.ps.value > 0
        ? peer.ps.value / peer.pe.value
        : null,
    returnOnEquity:
      peer.pe.value !== null &&
      peer.pe.value > 0 &&
      peer.pb.value !== null &&
      peer.pb.value > 0
        ? peer.pb.value / peer.pe.value
        : null,
  }));
}

export function calculateBusinessQuality(
  summary: SecuritySummaryResponse,
  profitability: ProfitabilitySnapshot | null = null,
): BusinessQualityAnalysis {
  const annual =
    profitability?.history.length
      ? profitability.history
      : summary.financials.annual;
  const currentPeriodData = latestCompletePeriod(annual);
  const revenue =
    profitability?.metrics.revenue ??
    metricValue(summary, "revenue") ??
    currentPeriodData?.revenue ??
    null;
  const grossProfit = profitability?.metrics.grossProfit ?? null;
  const ebit = profitability?.metrics.ebit ?? null;
  const ebitda = profitability?.metrics.ebitda ?? null;
  const netIncome =
    profitability?.metrics.netIncome ??
    metricValue(summary, "netIncome") ??
    currentPeriodData?.netIncome ??
    null;
  const freeCashFlow =
    profitability?.metrics.freeCashFlow ??
    metricValue(summary, "freeCashFlow") ??
    currentPeriodData?.freeCashFlow ??
    null;
  const operatingCashFlow =
    profitability?.metrics.operatingCashFlow ?? null;
  const grossMargin =
    profitability?.metrics.grossMargin ??
    safeDivide(grossProfit, revenue);
  const operatingMargin =
    profitability?.metrics.operatingMargin ??
    safeDivide(ebit, revenue);
  const netMargin =
    profitability?.metrics.netMargin ??
    safeDivide(netIncome, revenue);
  const ebitMargin =
    profitability?.metrics.ebitMargin ??
    safeDivide(ebit, revenue);
  const ebitdaMargin =
    profitability?.metrics.ebitdaMargin ??
    safeDivide(ebitda, revenue);
  const freeCashFlowMargin =
    profitability?.metrics.freeCashFlowMargin ??
    safeDivide(freeCashFlow, revenue);
  const cashConversion =
    netIncome !== null && netIncome > 0
      ? safeDivide(freeCashFlow, netIncome)
      : null;
  const rawRoe = metricValue(summary, "roe");
  const returnOnEquity =
    profitability?.metrics.returnOnEquity ??
    (rawRoe === null ? null : rawRoe / 100);
  const returnOnAssets =
    profitability?.metrics.returnOnAssets ?? null;
  const returnOnInvestedCapital =
    profitability?.metrics.returnOnInvestedCapital ?? null;
  const assetTurnover =
    profitability?.metrics.assetTurnover ?? null;
  const marketCap =
    profitability?.quote.marketCap ?? summary.quote.marketCap.value;
  const debt = metricValue(summary, "debt");
  const cash = metricValue(summary, "cash");
  const netDebt =
    debt !== null && cash !== null ? debt - cash : null;
  const enterpriseValue =
    marketCap !== null && debt !== null && cash !== null
      ? marketCap + debt - cash
      : null;
  const cashReturnOnEnterpriseValue =
    enterpriseValue !== null && enterpriseValue > 0
      ? safeDivide(freeCashFlow, enterpriseValue)
      : null;
  const freeCashFlowYield =
    marketCap !== null && marketCap > 0
      ? safeDivide(freeCashFlow, marketCap)
      : null;
  const pe = metricValue(summary, "pe");
  const earningsYield =
    pe !== null && pe > 0 ? 1 / pe : null;
  const netDebtToFreeCashFlow =
    netDebt !== null && freeCashFlow !== null && freeCashFlow > 0
      ? netDebt / freeCashFlow
      : null;

  const trend = annual
    .map((period): ProfitabilityPoint => ({
      period: period.period,
      revenue: period.revenue,
      netIncome: period.netIncome,
      netMargin: safeDivide(period.netIncome, period.revenue),
    }))
    .filter(
      (point) =>
        point.revenue !== null ||
        point.netIncome !== null ||
        point.netMargin !== null,
    );
  const previousMargins = trend
    .slice(0, -1)
    .slice(-3)
    .map((point) => point.netMargin)
    .filter(isFiniteNumber);
  const previousMarginAverage = average(previousMargins);
  const marginTrend =
    netMargin !== null && previousMarginAverage !== null
      ? netMargin - previousMarginAverage
      : null;
  const earningsHistory = annual
    .map((period) => period.netIncome)
    .filter(isFiniteNumber);
  const earningsConsistency =
    earningsHistory.length > 0
      ? earningsHistory.filter((value) => value > 0).length /
        earningsHistory.length
      : null;
  const revenueGrowth = annualizedGrowth(
    annual.map((period) => ({
      period: period.period,
      value: period.revenue,
    })),
  );
  const netIncomeGrowth = annualizedGrowth(
    annual.map((period) => ({
      period: period.period,
      value: period.netIncome,
    })),
  );

  const components = [
    scoreComponent(
      "Gross margin",
      grossMargin,
      0.4,
      10,
      "Full credit at a 40% gross margin.",
    ),
    scoreComponent(
      "Operating margin",
      operatingMargin,
      0.2,
      15,
      "Full credit at a 20% operating margin.",
    ),
    scoreComponent(
      "Net margin",
      netMargin,
      0.15,
      15,
      "Full credit at a 15% net margin.",
    ),
    scoreComponent(
      "Free cash flow margin",
      freeCashFlowMargin,
      0.12,
      15,
      "Full credit at a 12% free-cash-flow margin.",
    ),
    scoreComponent(
      "Cash conversion",
      cashConversion,
      1,
      15,
      "Full credit when free cash flow matches net income.",
    ),
    scoreComponent(
      returnOnInvestedCapital !== null
        ? "Return on invested capital"
        : "Return on equity",
      returnOnInvestedCapital ?? returnOnEquity,
      0.15,
      20,
      "Full credit at a 15% return on invested capital, or return on equity when invested-capital data is unavailable.",
    ),
    scoreComponent(
      "Earnings consistency",
      earningsConsistency,
      1,
      10,
      "Full credit when every displayed annual period is profitable.",
    ),
  ].filter((component): component is ScoreComponent => component !== null);
  const availableMaximum = components.reduce(
    (total, component) => total + component.maximum,
    0,
  );
  const score =
    components.length >= 3 && availableMaximum > 0
      ? Math.round(
          (components.reduce(
            (total, component) => total + component.earned,
            0,
          ) /
            availableMaximum) *
            100,
        )
      : null;

  const diligence: DiligenceCheck[] = [
    check(
      "Profitable operations",
      netMargin,
      (value) => value > 0,
      "The latest net margin is positive.",
      "The latest net margin is not positive.",
      "Revenue and net income are required.",
    ),
    check(
      "Cash-backed earnings",
      cashConversion,
      (value) => value >= 0.8,
      "Free cash flow covers at least 80% of net income.",
      "Free cash flow covers less than 80% of net income.",
      "Positive net income and free cash flow are required.",
    ),
    check(
      returnOnInvestedCapital !== null
        ? "Return on invested capital"
        : "Return on equity",
      returnOnInvestedCapital ?? returnOnEquity,
      (value) => value >= 0.15,
      "The displayed capital return is at least 15%.",
      "The displayed capital return is below 15%.",
      "A capital-return ratio was not returned.",
    ),
    check(
      "Margin direction",
      marginTrend,
      (value) => value >= -0.02,
      "The latest margin is not materially below its preceding average.",
      "The latest margin trails its preceding average by more than two points.",
      "At least two annual periods are required.",
    ),
    check(
      "Earnings consistency",
      earningsConsistency,
      (value) => value === 1,
      "Every displayed annual period is profitable.",
      "At least one displayed annual period is loss-making.",
      "Annual earnings history is unavailable.",
    ),
  ];

  return {
    currentPeriod:
      profitability !== null
        ? "Latest twelve months"
        : metricValue(summary, "revenue") !== null ||
      metricValue(summary, "netIncome") !== null ||
      metricValue(summary, "freeCashFlow") !== null
        ? "Latest reported totals"
        : currentPeriodData?.period ?? "Latest reported totals",
    revenue,
    grossProfit,
    ebit,
    ebitda,
    netIncome,
    freeCashFlow,
    operatingCashFlow,
    grossMargin,
    operatingMargin,
    netMargin,
    ebitMargin,
    ebitdaMargin,
    freeCashFlowMargin,
    cashConversion,
    returnOnEquity,
    returnOnInvestedCapital,
    returnOnAssets,
    assetTurnover,
    cashReturnOnEnterpriseValue,
    earningsYield,
    freeCashFlowYield,
    netDebt,
    netDebtToFreeCashFlow,
    revenueGrowth,
    netIncomeGrowth,
    marginTrend,
    earningsConsistency,
    score,
    scoreLabel: scoreLabel(score),
    scoreComponents: components,
    diligence,
    opportunities: calculateOpportunities({
      score,
      marginTrend,
      earningsYield,
      freeCashFlowYield,
      netDebtToFreeCashFlow,
    }),
    trend,
    earningsBridge: buildCashFlowBridge({
      period:
        profitability !== null
          ? "Latest twelve months"
          : currentPeriodData?.period ?? "Latest reported totals",
      revenue,
      netIncome,
      freeCashFlow,
    }),
    marginTones: {
      gross: marginTone(grossMargin),
      operating: marginTone(operatingMargin),
      net: marginTone(netMargin),
      freeCashFlow: marginTone(freeCashFlowMargin),
    },
    returnInterpretations: returnInterpretations({
      returnOnEquity,
      returnOnInvestedCapital,
      returnOnAssets,
    }),
  };
}
