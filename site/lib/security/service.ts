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
  parseDcfModule,
  parseEarningsRevenueModule,
} from "./derivations";
import { buildCashFlowBridge } from "./bridges";
import { getPeersResponse, unavailablePeersResponse } from "./peers";
import { companyAnalysisApplicability } from "./company-analysis-applicability.ts";
import {
  calculateEarningsPowerFloor,
  EARNINGS_POWER_METHOD,
} from "./intrinsic-value.ts";
import { positiveNumber } from "./valuation.ts";


function unavailable<T>(reason: string, unit?: string): Metric<T> {
  return metric<T>(null, "derived", { reason, unit });
}

function liveNumber(
  row: NormalizedSnapshotRow,
  id: string,
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
  return { annual: [], quarterly };
}

async function fetchFinancials(resolved: ResolvedSecurity) {
  const payload = await fetchAInvest(
    "series",
    buildSeriesRequest(resolved.marketCode, "financials", "5y"),
  );
  return financialPeriodsFromSeries(payload);
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
): Promise<SecuritySummaryResponse> {
  const payload = await fetchAInvest(
    "snapshot",
    buildSecuritySnapshotRequest(resolved.marketCode),
  );
  const row = normalizeSnapshot(payload).rows[0];
  if (!row || row.symbolCode !== resolved.marketCode) {
    throw new Error("The market data service returned no matching security row.");
  }

  const moduleFinancials = parseEarningsRevenueModule(
    objectValue(row, "earningsRevenueModule"),
  );
  const applicability = companyAnalysisApplicability(resolved, row);
  const companyAnalysisSupported = applicability.companyAnalysis;
  const companyAnalysisReason = applicability.reason;
  const [peers, seriesFinancials] = await Promise.all([
    companyAnalysisSupported
      ? getPeersResponse(resolved, row)
      : Promise.resolve(
          unavailablePeersResponse(resolved, companyAnalysisReason!),
        ),
    !companyAnalysisSupported || moduleFinancials.quarterly.length > 0
      ? Promise.resolve({ annual: [], quarterly: [] })
      : fetchFinancials(resolved),
  ]);
  const financials =
    moduleFinancials.quarterly.length > 0 ? moduleFinancials : seriesFinancials;
  const price = numberValue(row, "price");
  const revenue = numberValue(row, "revenue");
  const netIncome = numberValue(row, "netIncome");
  const freeCashFlow = numberValue(row, "freeCashFlow");
  const cash = numberValue(row, "cash");
  const debt = numberValue(row, "debt");
  const sharesOutstanding = numberValue(row, "sharesOutstanding");
  const dcfModule = parseDcfModule(objectValue(row, "fairValueModule"));
  const dcfValue = companyAnalysisSupported
    ? positiveNumber(dcfModule.fairValue)
    : null;
  const earningsPowerCalculation = companyAnalysisSupported
    ? calculateEarningsPowerFloor({ freeCashFlow, netIncome, cash, debt, sharesOutstanding })
    : null;
  const earningsPowerFloor = earningsPowerCalculation?.value ?? null;
  const peerValue = companyAnalysisSupported ? positiveNumber(peers.peerValue.value) : null;
  const fairValue = dcfValue ?? peerValue;
  const mispricing = deriveMispricing(fairValue, price);
  const dcfAsOf = row.values.fairValueModule?.asOf ?? null;
  const earningsPowerInputDates = [
    row.values.freeCashFlow?.asOf,
    row.values.netIncome?.asOf,
    row.values.cash?.asOf,
    row.values.debt?.asOf,
    row.values.sharesOutstanding?.asOf,
  ];
  const earningsPowerAsOf = earningsPowerInputDates.every(
    (date): date is string => typeof date === "string",
  )
    ? [...earningsPowerInputDates].sort().at(-1) ?? null
    : null;
  const selectedValueAsOf = dcfValue != null ? dcfAsOf : peers.asOf;
  const liveCompany = stringValue(row, "company");
  const sector = stringValue(row, "sector");
  const industry = stringValue(row, "industry");
  const description = unavailable<string>(
    "No supported editorial profile is available for this symbol.",
  );
  const valueMetric = (
    value: number | null,
    unit: string | undefined,
    reason: string,
    asOf: string | null = null,
  ) =>
    metric(value, "derived", {
      asOf,
      ...(unit ? { unit } : {}),
      reason,
    });
  const revenueGrowth = displayNumberValue(row, "revenueGrowth");
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
      company: metric(liveCompany, liveCompany ? "live" : "unknown", {
        asOf: liveCompany ? row.values.company?.asOf ?? null : null,
        ...(!liveCompany
          ? {
              reason: "Company name is unavailable in the current market data.",
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
        "Issuer domicile is not available from the supported market-data fields.",
      ),
      currency: "USD",
    },
    quote: {
      price: liveNumber(row, "price", "USD"),
      changePercent: liveNumber(row, "changePercent", "%"),
      marketCap: liveNumber(row, "marketCap", "USD"),
      previousClose: liveNumber(row, "previousClose", "USD"),
      dayHigh: liveNumber(row, "dayHigh", "USD"),
      dayLow: liveNumber(row, "dayLow", "USD"),
    },
    valuation: {
      dcfValue: metric(dcfValue, "live", {
        asOf: dcfAsOf,
        unit: "USD",
        ...(dcfValue == null
          ? { reason: companyAnalysisReason ?? "No positive DCF value is available." }
          : {}),
      }),
      dcfModelPeriod: dcfValue == null ? null : dcfModule.fairValuePeriod,
      earningsPowerFloor: metric(earningsPowerFloor, "derived", {
        asOf: earningsPowerAsOf,
        unit: "USD",
        ...(earningsPowerFloor == null
          ? {
              reason:
                companyAnalysisReason ??
                earningsPowerCalculation?.reason ??
                "Earnings-power inputs are unavailable.",
            }
          : {}),
      }),
      peerValue: peers.peerValue,
      fairValue: valueMetric(
        fairValue,
        "USD",
        companyAnalysisReason ??
          (dcfValue != null
            ? "DCF value selected; the earnings-power floor and peer estimate are shown separately."
            : peerValue != null
              ? "Peer-multiple estimate used because no positive DCF value is available."
              : "No supported valuation was returned."),
        selectedValueAsOf,
      ),
      mispricing: valueMetric(
        mispricing,
        "ratio",
        companyAnalysisReason ?? "Selected fair value divided by price, minus one.",
        selectedValueAsOf,
      ),
      earningsPowerMethod: EARNINGS_POWER_METHOD,
    },
    scores: {
      past: liveNumber(row, "pastScore", "/10"),
      health: liveNumber(row, "healthScore", "/10"),
      future: liveNumber(row, "futureScore", "/10"),
    },
    fundamentals: {
      pe: liveNumber(row, "pe", "x"),
      pb: liveNumber(row, "pb", "x"),
      ps: liveNumber(row, "ps", "x"),
      eps: liveNumber(row, "eps"),
      revenue: liveNumber(row, "revenue"),
      netIncome: liveNumber(row, "netIncome"),
      freeCashFlow: liveNumber(row, "freeCashFlow"),
      debt: liveNumber(row, "debt"),
      cash: liveNumber(row, "cash"),
      sharesOutstanding: liveNumber(row, "sharesOutstanding", "shares"),
      roe: liveNumber(row, "roe", "%"),
      revenueGrowth: liveNumber(row, "revenueGrowth", "%"),
      earningsGrowth: liveNumber(row, "earningsGrowth", "%"),
      dividendYield: liveNumber(row, "dividendYield", "%"),
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
        ...(latestDividend == null
          ? { reason: "A supported annual dividend amount was not returned." }
          : {}),
      }),
      debtToEquity: liveNumber(row, "debtToEquity", "%"),
    },
    narrative: metricNarrative({
      symbol: resolved.symbol,
      mispricing,
      revenueGrowth,
      healthScore,
    }),
    researchPrompts: [
      `What assumptions drive ${resolved.symbol}'s DCF value?`,
      `Why does ${resolved.symbol}'s no-growth earnings-power floor differ from its DCF value?`,
      `Which operating metrics would invalidate the current ${resolved.symbol} valuation?`,
    ],
    related: peers.peers.flatMap((peer) => {
      const catalog = catalogEntryForMarketCode(peer.marketCode);
      return catalog ? [{ exchange: catalog.exchange, symbol: peer.symbol }] : [];
    }),
    dataMode: "live",
    asOf:
      Object.values(row.values)
        .map((value) => value.asOf)
        .filter((value): value is string => value != null)
        .sort()
        .at(-1) ?? null,
  };
}
