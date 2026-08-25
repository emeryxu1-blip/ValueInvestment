import type {
  Metric,
  SecuritySummaryResponse,
} from "../contracts";
import type { ResolvedSecurity } from "../market-codes";
import type { ScreenerClientSnapshotPayload } from "../screener/client-snapshot-contract";

type SnapshotRow = ScreenerClientSnapshotPayload["rows"][number];

const unavailable = <T>(reason: string, unit?: string): Metric<T> => ({
  value: null,
  source: "derived",
  asOf: null,
  ...(unit ? { unit } : {}),
  reason,
});

const stored = <T>(value: T | null, asOf: string, unit?: string): Metric<T> => ({
  value,
  source: "derived",
  asOf,
  ...(unit ? { unit } : {}),
  ...(value == null ? { reason: "The stored screener snapshot has no value for this metric." } : {}),
});

export function fallbackSecuritySummary(
  resolved: ResolvedSecurity,
  row: SnapshotRow,
  asOf: string,
): SecuritySummaryResponse {
  const company = row.company ?? resolved.companyName;
  const reason =
    "Detailed live security data is temporarily unavailable; values shown here come from the latest stored screener snapshot.";
  const unavailableMetric = <T>(unit?: string) => unavailable<T>(reason, unit);
  return {
    applicability: {
      companyAnalysis: false,
      securityType: resolved.securityType,
      reason,
    },
    identity: {
      marketCode: resolved.marketCode,
      exchange: resolved.exchange,
      symbol: resolved.symbol,
      company: stored(company, asOf),
      description: unavailableMetric<string>(),
      sector: unavailableMetric<string>(),
      industry: unavailableMetric<string>(),
      country: unavailableMetric<string>(),
      currency: row.currency || "USD",
    },
    quote: {
      price: stored(row.price, asOf, row.currency || "USD"),
      changePercent: stored(row.changePercent, asOf, "%"),
      marketCap: stored(row.marketCap, asOf, row.currency || "USD"),
      previousClose: unavailableMetric<number>(row.currency || "USD"),
      dayHigh: unavailableMetric<number>(row.currency || "USD"),
      dayLow: unavailableMetric<number>(row.currency || "USD"),
    },
    valuation: {
      dcfValue: stored(row.fairValue, asOf, row.currency || "USD"),
      peerValue: unavailableMetric<number>(row.currency || "USD"),
      fairValue: stored(row.fairValue, asOf, row.currency || "USD"),
      mispricing: stored(row.mispricing, asOf, "ratio"),
    },
    scores: {
      past: unavailableMetric<number>("/10"),
      health: unavailableMetric<number>("/10"),
      future: unavailableMetric<number>("/10"),
    },
    fundamentals: {
      pe: stored(row.pe, asOf, "x"),
      pb: unavailableMetric<number>("x"),
      ps: unavailableMetric<number>("x"),
      eps: unavailableMetric<number>(row.currency || "USD"),
      revenue: unavailableMetric<number>(row.currency || "USD"),
      netIncome: unavailableMetric<number>(row.currency || "USD"),
      freeCashFlow: unavailableMetric<number>(row.currency || "USD"),
      debt: unavailableMetric<number>(row.currency || "USD"),
      cash: unavailableMetric<number>(row.currency || "USD"),
      roe: unavailableMetric<number>("%"),
      revenueGrowth: stored(row.revenueGrowth, asOf, "%"),
      earningsGrowth: unavailableMetric<number>("%"),
      dividendYield: unavailableMetric<number>("%"),
    },
    financials: { annual: [], quarterly: [] },
    derived: {
      netMargin: unavailableMetric<number>("ratio"),
      freeCashFlowMargin: unavailableMetric<number>("ratio"),
      cashFlowBridge: null,
    },
    capitalReturns: {
      dividends: unavailableMetric<number>("USD/share"),
      debtToEquity: unavailableMetric<number>("%"),
    },
    narrative: [reason],
    researchPrompts: [
      `What assumptions drive ${resolved.symbol}'s cash-flow value?`,
      `Which operating metrics would invalidate the current ${resolved.symbol} valuation?`,
    ],
    related: [],
    dataMode: "live",
    asOf,
  };
}
