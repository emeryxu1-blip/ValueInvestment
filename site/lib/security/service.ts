import type {
  FinancialPeriod,
  Metric,
  SecuritySummaryResponse,
} from "../contracts";
import { fetchAInvest } from "../ainvest/client";
import {
  normalizeSeries,
  normalizeSnapshot,
  displayNumberValue,
  numberValue,
  objectValue,
  stringValue,
  type NormalizedSnapshotRow,
} from "../ainvest/normalize";
import {
  buildSecuritySnapshotRequest,
  buildSeriesRequest,
} from "../ainvest/requests";
import { metric } from "../metric";
import { catalogEntryForMarketCode, type ResolvedSecurity } from "../market-codes";
import {
  deriveMispricing,
  finiteNumber,
  parseEarningsRevenueModule,
  parseDcfModule,
} from "./derivations";
import { buildCashFlowBridge } from "./bridges";
import { getPeersResponse, unavailablePeersResponse } from "./peers";
import { companyAnalysisApplicability } from "./company-analysis-applicability.ts";
import { positiveNumber } from "./valuation.ts";
import { fallbackSecuritySummary } from "./fallback-summary.ts";
import { snapshotRowForSecurity } from "./screener-fallback.ts";
import type { ScreenerClientSnapshotPayload } from "../screener/client-snapshot-contract.ts";

function unavailable<T>(reason: string, unit?: string): Metric<T> {
  return metric<T>(null, "derived", { reason, unit });
}

function liveNumber(
  row: NormalizedSnapshotRow,
  id: string,
  _fetchedAt: string,
  unit?: string,
): Metric<number> {
  const value = displayNumberValue(row, id);
  return metric(value, "live", {
    asOf: row.values[id]?.asOf ?? null,
    unit,
    ...(value == null ? { reason: "Market data returned no supported value." } : {}),
  });
}

function financialPeriodsFromSeries(payload: unknown): {
  annual: FinancialPeriod[];
  quarterly: FinancialPeriod[];
} {
  const values = normalizeSeries(payload)[0]?.values ?? {};
  const byDate = new Map<string, FinancialPeriod>();
  for (const [id, series] of Object.entries(values)) {
    for (const point of series.points) {
      const period = point.time.slice(0, 10);
      const current = byDate.get(period) ?? {
        period,
        revenue: null,
        netIncome: null,
      };
      if (id === "revenue") current.revenue = point.value;
      if (id === "netIncome") current.netIncome = point.value;
      byDate.set(period, current);
    }
  }
  const quarterly = [...byDate.values()]
    .sort((left, right) => left.period.localeCompare(right.period))
    .slice(-12);
  const latestByYear = new Map<string, FinancialPeriod>();
  for (const period of quarterly) {
    const year = period.period.slice(0, 4);
    latestByYear.set(year, {
      ...period,
      period: `Year-end TTM ${year}`,
    });
  }
  return { annual: [...latestByYear.values()].slice(-5), quarterly };
}

async function fetchFinancials(resolved: ResolvedSecurity) {
  try {
    const payload = await fetchAInvest(
      "series",
      buildSeriesRequest(resolved.marketCode, "financials", "5y"),
    );
    return financialPeriodsFromSeries(payload);
  } catch {
    return { annual: [], quarterly: [] };
  }
}

function metricNarrative(options: {
  symbol: string;
  mispricing: number | null;
  revenueGrowth: number | null;
  healthScore: number | null;
}): string[] {
  const narrative: string[] = [];
  if (options.mispricing != null) {
    narrative.push(
      options.mispricing >= 0
        ? `The selected valuation is ${(options.mispricing * 100).toFixed(1)}% above the latest price.`
        : `The selected valuation is ${Math.abs(options.mispricing * 100).toFixed(1)}% below the latest price.`,
    );
  }
  if (options.revenueGrowth != null) {
    narrative.push(
      `Revenue growth is ${options.revenueGrowth.toFixed(1)}%; compare it with cash-flow conversion before drawing a conclusion.`,
    );
  }
  if (options.healthScore != null) {
    narrative.push(
      `${options.symbol}'s financial-health score is ${options.healthScore.toFixed(1)} out of 10.`,
    );
  }
  if (narrative.length === 0) {
    narrative.push("Available metrics are insufficient for a valuation narrative.");
  }
  return narrative;
}

export async function getSecuritySummary(
  resolved: ResolvedSecurity,
  options: { fallbackSnapshot?: ScreenerClientSnapshotPayload } = {},
): Promise<SecuritySummaryResponse> {
  let payload: unknown;
  try {
    payload = await fetchAInvest(
      "snapshot",
      buildSecuritySnapshotRequest(resolved.marketCode),
    );
  } catch (error) {
    const fallbackRow = options.fallbackSnapshot
      ? snapshotRowForSecurity(options.fallbackSnapshot, resolved)
      : null;
    if (fallbackRow) {
      return fallbackSecuritySummary(
        resolved,
        fallbackRow,
        options.fallbackSnapshot?.asOf ?? new Date().toISOString(),
      );
    }
    throw error;
  }
  const row = normalizeSnapshot(payload).rows[0];
  if (!row) throw new Error("The market data service returned no security row.");

  const fetchedAt = new Date().toISOString();
  const moduleFinancials = parseEarningsRevenueModule(
    objectValue(row, "earningsRevenueModule"),
  );
  const applicability = companyAnalysisApplicability(resolved, row);
  const companyAnalysisSupported = applicability.companyAnalysis;
  const companyAnalysisReason = applicability.reason;
  const [peers, fallbackFinancials] = await Promise.all([
    companyAnalysisSupported
      ? getPeersResponse(resolved, row).catch(() =>
          unavailablePeersResponse(
            resolved,
            "Peer data is temporarily unavailable.",
          ),
        )
      : Promise.resolve(
          unavailablePeersResponse(resolved, companyAnalysisReason!),
        ),
    !companyAnalysisSupported || moduleFinancials.quarterly.length > 0
      ? Promise.resolve({ annual: [], quarterly: [] })
      : fetchFinancials(resolved),
  ]);
  const financials =
    moduleFinancials.quarterly.length > 0 ? moduleFinancials : fallbackFinancials;
  const dcfModule = parseDcfModule(objectValue(row, "fairValueModule"));
  const dcfValue = companyAnalysisSupported
    ? positiveNumber(dcfModule.fairValue)
    : null;
  const peerValue = companyAnalysisSupported
    ? positiveNumber(peers.peerValue.value)
    : null;
  const fairValue = dcfValue ?? peerValue;
  const price = numberValue(row, "price");
  const mispricing = deriveMispricing(fairValue, price);
  const liveCompany = stringValue(row, "company");
  const sector = stringValue(row, "sector");
  const industry = stringValue(row, "industry");
  const description = unavailable<string>(
    "No supported editorial profile is available for this symbol.",
  );
  const valueMetric = (value: number | null, unit: string, reason: string) =>
    metric(value, "derived", { asOf: fetchedAt, unit, reason });
  const revenueGrowth = displayNumberValue(row, "revenueGrowth");
  const revenue = numberValue(row, "revenue");
  const netIncome = numberValue(row, "netIncome");
  const freeCashFlow = numberValue(row, "freeCashFlow");
  const netMargin =
    revenue != null && revenue !== 0 && netIncome != null
      ? netIncome / revenue
      : null;
  const freeCashFlowMargin =
    revenue != null && revenue !== 0 && freeCashFlow != null
      ? freeCashFlow / revenue
      : null;
  const healthScore = numberValue(row, "healthScore");
  const dividendModule = objectValue<{
    AnnualAmount?: unknown;
  }>(row, "dividendStabilityModule");
  const latestDividend = Array.isArray(dividendModule?.AnnualAmount)
    ? dividendModule.AnnualAmount
        .map((point) => (Array.isArray(point) ? finiteNumber(point[1]) : null))
        .find((value) => value != null) ?? null
    : null;

  return {
    applicability,
    identity: {
      marketCode: resolved.marketCode,
      exchange: resolved.exchange,
      symbol: resolved.symbol,
      company: metric(liveCompany ?? resolved.companyName, liveCompany ? "live" : "derived", {
        asOf: liveCompany ? row.values.company?.asOf ?? null : null,
        ...(!liveCompany
          ? {
              reason: `Resolved from the ${resolved.catalogAsOf} supported security catalog.`,
            }
          : {}),
      }),
      description,
      sector: sector
        ? metric(sector, "live", { asOf: row.values.sector?.asOf ?? null })
        : unavailable("Sector is unavailable."),
      industry: industry
        ? metric(industry, "live", { asOf: row.values.industry?.asOf ?? null })
        : unavailable("Industry is unavailable."),
      country: unavailable<string>(
        "Issuer domicile is not available from the supported AInvest C-side indicators.",
      ),
      currency: "USD",
    },
    quote: {
      price: liveNumber(row, "price", fetchedAt, "USD"),
      changePercent: liveNumber(row, "changePercent", fetchedAt, "%"),
      marketCap: liveNumber(row, "marketCap", fetchedAt, "USD"),
      previousClose: liveNumber(row, "previousClose", fetchedAt, "USD"),
      dayHigh: liveNumber(row, "dayHigh", fetchedAt, "USD"),
      dayLow: liveNumber(row, "dayLow", fetchedAt, "USD"),
    },
    valuation: {
      dcfValue: metric(dcfValue, "live", {
        asOf: row.values.fairValueModule?.asOf ?? null,
        unit: "USD",
        ...(dcfValue == null
          ? {
              reason:
                companyAnalysisReason ??
                "Market data returned no supported cash-flow value.",
            }
          : {}),
      }),
      peerValue: peers.peerValue,
      fairValue: valueMetric(
        fairValue,
        "USD",
        companyAnalysisReason ??
          (dcfValue != null
            ? "AInvest cash-flow valuation; the peer estimate is shown separately."
            : peerValue != null
              ? "Peer-multiple estimate used because AInvest returned no cash-flow valuation."
              : "No supported valuation was returned."),
      ),
      mispricing: valueMetric(
        mispricing,
        "ratio",
        companyAnalysisReason ??
          "Selected fair value divided by price, minus one.",
      ),
    },
    scores: {
      past: liveNumber(row, "pastScore", fetchedAt, "/10"),
      health: liveNumber(row, "healthScore", fetchedAt, "/10"),
      future: liveNumber(row, "futureScore", fetchedAt, "/10"),
    },
    fundamentals: {
      pe: liveNumber(row, "pe", fetchedAt, "x"),
      pb: liveNumber(row, "pb", fetchedAt, "x"),
      ps: liveNumber(row, "ps", fetchedAt, "x"),
      eps: liveNumber(row, "eps", fetchedAt, "USD"),
      revenue: liveNumber(row, "revenue", fetchedAt, "USD"),
      netIncome: liveNumber(row, "netIncome", fetchedAt, "USD"),
      freeCashFlow: liveNumber(row, "freeCashFlow", fetchedAt, "USD"),
      debt: liveNumber(row, "debt", fetchedAt, "USD"),
      cash: liveNumber(row, "cash", fetchedAt, "USD"),
      roe: liveNumber(row, "roe", fetchedAt, "%"),
      revenueGrowth: liveNumber(row, "revenueGrowth", fetchedAt, "%"),
      earningsGrowth: liveNumber(row, "earningsGrowth", fetchedAt, "%"),
      dividendYield: liveNumber(row, "dividendYield", fetchedAt, "%"),
    },
    financials,
    derived: {
      netMargin: valueMetric(
        netMargin,
        "ratio",
        "Net income divided by revenue.",
      ),
      freeCashFlowMargin: valueMetric(
        freeCashFlowMargin,
        "ratio",
        "Free cash flow divided by revenue.",
      ),
      cashFlowBridge: buildCashFlowBridge({
        period: "Latest twelve months",
        revenue,
        netIncome,
        freeCashFlow,
      }),
    },
    capitalReturns: {
      dividends: metric(latestDividend, "live", {
        asOf: row.values.dividendStabilityModule?.asOf ?? null,
        unit: "USD/share",
        ...(latestDividend == null
          ? { reason: "A supported annual dividend amount was not returned." }
          : {}),
      }),
      debtToEquity: liveNumber(row, "debtToEquity", fetchedAt, "%"),
    },
    narrative: metricNarrative({
      symbol: resolved.symbol,
      mispricing,
      revenueGrowth,
      healthScore,
    }),
    researchPrompts: [
      `What assumptions drive ${resolved.symbol}'s cash-flow value?`,
      `Which operating metrics would invalidate the current ${resolved.symbol} valuation?`,
      `How do ${resolved.symbol}'s positive peer multiples compare with its own?`,
    ],
    related: peers.peers.flatMap((peer) => {
      const catalog = catalogEntryForMarketCode(peer.marketCode);
      return catalog ? [{ exchange: catalog.exchange, symbol: peer.symbol }] : [];
    }),
    dataMode: "live",
    asOf: fetchedAt,
  };
}
