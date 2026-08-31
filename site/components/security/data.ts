import type {
  EarningsPowerMethod,
  FinancialBridge,
  FinancialBridgeRow,
} from "@/lib/contracts";
import type {
  FinancialPeriod,
  Metric,
  PeersResponse,
  Provenance,
  SecuritySummary,
  SeriesResponse,
} from "./types";
import { normalizeChartPoints } from "../../lib/security/chart-series.ts";

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const get = (source: unknown, path: string): unknown => {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!isRecord(current)) return undefined;
    return current[part];
  }, source);
};

const first = (source: unknown, paths: string[]): unknown => {
  for (const path of paths) {
    const value = get(source, path);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};

const unwrap = (payload: unknown): UnknownRecord => {
  if (!isRecord(payload)) return {};
  if (isRecord(payload.data)) return payload.data;
  return payload;
};

const finiteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/[,$%]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const provenance = (value: unknown, missingSource: Provenance): Provenance =>
  value === "live" || value === "derived" || value === "unknown"
    ? value
    : missingSource;

const timestamp = (value: unknown): string | null =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;

export const asMetric = <T extends number | string>(
  value: unknown,
  missingValue: T | null,
  source: Provenance = "derived",
  unit?: string,
): Metric<T> => {
  const expectsNumber = typeof missingValue === "number" || unit !== undefined;
  if (isRecord(value) && "value" in value) {
    const inner = value.value;
    const parsed = expectsNumber
      ? finiteNumber(inner)
      : typeof inner === "string"
        ? inner
        : null;
    return {
      value: parsed as T | null,
      source: provenance(value.source, source),
      asOf: timestamp(value.asOf),
      unit: typeof value.unit === "string" ? value.unit : unit,
      reason: typeof value.reason === "string" ? value.reason : undefined,
    };
  }

  const parsed = expectsNumber
    ? finiteNumber(value)
    : typeof value === "string"
      ? value
      : null;
  return {
    value: (parsed ?? missingValue) as T | null,
    source,
    asOf: null,
    unit,
    reason: parsed === null && missingValue === null ? "Value is unavailable" : undefined,
  };
};

const numberMetric = (
  raw: unknown,
  paths: string[],
  missingValue: number | null,
  unit?: string,
  source: Provenance = "derived",
) => {
  const candidate = first(raw, paths);
  if (isRecord(candidate) && "value" in candidate) {
    const inner = finiteNumber(candidate.value);
    return {
      value: inner,
      source: provenance(candidate.source, source),
      asOf: timestamp(candidate.asOf),
      unit: typeof candidate.unit === "string" ? candidate.unit : unit,
      reason:
        typeof candidate.reason === "string"
          ? candidate.reason
          : inner === null
            ? "Value is unavailable"
            : undefined,
    } satisfies Metric<number>;
  }
  const parsed = finiteNumber(candidate);
  return {
    value: parsed ?? missingValue,
    source,
    asOf: null,
    unit,
    reason: parsed === null && missingValue === null ? "Value is unavailable" : undefined,
  } satisfies Metric<number>;
};

const stringMetric = (
  raw: unknown,
  paths: string[],
  missingValue: string | null,
  source: Provenance = "derived",
) => asMetric<string>(first(raw, paths), missingValue, source);

const cleanPeriods = (value: unknown): FinancialPeriod[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const period = String(item.period ?? item.year ?? item.date ?? "");
      if (!period) return null;
      return {
        period,
        revenue: finiteNumber(item.revenue),
        netIncome: finiteNumber(item.netIncome ?? item.net_income),
      };
    })
    .filter((item): item is FinancialPeriod => item !== null);
};

const normalizeEarningsPowerMethod = (value: unknown): EarningsPowerMethod => {
  const fallback: EarningsPowerMethod = {
    id: "no-growth-earnings-power-floor",
    version: "unknown",
    requiredReturn: 0.1,
    earningsHaircut: 0.8,
    terminalGrowth: 0,
    description:
      "Conservative no-growth earnings-power screening floor.",
  };
  if (!isRecord(value)) return fallback;
  return {
    id: "no-growth-earnings-power-floor",
    version: typeof value.version === "string" ? value.version : fallback.version,
    requiredReturn: finiteNumber(value.requiredReturn) ?? fallback.requiredReturn,
    earningsHaircut:
      finiteNumber(value.earningsHaircut) ?? fallback.earningsHaircut,
    terminalGrowth: finiteNumber(value.terminalGrowth) ?? fallback.terminalGrowth,
    description:
      typeof value.description === "string" ? value.description : fallback.description,
  };
};

const cleanFinancialBridge = (value: unknown): FinancialBridge | null => {
  if (!isRecord(value) || !Array.isArray(value.rows)) return null;
  const rows = value.rows
    .map((item): FinancialBridgeRow | null => {
      if (!isRecord(item)) return null;
      const label = typeof item.label === "string" ? item.label : "";
      const valueNumber = finiteNumber(item.value);
      const from = finiteNumber(item.from);
      const to = finiteNumber(item.to);
      const kind =
        item.kind === "total" ||
        item.kind === "positive" ||
        item.kind === "negative" ||
        item.kind === "cash"
          ? item.kind
          : null;
      return label && valueNumber !== null && from !== null && to !== null && kind
        ? { label, value: valueNumber, from, to, kind }
        : null;
    })
    .filter((item): item is FinancialBridgeRow => item !== null);
  if (rows.length === 0) return null;
  return {
    period:
      typeof value.period === "string" ? value.period : "Latest reported totals",
    rows,
  };
};

export const providerNeutralText = (value: string): string =>
  value
    .replace(/(?:^|\s)This editorial profile is[^.]*\.(?:\s|$)/gi, " ")
    .replace(/(?:^|\s)This profile is[^.]*\b(?:fixture|demo|illustrative)[^.]*\.(?:\s|$)/gi, " ")
    .replace(/\bAInvest reports\b/gi, "Reported figures show")
    .replace(/\bAInvest\b/gi, "")
    .replace(/\bTradingView\b/gi, "chart")
    .replace(/\b(?:live|mixed|derived|demo|illustrative)\b/gi, "")
    .replace(/\b(?:local\s+)?fixture\b/gi, "")
    .replace(/\bmarket feed\b/gi, "market data")
    .replace(/\bsource(?:-native)?\b/gi, "data")
    .replace(/\bprovider\s+DCF\b/gi, "DCF")
    .replace(/\bprovider['’]s\s+model\b/gi, "valuation model")
    .replace(/\bprovider['’]s\b/gi, "data source's")
    .replace(/\bprovider\b/gi, "data source")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

export function normalizeSummary(
  payload: unknown,
  exchange: string,
  symbol: string,
): SecuritySummary {
  const raw = unwrap(payload);
  const missingSource: Provenance = "unknown";
  const resolvedExchange = typeof exchange === "string" && exchange.trim() ? exchange.trim().toUpperCase() : "";
  const resolvedSymbol = typeof symbol === "string" && symbol.trim() ? symbol.trim().toUpperCase() : "";
  const identityRaw = first(raw, ["identity"]) ?? raw;
  const quoteRaw = first(raw, ["quote"]) ?? raw;
  const valuationRaw = first(raw, ["valuation"]) ?? raw;
  const scoreRaw = first(raw, ["scores"]) ?? raw;
  const applicabilityRaw = first(raw, ["applicability"]);

  const price = numberMetric(
    quoteRaw,
    ["price", "last", "lastPrice", "currentPrice"],
    null,
    undefined,
    missingSource,
  );
  const dcfValue = {
    ...numberMetric(valuationRaw, ["dcfValue", "intrinsicValue"], null, undefined, missingSource),
    unit: "USD",
  };
  const earningsPowerFloor = {
    ...numberMetric(valuationRaw, ["earningsPowerFloor", "ownerEarningsValue"], null, undefined, missingSource),
    unit: "USD",
  };
  const earningsPowerMethod = normalizeEarningsPowerMethod(
    first(valuationRaw, ["earningsPowerMethod"]),
  );
  const peerValue = {
    ...numberMetric(
      valuationRaw,
      ["peerValue", "relativeValue", "multiplesValue"],
      null,
      undefined,
      missingSource,
    ),
    unit: "USD",
  };
  const fairValue = {
    ...numberMetric(
      valuationRaw,
      ["fairValue", "baseValue", "value"],
      null,
      undefined,
      missingSource,
    ),
    unit: "USD",
  };

  const annual = cleanPeriods(first(raw, ["financials.annual", "annualFinancials", "financials"]));
  const quarterly = cleanPeriods(first(raw, ["financials.quarterly", "quarterlyFinancials"]));

  const fundamentalsRaw = (first(raw, ["fundamentals"]) ?? raw) as unknown;
  const fundamentals: Record<string, Metric<number>> = {
    pe: numberMetric(fundamentalsRaw, ["pe", "priceEarnings", "peRatio"], null, "x", missingSource),
    pb: numberMetric(fundamentalsRaw, ["pb", "priceBook", "pbRatio"], null, "x", missingSource),
    ps: numberMetric(fundamentalsRaw, ["ps", "priceSales", "psRatio"], null, "x", missingSource),
    eps: { ...numberMetric(fundamentalsRaw, ["eps", "earningsPerShare"], null, undefined, missingSource), unit: "USD" },
    revenue: { ...numberMetric(fundamentalsRaw, ["revenue", "totalRevenue"], null, undefined, missingSource), unit: "USD" },
    netIncome: { ...numberMetric(fundamentalsRaw, ["netIncome", "income"], null, undefined, missingSource), unit: "USD" },
    freeCashFlow: { ...numberMetric(fundamentalsRaw, ["freeCashFlow", "fcf"], null, undefined, missingSource), unit: "USD" },
    debt: { ...numberMetric(fundamentalsRaw, ["debt", "totalDebt"], null, undefined, missingSource), unit: "USD" },
    cash: { ...numberMetric(fundamentalsRaw, ["cash", "cashAndEquivalents"], null, undefined, missingSource), unit: "USD" },
    sharesOutstanding: numberMetric(fundamentalsRaw, ["sharesOutstanding", "shares"], null, "shares", missingSource),
    roe: numberMetric(fundamentalsRaw, ["roe", "returnOnEquity"], null, "%", missingSource),
    revenueGrowth: numberMetric(fundamentalsRaw, ["revenueGrowth", "salesGrowth"], null, "%", missingSource),
    earningsGrowth: numberMetric(fundamentalsRaw, ["earningsGrowth", "epsGrowth"], null, "%", missingSource),
    dividendYield: numberMetric(fundamentalsRaw, ["dividendYield", "yield"], null, "%", missingSource),
  };

  const narrativeValue = first(raw, ["narrative", "analysis.narrative"]);
  const promptsValue = first(raw, ["researchPrompts", "prompts"]);
  const relatedValue = first(raw, ["related", "relatedStocks"]);

  return {
    applicability: {
      companyAnalysis:
        !isRecord(applicabilityRaw) || applicabilityRaw.companyAnalysis !== false,
      securityType:
        isRecord(applicabilityRaw) && typeof applicabilityRaw.securityType === "string"
          ? applicabilityRaw.securityType
          : "",
      reason:
        isRecord(applicabilityRaw) && typeof applicabilityRaw.reason === "string"
          ? applicabilityRaw.reason
          : null,
    },
    identity: {
      marketCode: String(first(identityRaw, ["marketCode", "market_code"]) ?? ""),
      exchange: (() => {
        const value = first(identityRaw, ["exchange"]);
        return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : resolvedExchange;
      })(),
      symbol: (() => {
        const value = first(identityRaw, ["symbol", "ticker"]);
        return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : resolvedSymbol;
      })(),
      company: stringMetric(identityRaw, ["company", "name", "companyName"], null, missingSource),
      description: stringMetric(identityRaw, ["description", "profile", "summary"], null, missingSource),
      sector: stringMetric(identityRaw, ["sector"], null, missingSource),
      industry: stringMetric(identityRaw, ["industry"], null, missingSource),
      country: stringMetric(identityRaw, ["country"], null, missingSource),
      currency: "USD",
    },
    quote: {
      price: { ...price, unit: price.unit ?? "USD" },
      changePercent: numberMetric(quoteRaw, ["changePercent", "change", "dailyChange"], null, "%", missingSource),
      marketCap: { ...numberMetric(quoteRaw, ["marketCap", "marketCapitalization"], null, undefined, missingSource), unit: "USD" },
      previousClose: { ...numberMetric(quoteRaw, ["previousClose", "prevClose"], null, undefined, missingSource), unit: "USD" },
      dayHigh: { ...numberMetric(quoteRaw, ["dayHigh", "high"], null, undefined, missingSource), unit: "USD" },
      dayLow: { ...numberMetric(quoteRaw, ["dayLow", "low"], null, undefined, missingSource), unit: "USD" },
    },
    valuation: {
      dcfValue,
      dcfModelPeriod:
        typeof first(valuationRaw, ["dcfModelPeriod"]) === "string"
          ? String(first(valuationRaw, ["dcfModelPeriod"]))
          : null,
      earningsPowerFloor,
      peerValue,
      fairValue,
      mispricing: numberMetric(valuationRaw, ["mispricing", "upside", "marginOfSafety"], null, "ratio", missingSource),
      earningsPowerMethod,
    },
    scores: {
      past: numberMetric(scoreRaw, ["past", "pastScore"], null, "score", missingSource),
      health: numberMetric(scoreRaw, ["health", "healthScore"], null, "score", missingSource),
      future: numberMetric(scoreRaw, ["future", "futureScore"], null, "score", missingSource),
    },
    fundamentals,
    financials: { annual, quarterly },
    derived: {
      netMargin: numberMetric(raw, ["derived.netMargin"], null, "ratio", missingSource),
      freeCashFlowMargin: numberMetric(raw, ["derived.freeCashFlowMargin"], null, "ratio", missingSource),
      cashFlowBridge: cleanFinancialBridge(first(raw, ["derived.cashFlowBridge"])),
    },
    capitalReturns: {
      dividends: numberMetric(raw, ["capitalReturns.dividends", "dividends"], null, undefined, missingSource),
      debtToEquity: numberMetric(raw, ["capitalReturns.debtToEquity", "debtToEquity"], null, "x", missingSource),
    },
    narrative: Array.isArray(narrativeValue)
      ? narrativeValue.filter((item): item is string => typeof item === "string").map(providerNeutralText).filter(Boolean)
      : [],
    researchPrompts: Array.isArray(promptsValue)
      ? promptsValue.filter((item): item is string => typeof item === "string").map(providerNeutralText).filter(Boolean)
      : [],
    related: Array.isArray(relatedValue)
      ? relatedValue
          .map((item) => {
            if (typeof item === "string") return { exchange, symbol: item };
            if (!isRecord(item)) return null;
            const relatedExchange = typeof item.exchange === "string" ? item.exchange : exchange;
            return typeof item.symbol === "string" ? { exchange: relatedExchange, symbol: item.symbol } : null;
          })
          .filter((item): item is { exchange: string; symbol: string } => item !== null)
      : [],
    dataMode: "live",
    asOf: typeof raw.asOf === "string" ? raw.asOf : null,
  };
}

function normalizeValuationCoverage(value: unknown): SeriesResponse["valuationCoverage"] {
  if (!isRecord(value)) return undefined;
  const marketPrice = isRecord(value.marketPrice) ? value.marketPrice : {};
  const providerDcf = isRecord(value.providerDcf) ? value.providerDcf : null;
  const stringOrNull = (candidate: unknown) => typeof candidate === "string" ? candidate : null;
  const integer = (candidate: unknown) => {
    const parsed = finiteNumber(candidate);
    return parsed != null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  };
  return {
    marketPrice: {
      startTime: stringOrNull(marketPrice.startTime), endTime: stringOrNull(marketPrice.endTime),
      pointCount: integer(marketPrice.pointCount), limited: marketPrice.limited === true,
    },
    providerDcf: providerDcf
      ? {
          startTime: stringOrNull(providerDcf.startTime),
          endTime: stringOrNull(providerDcf.endTime),
          pointCount: integer(providerDcf.pointCount) ?? 0,
          sourceAsOf: stringOrNull(providerDcf.sourceAsOf),
          includesFuturePeriod: providerDcf.includesFuturePeriod === true,
          isEstimateRevisionHistory: false,
        }
      : null,
  };
}

export function normalizeSeries(payload: unknown, symbol: string): SeriesResponse {
  const raw = unwrap(payload);
  const rawSeries = first(raw, ["series", "lines", "data"]);
  const series = Array.isArray(rawSeries)
    ? rawSeries
        .map((line, index) => {
          if (!isRecord(line)) return null;
          const rawPoints = line.points ?? line.values ?? [];
          if (!Array.isArray(rawPoints)) return null;
          const points = normalizeChartPoints(
            rawPoints.flatMap((point) => {
              if (Array.isArray(point) && point.length >= 2) {
                return [{ time: point[0], value: point[1] }];
              }
              if (!isRecord(point)) return [];
              return [{
                time: point.time ?? point.date ?? point.x,
                value: point.value ?? point.close ?? point.y,
              }];
            }),
          );
          return {
            id: String(line.id ?? line.key ?? `series-${index}`),
            label: providerNeutralText(String(line.label ?? line.name ?? line.id ?? `Series ${index + 1}`)),
            unit: typeof line.unit === "string" ? line.unit : undefined,
            points,
            seriesKind:
              line.seriesKind === "historical"
                ? "historical" as const
                : line.seriesKind === "model-period"
                    ? "model-period" as const
                : line.seriesKind === "reference-overlay" || line.seriesKind === "sparse-overlay"
                  ? "reference-overlay" as const
                  : undefined,
          };
        })
        .filter((line): line is NonNullable<typeof line> => line !== null)
    : [];

  return {
    symbol: String(raw.symbol ?? symbol).toUpperCase(),
    marketCode: typeof raw.marketCode === "string" ? raw.marketCode : undefined,
    group: typeof raw.group === "string" ? raw.group : "",
    range: typeof raw.range === "string" ? raw.range : "",
    series,
    source: provenance(raw.source, "unknown"),
    asOf: typeof raw.asOf === "string" ? raw.asOf : null,
    oldestTime: typeof raw.oldestTime === "string" ? raw.oldestTime : null,
    newestTime: typeof raw.newestTime === "string" ? raw.newestTime : null,
    hasMore: raw.hasMore === true,
    nextCursor: finiteNumber(raw.nextCursor),
    before: finiteNumber(raw.before),
    valuationCoverage: normalizeValuationCoverage(raw.valuationCoverage),
  };
}

export function normalizePeers(payload: unknown, symbol: string): PeersResponse {
  const raw = unwrap(payload);
  const peersRaw = first(raw, ["peers", "rows", "items"]);
  const peers = Array.isArray(peersRaw)
    ? peersRaw
        .map((item) => {
          if (!isRecord(item)) return null;
          const peerSymbol = String(item.symbol ?? item.ticker ?? "");
          if (!peerSymbol) return null;
          const companyRaw = item.company;
          const company = isRecord(companyRaw) ? companyRaw.value : companyRaw;
          return {
            marketCode: typeof item.marketCode === "string" ? item.marketCode : undefined,
            symbol: peerSymbol,
            company:
              typeof company === "string" && company.trim()
                ? company.trim()
                : typeof item.name === "string" && item.name.trim()
                  ? item.name.trim()
                  : "",
            price: finiteNumber(isRecord(item.price) ? item.price.value : item.price),
            marketCap: finiteNumber(isRecord(item.marketCap) ? item.marketCap.value : item.marketCap),
            pe: finiteNumber(isRecord(item.pe) ? item.pe.value : item.pe),
            pb: finiteNumber(isRecord(item.pb) ? item.pb.value : item.pb),
            ps: finiteNumber(isRecord(item.ps) ? item.ps.value : item.ps),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    : [];

  const mediansRaw = isRecord(raw.medians) ? raw.medians : {};
  const medianNumber = (value: unknown) =>
    finiteNumber(isRecord(value) && "value" in value ? value.value : value);
  return {
    symbol: String(raw.symbol ?? symbol).toUpperCase(),
    marketCode: typeof raw.marketCode === "string" ? raw.marketCode : undefined,
    peers,
    medians: {
      pe: medianNumber(mediansRaw.pe),
      pb: medianNumber(mediansRaw.pb),
      ps: medianNumber(mediansRaw.ps),
    },
    peerValue: asMetric<number>(raw.peerValue, null, "derived"),
    selectionReason:
      typeof raw.selectionReason === "string" ? providerNeutralText(raw.selectionReason) : undefined,
    source: provenance(raw.source, "unknown"),
    asOf: typeof raw.asOf === "string" ? raw.asOf : null,
  };
}
