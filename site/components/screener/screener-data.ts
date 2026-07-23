import type {
  ColumnKey,
  DataSource,
  Metric,
  ScanState,
  ScreenerFilter,
  ScreenerStock,
} from "./types";

type UnknownRecord = Record<string, unknown>;

export const FILTER_LIBRARY: ScreenerFilter[] = [
  {
    id: "exclude-microcaps",
    category: "Universe",
    label: "Exclude companies below $2B market cap",
    shortLabel: "No micro-caps",
    field: "marketCap",
    operator: "gte",
    value: 2_000_000_000,
  },
  {
    id: "large-cap",
    category: "Universe",
    label: "Only companies worth at least $10B",
    shortLabel: "Large-cap · $10B+",
    field: "marketCap",
    operator: "gte",
    value: 10_000_000_000,
  },
  {
    id: "mega-cap",
    category: "Universe",
    label: "Only companies worth at least $200B",
    shortLabel: "Mega-cap · $200B+",
    field: "marketCap",
    operator: "gte",
    value: 200_000_000_000,
  },
  {
    id: "us-major",
    category: "Universe",
    label: "Only US major exchanges (NYSE, NASDAQ)",
    shortLabel: "US major exchanges",
    field: "exchange",
    operator: "in",
    value: ["NASDAQ", "NYSE"],
  },
  {
    id: "technology",
    category: "Universe",
    label: "Narrow the universe to technology",
    shortLabel: "Technology",
    field: "sector",
    operator: "eq",
    value: "Technology",
  },
  {
    id: "intrinsic-fair",
    category: "Valuation",
    label: "Intrinsic value is at least the current price",
    shortLabel: "Fair value ≥ price",
    field: "fairValueToPrice",
    operator: "gte",
    value: 1,
  },
  {
    id: "margin-10",
    category: "Valuation",
    label: "Intrinsic value is at least 10% above price",
    shortLabel: "Margin of safety ≥ 10%",
    field: "mispricing",
    operator: "gte",
    value: 0.1,
  },
  {
    id: "price-under-50",
    category: "Valuation",
    label: "Last price is below $50",
    shortLabel: "Price below $50",
    field: "price",
    operator: "lte",
    value: 50,
  },
  {
    id: "pe-below-15",
    category: "Valuation",
    label: "Price-to-earnings ratio is below 15",
    shortLabel: "P/E below 15",
    field: "pe",
    operator: "lt",
    value: 15,
  },
  {
    id: "up-today",
    category: "Momentum",
    label: "Price change is positive today",
    shortLabel: "Up today",
    field: "changePercent",
    operator: "gte",
    value: 0,
  },
  {
    id: "down-today",
    category: "Momentum",
    label: "Price change is negative today",
    shortLabel: "Down today",
    field: "changePercent",
    operator: "lte",
    value: 0,
  },
  {
    id: "positive-earnings",
    category: "Quality",
    label: "Only companies with positive earnings",
    shortLabel: "Positive earnings",
    field: "netIncome",
    operator: "gt",
    value: 0,
  },
  {
    id: "positive-fcf",
    category: "Quality",
    label: "Only companies with positive free cash flow",
    shortLabel: "Positive free cash flow",
    field: "freeCashFlow",
    operator: "gt",
    value: 0,
  },
  {
    id: "low-debt",
    category: "Quality",
    label: "Debt-to-equity is below 50%",
    shortLabel: "Low debt",
    field: "debtToEquity",
    operator: "lte",
    value: 0.5,
  },
  {
    id: "stable-margins",
    category: "Quality",
    label: "Operating margins stayed consistent for five years",
    shortLabel: "Stable margins",
    field: "marginStability5Y",
    operator: "eq",
    value: true,
    available: false,
    unavailableReason: "Historical margin consistency isn’t supported yet.",
  },
  {
    id: "revenue-growth",
    category: "Growth",
    label: "Revenue growth is at least 10%",
    shortLabel: "Revenue growth ≥ 10%",
    field: "revenueGrowth",
    operator: "gte",
    value: 0.1,
  },
  {
    id: "growing-margins",
    category: "Growth",
    label: "Operating margins are expanding",
    shortLabel: "Growing margins",
    field: "marginTrend",
    operator: "gt",
    value: 0,
    available: false,
    unavailableReason: "Margin-trend filtering isn’t supported yet.",
  },
];

export const DEFAULT_FILTERS = [
  FILTER_LIBRARY.find((filter) => filter.id === "intrinsic-fair")!,
];

export const COLUMN_OPTIONS: Array<{
  key: ColumnKey;
  label: string;
  description: string;
}> = [
  { key: "price", label: "Last price", description: "Latest available market price" },
  { key: "changePercent", label: "Price change", description: "Change in the latest session" },
  { key: "marketCap", label: "Market cap", description: "Equity value in USD" },
  { key: "fairValue", label: "Fair value", description: "Base-case intrinsic value" },
  { key: "mispricing", label: "Mispricing", description: "Distance from base-case value" },
  { key: "pe", label: "P/E", description: "Price relative to earnings" },
  { key: "revenueGrowth", label: "Revenue growth", description: "Most recent growth rate" },
];

export const DEFAULT_COLUMNS: ColumnKey[] = [
  "price",
  "changePercent",
  "marketCap",
  "mispricing",
];

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstDefined(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[$,%\s]/g, "").replace(/,/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function toStringValue(value: unknown, fallback = "") {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (isRecord(value) && "value" in value) return toStringValue(value.value, fallback);
  return fallback;
}

function metric(
  raw: unknown,
  fallbackSource: DataSource,
  fallbackAsOf: string | null,
  fallbackUnit?: string,
): Metric<number> {
  if (isRecord(raw) && "value" in raw) {
    const source = raw.source;
    return {
      value: toNumber(raw.value),
      source: source === "live" || source === "derived" ? source : fallbackSource,
      asOf: typeof raw.asOf === "string" ? raw.asOf : fallbackAsOf,
      unit: typeof raw.unit === "string" ? raw.unit : fallbackUnit,
      reason: typeof raw.reason === "string" ? raw.reason : undefined,
    };
  }
  return { value: toNumber(raw), source: fallbackSource, asOf: fallbackAsOf, unit: fallbackUnit };
}

function normalizeRow(raw: unknown, fallbackSource: DataSource, asOf: string | null): ScreenerStock | null {
  if (!isRecord(raw)) return null;
  const marketCode = toStringValue(firstDefined(raw.marketCode, raw.market_code, raw.code));
  const symbol = toStringValue(firstDefined(raw.symbol, raw.ticker, raw.stockCode, raw.securityCode));
  if (!symbol && !marketCode) return null;
  const resolvedSymbol = symbol || marketCode.split(/[.:]/).at(-1) || marketCode;
  const exchange = toStringValue(firstDefined(raw.exchange, raw.market, raw.exchangeCode), "NASDAQ");
  const rowAsOf = toStringValue(raw.asOf, asOf || "") || asOf;
  const price = metric(firstDefined(raw.price, raw.lastPrice, raw.last_price, raw["10"]), fallbackSource, rowAsOf, "currency");
  const fairValue = metric(
    firstDefined(raw.fairValue, raw.intrinsicValue, raw.dcfValue, raw.stockdiag_fundamental_value_dcf),
    fallbackSource,
    rowAsOf,
    "currency",
  );
  return {
    marketCode,
    exchange,
    symbol: resolvedSymbol.toUpperCase(),
    company: toStringValue(firstDefined(raw.company, raw.name, raw.companyName, raw["55"]), resolvedSymbol.toUpperCase()),
    currency: toStringValue(firstDefined(raw.currency, raw.currencyCode), "USD"),
    price,
    changePercent: metric(
      firstDefined(raw.changePercent, raw.priceChange, raw.change, raw.price_change_ratio_pct),
      fallbackSource,
      rowAsOf,
      "%",
    ),
    marketCap: metric(firstDefined(raw.marketCap, raw.market_cap, raw.total_market_value), fallbackSource, rowAsOf, "USD"),
    fairValue,
    mispricing: metric(
      firstDefined(raw.mispricing, raw.upside, raw.discount),
      fallbackSource,
      rowAsOf,
      "ratio",
    ),
    pe: metric(firstDefined(raw.pe, raw.priceToEarnings, raw.peRatio), fallbackSource, rowAsOf, "x"),
    revenueGrowth: metric(firstDefined(raw.revenueGrowth, raw.revenue_growth), fallbackSource, rowAsOf, "ratio"),
  };
}

function getNestedRecord(root: UnknownRecord, key: string): UnknownRecord | undefined {
  return isRecord(root[key]) ? root[key] : undefined;
}

function findRows(payload: UnknownRecord): unknown[] {
  const dataRecord = getNestedRecord(payload, "data");
  const candidates = [
    Array.isArray(payload.data) ? payload.data : undefined,
    payload.rows,
    payload.items,
    Array.isArray(payload.results) ? payload.results : undefined,
    dataRecord?.rows,
    dataRecord?.items,
    Array.isArray(dataRecord?.results) ? dataRecord?.results : undefined,
    Array.isArray(dataRecord?.data) ? dataRecord?.data : undefined,
  ];
  return (candidates.find(Array.isArray) as unknown[] | undefined) ?? [];
}

function scanFromPayload(payload: UnknownRecord, httpStatus: number): ScanState | null {
  const scan = getNestedRecord(payload, "scan") ?? getNestedRecord(payload, "valuationScan");
  if (!scan && httpStatus !== 202) return null;
  const progress = scan && isRecord(scan.progress) ? scan.progress : undefined;
  const scanned = toNumber(firstDefined(scan?.scanned, scan?.completed, progress?.scanned, progress?.completed)) ?? 0;
  const total = toNumber(firstDefined(scan?.total, progress?.total)) ?? 0;
  const rawState = toStringValue(scan?.state, httpStatus === 202 ? "warming" : "idle");
  const state: ScanState["state"] =
    rawState === "ready" || rawState === "error" || rawState === "idle" ? rawState : "warming";
  return {
    state,
    scanned,
    total,
    message: toStringValue(firstDefined(scan?.message, scan?.error, payload.message)) || undefined,
  };
}

export function normalizeScreenerPayload(payload: unknown, httpStatus: number) {
  const body: UnknownRecord = isRecord(payload) ? payload : {};
  const sourceValue = toStringValue(firstDefined(body.source, body.mode, body.dataMode));
  const fallbackSource: DataSource = sourceValue === "derived" ? "derived" : "live";
  const asOf = toStringValue(body.asOf) || null;
  const rows = findRows(body)
    .map((row) => normalizeRow(row, fallbackSource, asOf))
    .filter((row): row is ScreenerStock => row !== null);
  const pageRecord = getNestedRecord(body, "page") ?? getNestedRecord(body, "pagination") ?? {};
  const parsedTotal = toNumber(firstDefined(pageRecord.total, body.total, body.totalCount, body.count));
  const totalKnown = parsedTotal !== null;
  const total = parsedTotal ?? rows.length;
  const page = toNumber(firstDefined(pageRecord.page, pageRecord.current, body.currentPage)) ?? 1;
  const pageSize = toNumber(firstDefined(pageRecord.pageSize, pageRecord.limit, body.pageSize)) ?? Math.max(rows.length, 20);
  const totalPages =
    toNumber(firstDefined(pageRecord.totalPages, pageRecord.pages, body.totalPages)) ??
    Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  return {
    rows,
    total,
    totalKnown,
    page,
    pageSize,
    totalPages,
    status: toStringValue(body.status, httpStatus === 202 ? "warming" : "ready"),
    message: toStringValue(body.message) || undefined,
    scan: scanFromPayload(body, httpStatus),
    asOf,
  };
}
