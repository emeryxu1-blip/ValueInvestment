import type {
  ColumnKey,
  DataSource,
  Metric,
  ScanState,
  ScreenerFilter,
  ScreenerStock,
  SortOrder,
} from "./types";
import {
  matchesScreenerFilterMask,
  SCREENER_FILTER_MASK_ALL_BITS,
  SCREENER_FILTER_MASK_LEGACY_SCHEMA_VERSION,
  SCREENER_FILTER_MASK_V1_ALL_BITS,
  SCREENER_FILTER_MASK_V2_ALL_BITS,
  selectedScreenerFilterMask,
} from "../../lib/screener/filter-presets.ts";
import {
  MAX_SCREENER_CLIENT_SNAPSHOT_ROWS,
  SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION,
} from "../../lib/screener/client-snapshot-contract.ts";

export {
  SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION,
} from "../../lib/screener/client-snapshot-contract.ts";

type UnknownRecord = Record<string, unknown>;

export const TOP_1000_UNIVERSE_FILTER_ID = "top-market-cap-1000";
export const US_MAJOR_EXCHANGES_FILTER_ID = "us-major";

const REQUIRED_UNIVERSE_FILTER_IDS = new Set([
  TOP_1000_UNIVERSE_FILTER_ID,
  US_MAJOR_EXCHANGES_FILTER_ID,
]);

export const FILTER_LIBRARY: ScreenerFilter[] = [
  {
    id: TOP_1000_UNIVERSE_FILTER_ID,
    category: "Universe",
    label: "Largest companies",
    shortLabel: "Market-cap rank ≤ 1,000",
    field: "universe",
    operator: "eq",
    value: TOP_1000_UNIVERSE_FILTER_ID,
  },
  {
    id: US_MAJOR_EXCHANGES_FILTER_ID,
    category: "Universe",
    label: "Major U.S. exchanges",
    shortLabel: "Exchange ∈ {NYSE, NASDAQ}",
    field: "exchange",
    operator: "in",
    value: ["NASDAQ", "NYSE"],
  },
  {
    id: "technology",
    category: "Universe",
    label: "Technology companies",
    shortLabel: "Sector contains Technology",
    field: "sector",
    operator: "eq",
    value: "Technology",
  },
  {
    id: "intrinsic-fair",
    category: "Valuation",
    label: "Provider DCF at least matches price",
    shortLabel: "Positive provider DCF ÷ positive price ≥ 1.0×",
    field: "fairValueToPrice",
    operator: "gte",
    value: 1,
  },
  {
    id: "margin-20",
    category: "Valuation",
    label: "Meaningful provider value gap",
    shortLabel: "Provider DCF ÷ positive price − 1 ≥ 20%",
    minimumSnapshotSchemaVersion: 3,
    field: "mispricing",
    operator: "gte",
    value: 0.2,
  },
  {
    id: "pe-positive-15",
    category: "Valuation",
    label: "Profitable at a low multiple",
    shortLabel: "0 < P/E ≤ 15×",
    minimumSnapshotSchemaVersion: 3,
    field: "pe",
    operator: "lte",
    value: 15,
  },
  {
    id: "fcf-yield-5",
    category: "Valuation",
    label: "Strong cash-flow yield",
    shortLabel: "TTM FCF ÷ market cap ≥ 5%",
    minimumSnapshotSchemaVersion: 3,
    field: "freeCashFlowYield",
    operator: "gte",
    value: 0.05,
  },
  {
    id: "ev-ebitda-below-10",
    category: "Valuation",
    label: "Low enterprise-value multiple",
    shortLabel: "0 < EV ÷ TTM EBITDA ≤ 10×",
    minimumSnapshotSchemaVersion: 2,
    field: "evToEbitda",
    operator: "lte",
    value: 10,
  },
  {
    id: "positive-earnings",
    category: "Quality",
    label: "Profitable business",
    shortLabel: "TTM net income > 0",
    field: "netIncome",
    operator: "gt",
    value: 0,
  },
  {
    id: "positive-fcf",
    category: "Quality",
    label: "Positive cash generation",
    shortLabel: "TTM FCF > 0",
    field: "freeCashFlow",
    operator: "gt",
    value: 0,
  },
  {
    id: "cash-conversion-80",
    category: "Quality",
    label: "Earnings convert into cash",
    shortLabel: "Positive TTM FCF ÷ positive TTM net income ≥ 80%",
    minimumSnapshotSchemaVersion: 2,
    field: "cashConversion",
    operator: "gte",
    value: 0.8,
  },
  {
    id: "roic-15",
    category: "Quality",
    label: "High returns on capital",
    shortLabel: "ROIC ≥ 15%",
    minimumSnapshotSchemaVersion: 2,
    field: "returnOnInvestedCapital",
    operator: "gte",
    value: 0.15,
  },
  {
    id: "net-debt-fcf-1-5",
    category: "Quality",
    label: "Debt covered by cash flow",
    shortLabel: "Net debt ÷ positive TTM FCF ≤ 1.5×",
    minimumSnapshotSchemaVersion: 2,
    field: "netDebtToFreeCashFlow",
    operator: "lte",
    value: 1.5,
  },
  {
    id: "stable-margins",
    category: "Quality",
    label: "Stable operating profitability",
    shortLabel: "5Y operating-margin range ≤ 5 pp",
    field: "marginStability5Y",
    operator: "eq",
    value: true,
  },
  {
    id: "revenue-growth",
    category: "Growth",
    label: "Revenue growing",
    shortLabel: "TTM revenue growth ≥ 10%",
    field: "revenueGrowth",
    operator: "gte",
    value: 0.1,
  },
  {
    id: "growing-margins",
    category: "Growth",
    label: "Operating margins improving",
    shortLabel: "5Y margin slope > 0; latest > oldest",
    field: "marginTrend",
    operator: "gt",
    value: 0,
  },
];

const REQUIRED_UNIVERSE_FILTERS = FILTER_LIBRARY.filter((filter) =>
  REQUIRED_UNIVERSE_FILTER_IDS.has(filter.id),
);
const FILTER_LIBRARY_BY_ID = new Map(
  FILTER_LIBRARY.map((filter) => [filter.id, filter]),
);
const FILTER_ID_ALIASES = new Map([
  ["margin-10", "margin-20"],
  ["pe-below-15", "pe-positive-15"],
  ["fcf-yield-4", "fcf-yield-5"],
]);

export function isRequiredUniverseFilter(filterId: string) {
  return REQUIRED_UNIVERSE_FILTER_IDS.has(filterId);
}

export function withRequiredUniverseFilters(
  filters?: readonly ScreenerFilter[],
): ScreenerFilter[];
export function withRequiredUniverseFilters(filters: unknown = []): ScreenerFilter[] {
  const seen = new Set(REQUIRED_UNIVERSE_FILTER_IDS);
  const candidates = Array.isArray(filters) ? filters : [];
  const supported = candidates.flatMap((filter) => {
    if (
      !filter ||
      typeof filter !== "object" ||
      !("id" in filter) ||
      typeof filter.id !== "string"
    ) {
      return [];
    }
    const canonical = FILTER_LIBRARY_BY_ID.get(
      FILTER_ID_ALIASES.get(filter.id) ?? filter.id,
    );
    if (!canonical || seen.has(canonical.id)) return [];
    seen.add(canonical.id);
    return [canonical];
  });
  return [
    ...REQUIRED_UNIVERSE_FILTERS,
    ...supported,
  ];
}

export function isFilterSupportedBySnapshot(
  filter: ScreenerFilter,
  schemaVersion: number | null,
): boolean {
  const effectiveSchemaVersion =
    schemaVersion ?? SCREENER_FILTER_MASK_LEGACY_SCHEMA_VERSION;
  return (
    filter.minimumSnapshotSchemaVersion == null ||
    effectiveSchemaVersion >= filter.minimumSnapshotSchemaVersion
  );
}

export function normalizeFilterSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/(?:≥|>=)/g, " gte ")
    .replace(/(?:≤|<=)/g, " lte ")
    .replace(/∈/g, " in ")
    .replace(/>/g, " gt ")
    .replace(/</g, " lt ")
    .replace(/×/g, " x ")
    .replace(/[/÷]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function expandFinanceSearchTerms(value: string): string {
  const additions: string[] = [];
  if (/\bfcf\b/.test(value)) additions.push("free cash flow");
  if (/\bfree cash flow\b/.test(value)) additions.push("fcf");
  if (/\b(?:p e|pe)\b/.test(value)) {
    additions.push("price earnings price to earnings");
  }
  if (/\bprice (?:to )?earnings\b/.test(value)) additions.push("p e pe");
  if (/\bev\b/.test(value)) additions.push("enterprise value");
  if (/\benterprise value\b/.test(value)) additions.push("ev");
  if (/\bebitda\b/.test(value)) {
    additions.push("earnings before interest taxes depreciation amortization");
  }
  if (/\bearnings before interest taxes depreciation amortization\b/.test(value)) {
    additions.push("ebitda");
  }
  if (/\broic\b/.test(value)) additions.push("return on invested capital");
  if (/\breturn on invested capital\b/.test(value)) additions.push("roic");
  return `${value} ${additions.join(" ")}`.trim();
}

export function filterMatchesSearch(
  filter: Pick<ScreenerFilter, "category" | "label" | "shortLabel">,
  query: string,
): boolean {
  const normalizedQuery = expandFinanceSearchTerms(
    normalizeFilterSearchText(query),
  );
  if (!normalizedQuery) return true;
  const normalizedFilter = expandFinanceSearchTerms(
    normalizeFilterSearchText(
      `${filter.label} ${filter.shortLabel} ${filter.category}`,
    ),
  );
  const searchable = `${normalizedFilter} ${normalizedFilter.replaceAll(" ", "")}`;
  return normalizedQuery
    .split(" ")
    .every((token) => searchable.includes(token));
}

export function withSnapshotCompatibleFilters(
  filters: readonly ScreenerFilter[],
  schemaVersion: number | null,
): ScreenerFilter[] {
  return withRequiredUniverseFilters(filters).filter((filter) =>
    isFilterSupportedBySnapshot(filter, schemaVersion),
  );
}

export const DEFAULT_FILTERS = withRequiredUniverseFilters([
  FILTER_LIBRARY.find((filter) => filter.id === "intrinsic-fair")!,
]);

export const COLUMN_OPTIONS: Array<{
  key: ColumnKey;
  label: string;
  description: string;
}> = [
  { key: "price", label: "Last price", description: "Latest available market price" },
  { key: "changePercent", label: "Price change", description: "Change in the latest stored session" },
  { key: "marketCap", label: "Market cap", description: "Equity value in USD" },
  { key: "fairValue", label: "Provider DCF", description: "Positive value at the latest date in the provider DCF series; no peer fallback" },
  { key: "mispricing", label: "Value gap", description: "Provider DCF divided by stored price, minus one" },
  { key: "pe", label: "P/E", description: "Provider trailing-twelve-month price-to-earnings multiple" },
  { key: "revenueGrowth", label: "Revenue growth", description: "Provider trailing-twelve-month year-over-year growth" },
];

export const DEFAULT_COLUMNS: ColumnKey[] = [
  "price",
  "changePercent",
  "marketCap",
  "mispricing",
];

const CLIENT_SORTABLE_COLUMNS = new Set<ColumnKey>([
  "price",
  "changePercent",
  "marketCap",
  "fairValue",
  "mispricing",
  "pe",
  "revenueGrowth",
]);

export function filterScreenerStocks(
  rows: readonly ScreenerStock[],
  filters: readonly ScreenerFilter[],
): ScreenerStock[] {
  const selectedMask = selectedScreenerFilterMask(
    filters.map((filter) => filter.id),
  );
  return rows.filter((row) =>
    matchesScreenerFilterMask(row.filterMask, selectedMask),
  );
}

function comparableStockValue(
  stock: ScreenerStock,
  sortKey: string,
): string | number | null {
  if (sortKey === "symbol") return stock.symbol;
  if (sortKey === "company") return stock.company;
  if (CLIENT_SORTABLE_COLUMNS.has(sortKey as ColumnKey)) {
    return stock[sortKey as ColumnKey].value;
  }
  return stock.company;
}

export function sortScreenerStocks(
  rows: readonly ScreenerStock[],
  sortKey: string,
  sortOrder: SortOrder,
): ScreenerStock[] {
  const direction = sortOrder === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = comparableStockValue(left, sortKey);
    const b = comparableStockValue(right, sortKey);
    if (a === null && b === null) {
      return left.symbol.localeCompare(right.symbol);
    }
    if (a === null) return 1;
    if (b === null) return -1;
    return (
      (typeof a === "string" && typeof b === "string"
        ? a.localeCompare(b)
        : Number(a) - Number(b)) * direction
    );
  });
}

export function deriveScreenerView(options: {
  rows: readonly ScreenerStock[];
  filters: readonly ScreenerFilter[];
  sortKey: string;
  sortOrder: SortOrder;
  page: number;
  pageSize: number;
}) {
  const filtered = filterScreenerStocks(options.rows, options.filters);
  const sorted = sortScreenerStocks(
    filtered,
    options.sortKey,
    options.sortOrder,
  );
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / options.pageSize));
  const page = Math.min(Math.max(1, options.page), totalPages);
  const offset = (page - 1) * options.pageSize;
  return {
    rows: sorted.slice(offset, offset + options.pageSize),
    total,
    totalPages,
    page,
  };
}

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
  const parsedFilterMask = toNumber(
    firstDefined(raw.filterMask, raw.filter_mask),
  );
  const price = metric(firstDefined(raw.price, raw.lastPrice, raw.last_price, raw["10"]), fallbackSource, rowAsOf, "USD");
  const fairValue = metric(
    firstDefined(raw.fairValue, raw.intrinsicValue, raw.dcfValue, raw.stockdiag_fundamental_value_dcf),
    fallbackSource,
    rowAsOf,
    "USD",
  );
  return {
    marketCode,
    exchange,
    symbol: resolvedSymbol.toUpperCase(),
    company: toStringValue(firstDefined(raw.company, raw.name, raw.companyName, raw["55"]), resolvedSymbol.toUpperCase()),
    filterMask:
      parsedFilterMask !== null &&
      Number.isSafeInteger(parsedFilterMask) &&
      parsedFilterMask >= 0
        ? parsedFilterMask
        : 0,
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
      "derived",
      rowAsOf,
      "ratio",
    ),
    pe: metric(firstDefined(raw.pe, raw.priceToEarnings, raw.peRatio), fallbackSource, rowAsOf, "x"),
    revenueGrowth: metric(firstDefined(raw.revenueGrowth, raw.revenue_growth), fallbackSource, rowAsOf, "%"),
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

function isCompactMetricValue(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function assertSupportedCompactSnapshot(payload: UnknownRecord): void {
  if (!("schemaVersion" in payload)) return;
  const rows = payload.rows;
  const total = payload.total;
  const asOf = payload.asOf;
  if (
    typeof payload.schemaVersion !== "number" ||
    !Number.isSafeInteger(payload.schemaVersion) ||
    payload.schemaVersion < 1 ||
    payload.schemaVersion > SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION ||
    typeof payload.generationId !== "string" ||
    payload.generationId.length === 0 ||
    typeof asOf !== "string" ||
    !Number.isFinite(Date.parse(asOf)) ||
    typeof total !== "number" ||
    !Number.isSafeInteger(total) ||
    total < 1 ||
    total > MAX_SCREENER_CLIENT_SNAPSHOT_ROWS ||
    !Array.isArray(rows) ||
    rows.length !== total
  ) {
    throw new Error("The stored screener snapshot uses an unsupported format.");
  }
  const allowedFilterMask =
    payload.schemaVersion === SCREENER_FILTER_MASK_LEGACY_SCHEMA_VERSION
      ? SCREENER_FILTER_MASK_V1_ALL_BITS
      : payload.schemaVersion === 2
        ? SCREENER_FILTER_MASK_V2_ALL_BITS
        : SCREENER_FILTER_MASK_ALL_BITS;
  const marketCodes = new Set<string>();
  for (const row of rows) {
    if (
      !isRecord(row) ||
      typeof row.marketCode !== "string" ||
      row.marketCode.length === 0 ||
      typeof row.exchange !== "string" ||
      !["nasdaq", "nyse"].includes(row.exchange.toLowerCase()) ||
      typeof row.symbol !== "string" ||
      row.symbol.length === 0 ||
      (row.company !== null &&
        (typeof row.company !== "string" || row.company.length === 0)) ||
      typeof row.currency !== "string" ||
      row.currency.length === 0 ||
      typeof row.filterMask !== "number" ||
      !Number.isSafeInteger(row.filterMask) ||
      row.filterMask < 0 ||
      (row.filterMask & ~allowedFilterMask) !== 0 ||
      !isCompactMetricValue(row.price) ||
      !isCompactMetricValue(row.changePercent) ||
      !isCompactMetricValue(row.marketCap) ||
      !isCompactMetricValue(row.fairValue) ||
      !isCompactMetricValue(row.mispricing) ||
      !isCompactMetricValue(row.pe) ||
      !isCompactMetricValue(row.revenueGrowth)
    ) {
      throw new Error("The stored screener snapshot contains an invalid company row.");
    }
    if (marketCodes.has(row.marketCode)) {
      throw new Error("The stored screener snapshot contains duplicate companies.");
    }
    marketCodes.add(row.marketCode);
  }
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
  assertSupportedCompactSnapshot(body);
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
    generationId: toStringValue(body.generationId) || null,
    schemaVersion: toNumber(body.schemaVersion),
  };
}
