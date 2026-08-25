import type {
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
  value === "live" || value === "derived"
    ? value
    : missingSource;

export const asMetric = <T extends number | string>(
  value: unknown,
  missingValue: T | null,
  source: Provenance = "derived",
  unit?: string,
): Metric<T> => {
  const expectsNumber = typeof missingValue === "number" || unit !== undefined;
  if (isRecord(value) && "value" in value) {
    const inner = value.value;
    const parsed =
      expectsNumber
        ? finiteNumber(inner)
        : typeof inner === "string"
          ? inner
          : null;
    return {
      value: parsed as T | null,
      source: provenance(value.source, source),
      asOf: typeof value.asOf === "string" ? value.asOf : null,
      unit: typeof value.unit === "string" ? value.unit : unit,
      reason: typeof value.reason === "string" ? value.reason : undefined,
    };
  }

  const parsed =
    expectsNumber
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
) => asMetric<number>(first(raw, paths), missingValue, source, unit);

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
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

export function normalizeSummary(
  payload: unknown,
  exchange: string,
  symbol: string,
): SecuritySummary {
  const raw = unwrap(payload);
  const missingSource: Provenance = "derived";
  const identityRaw = first(raw, ["identity"]) ?? raw;
  const quoteRaw = first(raw, ["quote"]) ?? raw;
  const valuationRaw = first(raw, ["valuation"]) ?? raw;
  const scoreRaw = first(raw, ["scores"]) ?? raw;
  const applicabilityRaw = first(raw, ["applicability"]);

  const price = numberMetric(
    quoteRaw,
    ["price", "last", "lastPrice", "currentPrice"],
    null,
    "USD",
    missingSource,
  );
  const dcfValue = numberMetric(
    valuationRaw,
    ["dcfValue", "dcf", "intrinsicValue"],
    null,
    "USD",
    missingSource,
  );
  const peerValue = numberMetric(
    valuationRaw,
    ["peerValue", "relativeValue", "multiplesValue"],
    null,
    "USD",
    missingSource,
  );
  const fairValue = numberMetric(
    valuationRaw,
    ["fairValue", "baseValue", "value"],
    null,
    "USD",
    missingSource,
  );

  const annual = cleanPeriods(first(raw, ["financials.annual", "annualFinancials", "financials"]));
  const quarterly = cleanPeriods(first(raw, ["financials.quarterly", "quarterlyFinancials"]));

  const fundamentalsRaw = (first(raw, ["fundamentals"]) ?? raw) as unknown;
  const fundamentals: Record<string, Metric<number>> = {
    pe: numberMetric(fundamentalsRaw, ["pe", "priceEarnings", "peRatio"], null, "x", missingSource),
    pb: numberMetric(fundamentalsRaw, ["pb", "priceBook", "pbRatio"], null, "x", missingSource),
    ps: numberMetric(fundamentalsRaw, ["ps", "priceSales", "psRatio"], null, "x", missingSource),
    eps: numberMetric(fundamentalsRaw, ["eps", "earningsPerShare"], null, "USD", missingSource),
    revenue: numberMetric(fundamentalsRaw, ["revenue", "totalRevenue"], null, "USD", missingSource),
    netIncome: numberMetric(fundamentalsRaw, ["netIncome", "income"], null, "USD", missingSource),
    freeCashFlow: numberMetric(fundamentalsRaw, ["freeCashFlow", "fcf"], null, "USD", missingSource),
    debt: numberMetric(fundamentalsRaw, ["debt", "totalDebt"], null, "USD", missingSource),
    cash: numberMetric(fundamentalsRaw, ["cash", "cashAndEquivalents"], null, "USD", missingSource),
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
        !isRecord(applicabilityRaw) ||
        applicabilityRaw.companyAnalysis !== false,
      securityType:
        isRecord(applicabilityRaw) &&
        typeof applicabilityRaw.securityType === "string"
          ? applicabilityRaw.securityType
          : "",
      reason:
        isRecord(applicabilityRaw) &&
        typeof applicabilityRaw.reason === "string"
          ? applicabilityRaw.reason
          : null,
    },
    identity: {
      marketCode: String(first(identityRaw, ["marketCode", "market_code"]) ?? ""),
      exchange: String(first(identityRaw, ["exchange"]) ?? exchange).toUpperCase(),
      symbol: String(first(identityRaw, ["symbol", "ticker"]) ?? symbol).toUpperCase(),
      company: stringMetric(identityRaw, ["company", "name", "companyName"], symbol.toUpperCase(), missingSource),
      description: stringMetric(identityRaw, ["description", "profile", "summary"], null, missingSource),
      sector: stringMetric(identityRaw, ["sector"], null, missingSource),
      industry: stringMetric(identityRaw, ["industry"], null, missingSource),
      country: stringMetric(identityRaw, ["country"], null, missingSource),
      currency: String(first(identityRaw, ["currency"]) ?? "USD"),
    },
    quote: {
      price,
      changePercent: numberMetric(quoteRaw, ["changePercent", "change", "dailyChange"], null, "%", missingSource),
      marketCap: numberMetric(quoteRaw, ["marketCap", "marketCapitalization"], null, "USD", missingSource),
      previousClose: numberMetric(quoteRaw, ["previousClose", "prevClose"], null, "USD", missingSource),
      dayHigh: numberMetric(quoteRaw, ["dayHigh", "high"], null, "USD", missingSource),
      dayLow: numberMetric(quoteRaw, ["dayLow", "low"], null, "USD", missingSource),
    },
    valuation: {
      dcfValue,
      peerValue,
      fairValue,
      mispricing: numberMetric(valuationRaw, ["mispricing", "upside", "marginOfSafety"], null, "ratio", missingSource),
    },
    scores: {
      past: numberMetric(scoreRaw, ["past", "pastScore"], null, "score", missingSource),
      health: numberMetric(scoreRaw, ["health", "healthScore"], null, "score", missingSource),
      future: numberMetric(scoreRaw, ["future", "futureScore"], null, "score", missingSource),
    },
    fundamentals,
    financials: {
      annual,
      quarterly,
    },
    derived: {
      netMargin: numberMetric(
        raw,
        ["derived.netMargin"],
        null,
        "ratio",
        missingSource,
      ),
      freeCashFlowMargin: numberMetric(
        raw,
        ["derived.freeCashFlowMargin"],
        null,
        "ratio",
        missingSource,
      ),
      cashFlowBridge: cleanFinancialBridge(
        first(raw, ["derived.cashFlowBridge"]),
      ),
    },
    capitalReturns: {
      dividends: numberMetric(raw, ["capitalReturns.dividends", "dividends"], null, "USD", missingSource),
      debtToEquity: numberMetric(raw, ["capitalReturns.debtToEquity", "debtToEquity"], null, "x", missingSource),
    },
    narrative: Array.isArray(narrativeValue)
      ? narrativeValue
          .filter((item): item is string => typeof item === "string")
          .map(providerNeutralText)
          .filter(Boolean)
      : [],
    researchPrompts: Array.isArray(promptsValue)
      ? promptsValue
          .filter((item): item is string => typeof item === "string")
          .map(providerNeutralText)
          .filter(Boolean)
      : [],
    related: Array.isArray(relatedValue)
      ? relatedValue
          .map((item) => {
            if (typeof item === "string") {
              return { exchange, symbol: item };
            }
            if (!isRecord(item)) return null;
            const relatedExchange =
              typeof item.exchange === "string" ? item.exchange : exchange;
            return typeof item.symbol === "string"
              ? { exchange: relatedExchange, symbol: item.symbol }
              : null;
          })
          .filter(
            (item): item is { exchange: string; symbol: string } => item !== null,
          )
      : [],
    dataMode: "live",
    asOf: typeof raw.asOf === "string" ? raw.asOf : price.asOf,
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
          const points = rawPoints
            .map((point) => {
              if (Array.isArray(point) && point.length >= 2) {
                const value = finiteNumber(point[1]);
                return value === null ? null : { time: String(point[0]), value };
              }
              if (!isRecord(point)) return null;
              const value = finiteNumber(point.value ?? point.close ?? point.y);
              const time = point.time ?? point.date ?? point.x;
              return value === null || time === undefined ? null : { time: String(time), value };
            })
            .filter((point): point is { time: string; value: number } => point !== null);
          return {
            id: String(line.id ?? line.key ?? `series-${index}`),
            label: providerNeutralText(String(line.label ?? line.name ?? line.id ?? `Series ${index + 1}`)),
            unit: typeof line.unit === "string" ? line.unit : undefined,
            points,
          };
        })
        .filter((line): line is NonNullable<typeof line> => line !== null)
    : [];

  return {
    symbol: String(raw.symbol ?? symbol).toUpperCase(),
    marketCode: typeof raw.marketCode === "string" ? raw.marketCode : undefined,
    group: String(raw.group ?? "valuation"),
    range: String(raw.range ?? "10y"),
    series,
    source: provenance(raw.source, "derived"),
    asOf: typeof raw.asOf === "string" ? raw.asOf : null,
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
            company: String(company ?? item.name ?? peerSymbol),
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
    peerValue: asMetric<number>(raw.peerValue, null, "derived", "USD"),
    selectionReason:
      typeof raw.selectionReason === "string"
        ? providerNeutralText(raw.selectionReason)
        : undefined,
    source: provenance(raw.source, "derived"),
    asOf: typeof raw.asOf === "string" ? raw.asOf : null,
  };
}
