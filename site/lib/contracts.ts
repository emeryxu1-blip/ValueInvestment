export type MetricSource = "live" | "derived";

export type Metric<T> = {
  value: T | null;
  source: MetricSource;
  asOf: string | null;
  unit?: string;
  reason?: string;
};

export type ScreenerSort =
  | "company"
  | "symbol"
  | "price"
  | "changePercent"
  | "marketCap"
  | "fairValue"
  | "mispricing"
  | "pe"
  | "revenueGrowth";
export type SortOrder = "asc" | "desc";

export type ScreenerFilters = {
  fairValueGtePrice: boolean;
  minMarketCap?: number;
  maxMarketCap?: number;
  minPrice?: number;
  maxPrice?: number;
  minChangePercent?: number;
  maxChangePercent?: number;
  minMispricing?: number;
  maxMispricing?: number;
  minPe?: number;
  maxPe?: number;
  minRevenueGrowth?: number;
  maxRevenueGrowth?: number;
  positiveNetIncome?: boolean;
  positiveFreeCashFlow?: boolean;
  maxDebtToEquity?: number;
  sector?: string;
  exchanges?: string[];
  symbols?: string[];
  query?: string;
  unsupported?: string[];
};

export type ScreenerRow = {
  marketCode: string;
  exchange: string;
  symbol: string;
  company: Metric<string>;
  price: Metric<number>;
  changePercent: Metric<number>;
  marketCap: Metric<number>;
  fairValue: Metric<number>;
  mispricing: Metric<number>;
  pe: Metric<number>;
  revenueGrowth: Metric<number>;
  netIncome: Metric<number>;
  freeCashFlow: Metric<number>;
  debtToEquity: Metric<number>;
  sector: Metric<string>;
  currency: string;
};

export type ScanProgress = {
  state: "idle" | "warming" | "ready" | "error";
  scanned: number;
  total: number | null;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

export type ScreenerResponse = {
  status: "ready" | "warming" | "partial";
  data: ScreenerRow[];
  page: {
    page: number;
    pageSize: number;
    total: number | null;
    totalPages: number | null;
  };
  applied: {
    sort: ScreenerSort;
    order: SortOrder;
    filters: ScreenerFilters;
    columns: string[];
  };
  scan?: ScanProgress;
  asOf: string;
  message?: string;
};

export type SecurityIdentity = {
  marketCode: string;
  exchange: string;
  symbol: string;
  company: Metric<string>;
  description: Metric<string>;
  sector: Metric<string>;
  industry: Metric<string>;
  country: Metric<string>;
  currency: string;
};

export type FinancialPeriod = {
  period: string;
  revenue: number | null;
  netIncome: number | null;
  freeCashFlow: number | null;
  debt: number | null;
  cash: number | null;
};

export type FinancialBridgeRow = {
  label: string;
  value: number;
  from: number;
  to: number;
  kind: "total" | "positive" | "negative" | "cash";
};

export type FinancialBridge = {
  period: string;
  rows: FinancialBridgeRow[];
};

export type SecuritySummaryResponse = {
  identity: SecurityIdentity;
  quote: {
    price: Metric<number>;
    changePercent: Metric<number>;
    marketCap: Metric<number>;
    previousClose: Metric<number>;
    dayHigh: Metric<number>;
    dayLow: Metric<number>;
  };
  valuation: {
    dcfValue: Metric<number>;
    peerValue: Metric<number>;
    fairValue: Metric<number>;
    mispricing: Metric<number>;
    bearValue: Metric<number>;
    baseValue: Metric<number>;
    bullValue: Metric<number>;
  };
  scores: {
    past: Metric<number>;
    health: Metric<number>;
    future: Metric<number>;
  };
  fundamentals: {
    pe: Metric<number>;
    pb: Metric<number>;
    ps: Metric<number>;
    eps: Metric<number>;
    revenue: Metric<number>;
    netIncome: Metric<number>;
    freeCashFlow: Metric<number>;
    debt: Metric<number>;
    cash: Metric<number>;
    roe: Metric<number>;
    revenueGrowth: Metric<number>;
    earningsGrowth: Metric<number>;
    dividendYield: Metric<number>;
  };
  financials: {
    annual: FinancialPeriod[];
    quarterly: FinancialPeriod[];
  };
  derived: {
    netMargin: Metric<number>;
    freeCashFlowMargin: Metric<number>;
    cashFlowBridge: FinancialBridge | null;
  };
  targets: {
    low: Metric<number>;
    mean: Metric<number>;
    high: Metric<number>;
    analystCount: Metric<number>;
  };
  capitalReturns: {
    dividends: Metric<number>;
    buybacks: Metric<number>;
    debtToEquity: Metric<number>;
  };
  ownership: {
    institutional: Metric<number>;
    insider: Metric<number>;
    public: Metric<number>;
  };
  narrative: string[];
  researchPrompts: string[];
  related: string[];
  dataMode: "live";
  asOf: string;
};

export type SeriesPoint = { time: string; value: number | null };
export type SeriesResponse = {
  symbol: string;
  marketCode: string;
  group: string;
  range: string;
  series: Array<{
    id: string;
    label: string;
    unit: string;
    points: SeriesPoint[];
  }>;
  source: MetricSource;
  asOf: string;
  reason?: string;
};

export type PeerRow = {
  marketCode: string;
  symbol: string;
  company: Metric<string>;
  price: Metric<number>;
  marketCap: Metric<number>;
  pe: Metric<number>;
  pb: Metric<number>;
  ps: Metric<number>;
};

export type PeersResponse = {
  symbol: string;
  marketCode: string;
  peers: PeerRow[];
  medians: {
    pe: Metric<number>;
    pb: Metric<number>;
    ps: Metric<number>;
  };
  peerValue: Metric<number>;
  source: MetricSource;
  asOf: string;
};

export type SecurityAnalysisView =
  | "dcf-valuation"
  | "relative-valuation"
  | "profitability";

export type AnalysisValue =
  | string
  | number
  | boolean
  | null
  | AnalysisValue[]
  | { [key: string]: AnalysisValue };

export type AnalysisMetric = {
  label: string;
  value: AnalysisValue;
  asOf: string | null;
  valueType: string | null;
  unit: string | null;
  rawUnit: string | null;
  reason?: string;
};

export type AnalysisPeer = {
  marketCode: string;
  exchange: string;
  symbol: string;
  company: string | null;
  metrics: Record<string, AnalysisMetric>;
};

export type SecurityAnalysisResponse = {
  view: SecurityAnalysisView;
  identity: {
    marketCode: string;
    exchange: string;
    symbol: string;
    company: string | null;
    currency: string;
  };
  metrics: Record<string, AnalysisMetric>;
  peers: AnalysisPeer[];
  valuation: import("./security/valuation").SecurityValuation | null;
  peerReason?: string;
  asOf: string;
};

export type BusinessQualityResponse = {
  summary: SecuritySummaryResponse;
  profitability: import("./security/profitability").ProfitabilitySnapshot;
  analysis: import("./security/business-quality").BusinessQualityAnalysis;
  peerEconomics: import("./security/business-quality").PeerEconomics[];
  peerMedians: {
    netMargin: number | null;
    returnOnEquity: number | null;
  };
  peerComparison: {
    netMarginGap: number | null;
    narrative: string;
  };
  asOf: string;
  modelVersion: string;
};
