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
import type { ResolvedSecurity } from "../market-codes";
import {
  combineFairValues,
  deriveMispricing,
  finiteNumber,
  parseEarningsRevenueModule,
  parseDcfModule,
  scenarioValues,
} from "./derivations";
import { buildCashFlowBridge } from "./bridges";
import { getPeersResponse, unavailablePeersResponse } from "./peers";

function unavailable<T>(reason: string, unit?: string): Metric<T> {
  return metric<T>(null, "derived", { reason, unit });
}

function liveNumber(
  row: NormalizedSnapshotRow,
  id: string,
  fetchedAt: string,
  unit?: string,
): Metric<number> {
  const value = displayNumberValue(row, id);
  return metric(value, "live", {
    asOf: row.values[id]?.asOf ?? fetchedAt,
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
        freeCashFlow: null,
        debt: null,
        cash: null,
      };
      if (id === "revenue") current.revenue = point.value;
      if (id === "netIncome") current.netIncome = point.value;
      if (id === "freeCashFlow") current.freeCashFlow = point.value;
      byDate.set(period, current);
    }
  }
  const quarterly = [...byDate.values()]
    .sort((left, right) => left.period.localeCompare(right.period))
    .slice(-12);
  const latestByYear = new Map<string, FinancialPeriod>();
  for (const period of quarterly) latestByYear.set(period.period.slice(0, 4), period);
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

async function fetchTarget(resolved: ResolvedSecurity): Promise<number | null> {
  try {
    const payload = await fetchAInvest(
      "series",
      buildSeriesRequest(resolved.marketCode, "targets", "3y"),
    );
    const points = normalizeSeries(payload)[0]?.values.target?.points ?? [];
    return points.at(-1)?.value ?? null;
  } catch {
    return null;
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
        ? `The blended valuation is ${(options.mispricing * 100).toFixed(1)}% above the latest price.`
        : `The latest price is ${Math.abs(options.mispricing * 100).toFixed(1)}% above the blended valuation.`,
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
): Promise<SecuritySummaryResponse> {
  const payload = await fetchAInvest(
    "snapshot",
    buildSecuritySnapshotRequest(resolved.marketCode),
  );
  const row = normalizeSnapshot(payload).rows[0];
  if (!row) throw new Error("The market data service returned no security row.");

  const fetchedAt = new Date().toISOString();
  const moduleFinancials = parseEarningsRevenueModule(
    objectValue(row, "earningsRevenueModule"),
  );
  const [peers, fallbackFinancials, targetMean] = await Promise.all([
    getPeersResponse(resolved, row).catch(() =>
      unavailablePeersResponse(
        resolved,
        "Peer data is temporarily unavailable.",
      ),
    ),
    moduleFinancials.quarterly.length > 0
      ? Promise.resolve({ annual: [], quarterly: [] })
      : fetchFinancials(resolved),
    fetchTarget(resolved),
  ]);
  const financials =
    moduleFinancials.quarterly.length > 0 ? moduleFinancials : fallbackFinancials;
  const dcfModule = parseDcfModule(objectValue(row, "fairValueModule"));
  const dcfValue = dcfModule.fairValue;
  const peerValue = peers.peerValue.value;
  const fairValue = combineFairValues(dcfValue, peerValue);
  const price = numberValue(row, "price");
  const mispricing = deriveMispricing(fairValue, price);
  const scenarios = scenarioValues(fairValue);
  const liveCompany = stringValue(row, "company");
  const sector = stringValue(row, "sector");
  const industry = stringValue(row, "industry");
  const analystCount = ["analystBuy", "analystHold", "analystSell"]
    .map((id) => numberValue(row, id))
    .filter((value): value is number => value != null)
    .reduce((sum, value) => sum + value, 0);
  const description = unavailable<string>(
    "No supported editorial profile is available for this symbol.",
  );
  const valueMetric = (value: number | null, unit: string, reason: string) =>
    metric(value, "derived", { asOf: fetchedAt, unit, reason });
  const revenueGrowth = numberValue(row, "revenueGrowth");
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
  const latestFinancialPeriod = financials.annual.at(-1) ?? null;
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
    identity: {
      marketCode: resolved.marketCode,
      exchange: resolved.exchange,
      symbol: resolved.symbol,
      company: metric(liveCompany ?? resolved.companyName, liveCompany ? "live" : "derived", {
        asOf: liveCompany ? row.values.company?.asOf ?? fetchedAt : null,
        ...(!liveCompany
          ? {
              reason: `Resolved from the ${resolved.catalogAsOf} supported security catalog.`,
            }
          : {}),
      }),
      description,
      sector: sector
        ? metric(sector, "live", { asOf: row.values.sector?.asOf ?? fetchedAt })
        : unavailable("Sector is unavailable."),
      industry: industry
        ? metric(industry, "live", { asOf: row.values.industry?.asOf ?? fetchedAt })
        : unavailable("Industry is unavailable."),
      country: metric("United States", "derived", {
        reason: "Derived from the supported US exchange route.",
      }),
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
        asOf: row.values.fairValueModule?.asOf ?? fetchedAt,
        unit: "USD",
        ...(dcfValue == null
          ? { reason: "Market data returned no supported cash-flow value." }
          : {}),
      }),
      peerValue: peers.peerValue,
      fairValue: valueMetric(fairValue, "USD", "Mean of available positive DCF and peer values."),
      mispricing: valueMetric(mispricing, "ratio", "Fair value divided by price, minus one."),
      bearValue: valueMetric(scenarios.bear, "USD", "Fallback scenario at 80% of base value."),
      baseValue: valueMetric(scenarios.base, "USD", "Blended base value."),
      bullValue: valueMetric(scenarios.bull, "USD", "Fallback scenario at 120% of base value."),
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
      cashFlowBridge: latestFinancialPeriod
        ? buildCashFlowBridge(latestFinancialPeriod)
        : null,
    },
    targets: {
      low: unavailable("A supported analyst low target was not returned.", "USD"),
      mean: metric(targetMean, "live", {
        asOf: fetchedAt,
        unit: "USD",
        ...(targetMean == null ? { reason: "A supported analyst target was not returned." } : {}),
      }),
      high: unavailable("A supported analyst high target was not returned.", "USD"),
      analystCount: metric(analystCount || null, "live", {
        asOf: fetchedAt,
        ...(analystCount === 0 ? { reason: "Analyst count was not returned." } : {}),
      }),
    },
    capitalReturns: {
      dividends: metric(latestDividend, "live", {
        asOf: row.values.dividendStabilityModule?.asOf ?? fetchedAt,
        unit: "USD/share",
        ...(latestDividend == null
          ? { reason: "A supported annual dividend amount was not returned." }
          : {}),
      }),
      buybacks: unavailable("A supported buyback amount was not returned.", "USD"),
      debtToEquity: liveNumber(row, "debtToEquity", fetchedAt, "%"),
    },
    ownership: {
      institutional: unavailable("Institutional ownership is unavailable.", "%"),
      insider: unavailable("Insider ownership is unavailable.", "%"),
      public: unavailable("Public ownership is unavailable.", "%"),
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
    related: peers.peers.map((peer) => peer.symbol),
    dataMode: "live",
    asOf: fetchedAt,
  };
}
