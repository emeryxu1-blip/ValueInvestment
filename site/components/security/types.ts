import type { FinancialBridge } from "@/lib/contracts";

export type Provenance = "live" | "derived";

export type Metric<T> = {
  value: T | null;
  source: Provenance;
  asOf: string | null;
  unit?: string;
  reason?: string;
};

export type FinancialPeriod = {
  period: string;
  revenue: number | null;
  netIncome: number | null;
};

export type SecuritySummary = {
  applicability: {
    companyAnalysis: boolean;
    securityType: string;
    reason: string | null;
  };
  identity: {
    marketCode?: string;
    exchange: string;
    symbol: string;
    company: Metric<string>;
    description: Metric<string>;
    sector: Metric<string>;
    industry: Metric<string>;
    country: Metric<string>;
    currency: string;
  };
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
  };
  scores: {
    past: Metric<number>;
    health: Metric<number>;
    future: Metric<number>;
  };
  fundamentals: Record<string, Metric<number>>;
  financials: {
    annual: FinancialPeriod[];
    quarterly: FinancialPeriod[];
  };
  derived: {
    netMargin: Metric<number>;
    freeCashFlowMargin: Metric<number>;
    cashFlowBridge: FinancialBridge | null;
  };
  capitalReturns: {
    dividends: Metric<number>;
    debtToEquity: Metric<number>;
  };
  narrative: string[];
  researchPrompts: string[];
  related: Array<{ exchange: string; symbol: string }>;
  dataMode: "live";
  asOf: string | null;
};

export type SeriesLine = {
  id: string;
  label: string;
  unit?: string;
  points: Array<{ time: string; value: number }>;
};

export type SeriesResponse = {
  symbol: string;
  marketCode?: string;
  group: string;
  range: string;
  series: SeriesLine[];
  source: Provenance;
  asOf: string | null;
};

export type Peer = {
  marketCode?: string;
  symbol: string;
  company: string;
  price: number | null;
  marketCap: number | null;
  pe: number | null;
  pb: number | null;
  ps: number | null;
};

export type PeersResponse = {
  symbol: string;
  marketCode?: string;
  peers: Peer[];
  medians: { pe: number | null; pb: number | null; ps: number | null };
  peerValue: Metric<number>;
  selectionReason?: string;
  source: Provenance;
  asOf: string | null;
};

export type LoadState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};
