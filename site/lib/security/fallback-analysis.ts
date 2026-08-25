import type {
  AnalysisMetric,
  SecurityAnalysisResponse,
} from "../contracts";
import type { ResolvedSecurity } from "../market-codes";
import type { ScreenerClientSnapshotRow } from "../screener/client-snapshot-contract";
import { VALUATION_MODEL_VERSION } from "./valuation";
import type { SecurityValuation } from "./valuation";

const metric = (
  label: string,
  value: AnalysisMetric["value"],
  asOf: string,
  unit: string | null = null,
): AnalysisMetric => ({
  label,
  value,
  asOf,
  valueType: typeof value,
  unit,
  rawUnit: unit,
});

export function fallbackAnalysis(
  resolved: ResolvedSecurity,
  row: ScreenerClientSnapshotRow,
  view: "dcf-valuation" | "relative-valuation" | "profitability",
  asOf: string,
): SecurityAnalysisResponse {
  const price = row.price;
  const fairValue = row.fairValue;
  const gap = row.mispricing;
  const metrics: Record<string, AnalysisMetric> = {
    company: metric("Company", row.company ?? resolved.companyName, asOf),
    price: metric("Market price", price, asOf, "USD"),
    marketCap: metric("Market capitalization", row.marketCap, asOf, "USD"),
    pe: metric("Price to earnings", row.pe, asOf, "x"),
    revenueGrowth: metric("Revenue growth", row.revenueGrowth, asOf, "%"),
  };

  const valuation: SecurityValuation | null =
    view === "dcf-valuation"
      ? {
          kind: "dcf" as const,
          method: "ainvest-dcf" as const,
          providerValue: fairValue,
          providerValuePeriod: asOf.slice(0, 10),
          providerValueAsOf: asOf,
          cashFlow: {
            reported: [],
            forecast: [],
            latestReported: null,
            trailingFourQuarter: null,
            nextForecast: null,
            forwardFourQuarter: null,
            forwardGrowth: null,
          },
          cashFlowAsOf: null,
          providerValuePeriods: fairValue == null ? [] : [{ period: asOf.slice(0, 10), value: fairValue }],
          price,
          priceAsOf: asOf,
          baseValue: fairValue,
          gap,
          opportunity:
            gap == null
              ? "Stored valuation evidence is available, but the current gap could not be calculated."
              : gap >= 0
                ? "The stored provider value is above the stored market price; validate the underlying assumptions."
                : "The stored provider value is below the stored market price; investigate the valuation gap.",
          modelVersion: VALUATION_MODEL_VERSION,
        }
      : view === "relative-valuation"
        ? {
            kind: "relative" as const,
            measures: [],
            relativeValue: null,
            price,
            priceAsOf: asOf,
            peerAsOf: null,
            baseValue: null,
            gap: null,
            opportunity: "Detailed peer data is temporarily unavailable; the stored P/E and price remain visible above.",
            aggregation: "median-positive-implied-values" as const,
            modelVersion: VALUATION_MODEL_VERSION,
          }
        : null;

  return {
    view,
    identity: {
      marketCode: resolved.marketCode,
      exchange: resolved.exchange,
      symbol: resolved.symbol,
      company: row.company ?? resolved.companyName,
      currency: row.currency || "USD",
    },
    metrics,
    peers: [],
    valuation,
    peerReason: "Detailed live peer data is temporarily unavailable.",
    asOf,
  };
}
