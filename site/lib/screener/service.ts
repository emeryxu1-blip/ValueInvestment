import type {
  ScanProgress,
  ScreenerFilters,
  ScreenerResponse,
  ScreenerRow,
  ScreenerSort,
  SortOrder,
} from "../contracts";
import { fetchAInvest } from "../ainvest/client";
import {
  normalizeSnapshot,
  displayNumberValue,
  numberValue,
  objectValue,
  stringValue,
  type NormalizedSnapshotRow,
} from "../ainvest/normalize";
import {
  buildScreenerUniverseSnapshotRequest,
  SCREENER_INDICATORS,
} from "../ainvest/requests";
import { metric } from "../metric";
import {
  catalogEntryForMarketCode,
  routeExchangeForMarketCode,
  symbolFromMarketCode,
} from "../market-codes";
import { deriveMispricing, parseDcfModule } from "../security/derivations";
import { positiveNumber } from "../security/valuation.ts";
import {
  assertExactUniverseMarketCodes,
  ensureTopMarketCapUniverse,
  readTopMarketCapUniverseVersion,
} from "./universe";
import { screenerFilterMask } from "./filter-presets";
import { summarizeOperatingMarginHistory } from "./operating-margins";
import {
  readScreenerSnapshot,
  replaceScreenerSnapshot,
  type DurableScreenerSnapshot,
} from "./snapshot";

const MEMORY_CACHE_TTL_MS = 5 * 60 * 1000;
const REQUIRED_EXCHANGES = new Set(["nasdaq", "nyse"]);
const REQUIRED_FILTER_METRIC_COVERAGE = {
  evToEbitda: 0.7,
  returnOnInvestedCapital: 0.8,
  netDebt: 0.9,
} as const;

type ScreenerSnapshotRefreshOptions = {
  refreshedAt?: number;
  generationId?: string;
  dailyRunCompletion?: {
    tradingDate: string;
    leaseToken: string;
  };
};

export class ScreenerSnapshotUnavailableError extends Error {
  constructor() {
    super("No stored screener snapshot has been published yet.");
    this.name = "ScreenerSnapshotUnavailableError";
  }
}

type CacheRecord = {
  generationId: string;
  rows: ScreenerRow[];
  expiresAt: number;
  universeRefreshedAt: number;
  refreshedAt: number;
};

let valuationCache: CacheRecord | null = null;
let scanProgress: ScanProgress = { state: "idle", scanned: 0, total: null };
let scanPromise: Promise<CacheRecord> | null = null;

export type ScreenerQuery = {
  page: number;
  pageSize: number;
  sort: ScreenerSort;
  order: SortOrder;
  filters: ScreenerFilters;
  columns: string[];
};

function liveMetricNumber(
  row: NormalizedSnapshotRow,
  requestId: string,
  fetchedAt: string,
  unit?: string,
) {
  const value = displayNumberValue(row, requestId);
  return metric(value, "live", {
    asOf: row.values[requestId]?.asOf ?? fetchedAt,
    unit,
    ...(value == null ? { reason: "Market data returned no value for this metric." } : {}),
  });
}

export function screenerRowFromSnapshot(
  row: NormalizedSnapshotRow,
  fetchedAt: string,
): ScreenerRow {
  const catalog = catalogEntryForMarketCode(row.symbolCode);
  const company = stringValue(row, "company") ?? catalog?.companyName ?? null;
  const companySource = stringValue(row, "company") ? "live" : "derived";
  const price = numberValue(row, "price");
  const dcf = parseDcfModule(objectValue(row, "fairValueModule"));
  const fairValue = positiveNumber(dcf.fairValue);
  const operatingMargins = summarizeOperatingMarginHistory(
    objectValue(row, "operatingMarginHistory"),
  );
  const fairAsOf = row.values.fairValueModule?.asOf ?? fetchedAt;
  const result: Omit<ScreenerRow, "filterMask"> = {
    marketCode: row.symbolCode,
    exchange: catalog?.exchange ?? routeExchangeForMarketCode(row.symbolCode),
    symbol: catalog?.symbol ?? symbolFromMarketCode(row.symbolCode),
    company: metric(company, companySource, {
      asOf: companySource === "live" ? row.values.company?.asOf ?? fetchedAt : null,
      ...(company == null ? { reason: "Company name is unavailable." } : {}),
    }),
    price: liveMetricNumber(row, "price", fetchedAt, "USD"),
    changePercent: liveMetricNumber(row, "changePercent", fetchedAt, "%"),
    marketCap: liveMetricNumber(row, "marketCap", fetchedAt, "USD"),
    fairValue: metric(fairValue, "live", {
      asOf: fairAsOf,
      unit: "USD",
      ...(fairValue == null
        ? { reason: "Market data returned no supported cash-flow value." }
        : {}),
    }),
    mispricing: metric(deriveMispricing(fairValue, price), "derived", {
      asOf: fairAsOf,
      unit: "ratio",
      reason: "Calculated as fair value divided by price, minus one.",
    }),
    pe: liveMetricNumber(row, "pe", fetchedAt, "x"),
    revenueGrowth: liveMetricNumber(row, "revenueGrowth", fetchedAt, "%"),
    netIncome: liveMetricNumber(row, "netIncome", fetchedAt, "USD"),
    freeCashFlow: liveMetricNumber(row, "freeCashFlow", fetchedAt, "USD"),
    debtToEquity: liveMetricNumber(row, "debtToEquity", fetchedAt, "%"),
    evToEbitda: liveMetricNumber(row, "evToEbitda", fetchedAt, "x"),
    returnOnInvestedCapital: liveMetricNumber(
      row,
      "returnOnInvestedCapital",
      fetchedAt,
      "%",
    ),
    netDebt: liveMetricNumber(row, "netDebt", fetchedAt, "USD"),
    operatingMarginStable5Y: metric(operatingMargins.stable5Y, "derived", {
      asOf: operatingMargins.asOf,
      reason:
        operatingMargins.stable5Y == null
          ? "Five consecutive annual operating-margin observations were not returned."
          : "True when the five-year operating-margin range is no more than five percentage points.",
    }),
    operatingMarginTrend5Y: metric(operatingMargins.trend5Y, "derived", {
      asOf: operatingMargins.asOf,
      unit: "ratio per year",
      reason:
        operatingMargins.trend5Y == null
          ? "Five consecutive annual operating-margin observations were not returned."
          : "Least-squares annual trend across the latest five fiscal-year operating margins.",
    }),
    operatingMarginsExpanding5Y: metric(operatingMargins.expanding5Y, "derived", {
      asOf: operatingMargins.asOf,
      reason:
        operatingMargins.expanding5Y == null
          ? "Five consecutive annual operating-margin observations were not returned."
          : "True when the five-year least-squares slope is positive and the latest margin exceeds the earliest.",
    }),
    sector: metric(stringValue(row, "sector"), "live", {
      asOf: row.values.sector?.asOf ?? fetchedAt,
      ...(stringValue(row, "sector") == null
        ? { reason: "Market data returned no sector." }
        : {}),
    }),
    currency: "USD",
  };
  return {
    ...result,
    filterMask: screenerFilterMask(result),
  };
}

async function fetchStoredUniverse(marketCodes: string[]): Promise<ScreenerRow[]> {
  const rows: ScreenerRow[] = [];
  for (let start = 0; start < marketCodes.length; start += 400) {
    const batches = [start, start + 200]
      .filter((offset) => offset < marketCodes.length)
      .map((offset) => marketCodes.slice(offset, offset + 200));
    const payloads = await Promise.all(
      batches.map((batch) =>
        fetchAInvest(
          "snapshot",
          buildScreenerUniverseSnapshotRequest(batch),
        ),
      ),
    );
    for (const [index, payload] of payloads.entries()) {
      const fetchedAt = new Date().toISOString();
      rows.push(...screenerRowsForUniversePayload(payload, batches[index], fetchedAt));
    }
  }
  assertExactUniverseMarketCodes(
    marketCodes,
    rows.map((row) => row.marketCode),
  );
  return rows;
}

function screenerRowsForUniversePayload(
  payload: unknown,
  requestedMarketCodes: string[],
  fetchedAt: string,
): ScreenerRow[] {
  const snapshot = normalizeSnapshot(payload);
  const normalized = snapshot.rows;
  const returnedIndicatorIds = new Set(
    snapshot.indicators.map(
      (indicator) => indicator.req_unique_id ?? indicator.id,
    ),
  );
  const missingIndicators = SCREENER_INDICATORS.filter(
    (indicator) => !returnedIndicatorIds.has(indicator.req_unique_id),
  );
  if (missingIndicators.length > 0) {
    throw new Error("The screener snapshot omitted required indicators.");
  }
  assertExactUniverseMarketCodes(
    requestedMarketCodes,
    normalized.map((row) => row.symbolCode),
  );
  return normalized.map((row) => screenerRowFromSnapshot(row, fetchedAt));
}

function assertFilterMetricCoverage(rows: ScreenerRow[]): void {
  for (const [metricName, minimumCoverage] of Object.entries(
    REQUIRED_FILTER_METRIC_COVERAGE,
  ) as Array<
    [keyof typeof REQUIRED_FILTER_METRIC_COVERAGE, number]
  >) {
    const populated = rows.filter(
      (row) => row[metricName].value != null,
    ).length;
    if (populated / rows.length < minimumCoverage) {
      throw new Error("The screener snapshot omitted required filter coverage.");
    }
  }
}

function cacheIsFresh(universeRefreshedAt?: number): boolean {
  return Boolean(
    valuationCache &&
      valuationCache.expiresAt > Date.now() &&
      (universeRefreshedAt == null ||
        valuationCache.universeRefreshedAt === universeRefreshedAt),
  );
}

export function getScreenerScanProgress(): ScanProgress {
  if (cacheIsFresh() && scanProgress.state !== "ready") {
    scanProgress = {
      state: "ready",
      scanned: valuationCache?.rows.length ?? 0,
      total: valuationCache?.rows.length ?? null,
      completedAt: new Date(
        valuationCache?.refreshedAt ?? Date.now(),
      ).toISOString(),
    };
  }
  return { ...scanProgress };
}

function installSnapshot(
  snapshot: DurableScreenerSnapshot,
  startedAt?: string,
): CacheRecord {
  const record: CacheRecord = {
    generationId: snapshot.generationId,
    rows: snapshot.rows,
    expiresAt: Date.now() + MEMORY_CACHE_TTL_MS,
    universeRefreshedAt: snapshot.universeRefreshedAt,
    refreshedAt: snapshot.refreshedAt,
  };
  valuationCache = record;
  scanProgress = {
    state: "ready",
    scanned: snapshot.rows.length,
    total: snapshot.rows.length,
    ...(startedAt ? { startedAt } : {}),
    completedAt: new Date(snapshot.refreshedAt).toISOString(),
  };
  return record;
}

async function refreshScreenerSnapshotGeneration(
  db: D1Database,
  options: ScreenerSnapshotRefreshOptions,
  generationRetry = 0,
): Promise<DurableScreenerSnapshot> {
  // This timestamp identifies when the scan began, not when its slowest
  // upstream request happened to finish. The durable pointer uses it to keep a
  // late older scan from replacing a newer completed generation.
  const generationRefreshedAt = options.refreshedAt ?? Date.now();
  const universe = await ensureTopMarketCapUniverse(db);
  const universeRefreshedAt = universe[0]?.refreshedAt ?? 0;
  const startedAt = new Date(generationRefreshedAt).toISOString();
  const scopedUniverse = universe.filter((member) =>
    REQUIRED_EXCHANGES.has(member.exchange.toLowerCase()),
  );
  if (scopedUniverse.length === 0) {
    throw new Error("The Top 1,000 universe contained no NYSE or NASDAQ securities.");
  }
  scanProgress = {
    state: "warming",
    scanned: 0,
    total: scopedUniverse.length,
    startedAt,
  };
  try {
    const rows = await fetchStoredUniverse(
      scopedUniverse.map((member) => member.marketCode),
    );
    assertFilterMetricCoverage(rows);
    const latestVersion = await readTopMarketCapUniverseVersion(db);
    if (latestVersion !== universeRefreshedAt) {
      if (generationRetry === 0) {
        return await refreshScreenerSnapshotGeneration(
          db,
          options,
          generationRetry + 1,
        );
      }
      throw new Error("The Top 1,000 universe changed during the valuation scan.");
    }
    const snapshot = await replaceScreenerSnapshot(db, rows, {
      ...(options.generationId
        ? { generationId: options.generationId }
        : {}),
      ...(options.dailyRunCompletion
        ? { dailyRunCompletion: options.dailyRunCompletion }
        : {}),
      universeRefreshedAt,
      refreshedAt: generationRefreshedAt,
    });
    installSnapshot(snapshot, startedAt);
    return snapshot;
  } catch (error) {
    scanProgress = {
      ...scanProgress,
      state: "error",
      error: "The Top 1,000 valuation scan could not be refreshed.",
    };
    throw error;
  }
}

export async function refreshScreenerSnapshot(
  db: D1Database,
  options: ScreenerSnapshotRefreshOptions = {},
): Promise<DurableScreenerSnapshot> {
  return refreshScreenerSnapshotGeneration(db, options);
}

async function readValuationCache(db: D1Database): Promise<CacheRecord> {
  const stored = await readScreenerSnapshot(db);
  if (stored) return installSnapshot(stored);
  scanProgress = {
    state: "error",
    scanned: 0,
    total: null,
    error: "Stored screener results are not available yet.",
  };
  throw new ScreenerSnapshotUnavailableError();
}

async function loadValuationCache(db: D1Database): Promise<CacheRecord> {
  if (cacheIsFresh() && valuationCache) return valuationCache;
  if (scanPromise) return scanPromise;
  const claimedScan = readValuationCache(db);
  scanPromise = claimedScan;
  try {
    return await claimedScan;
  } finally {
    if (scanPromise === claimedScan) scanPromise = null;
  }
}

export function applyScreenerFilters(
  rows: ScreenerRow[],
  filters: ScreenerFilters,
): ScreenerRow[] {
  const symbols = new Set(filters.symbols?.map((symbol) => symbol.toUpperCase()));
  const query = filters.query?.trim().toLowerCase();
  return rows.filter((row) => {
    const price = row.price.value;
    const fairValue = row.fairValue.value;
    const marketCap = row.marketCap.value;
    const change = row.changePercent.value;
    const mispricing = row.mispricing.value;
    const pe = row.pe.value;
    const revenueGrowth = row.revenueGrowth.value;
    const netIncome = row.netIncome.value;
    const freeCashFlow = row.freeCashFlow.value;
    const debtToEquity = row.debtToEquity.value;
    const evToEbitda = row.evToEbitda.value;
    const returnOnInvestedCapital = row.returnOnInvestedCapital.value;
    const netDebt = row.netDebt.value;
    const operatingMarginStable5Y = row.operatingMarginStable5Y.value;
    const operatingMarginsExpanding5Y = row.operatingMarginsExpanding5Y.value;
    if (!REQUIRED_EXCHANGES.has(row.exchange.toLowerCase())) return false;
    if (filters.fairValueGtePrice && (price == null || fairValue == null || fairValue < price)) return false;
    if (filters.minMarketCap != null && (marketCap == null || marketCap < filters.minMarketCap)) return false;
    if (filters.maxMarketCap != null && (marketCap == null || marketCap > filters.maxMarketCap)) return false;
    if (filters.minPrice != null && (price == null || price < filters.minPrice)) return false;
    if (filters.maxPrice != null && (price == null || price > filters.maxPrice)) return false;
    if (filters.minChangePercent != null && (change == null || change < filters.minChangePercent)) return false;
    if (filters.maxChangePercent != null && (change == null || change > filters.maxChangePercent)) return false;
    if (filters.minMispricing != null && (mispricing == null || mispricing < filters.minMispricing)) return false;
    if (filters.maxMispricing != null && (mispricing == null || mispricing > filters.maxMispricing)) return false;
    if (filters.minPe != null && (pe == null || pe < filters.minPe)) return false;
    if (
      filters.maxPe != null &&
      (pe == null || !Number.isFinite(pe) || pe <= 0 || pe > filters.maxPe)
    )
      return false;
    if (filters.minRevenueGrowth != null && (revenueGrowth == null || revenueGrowth < filters.minRevenueGrowth)) return false;
    if (filters.maxRevenueGrowth != null && (revenueGrowth == null || revenueGrowth > filters.maxRevenueGrowth)) return false;
    if (filters.positiveNetIncome && (netIncome == null || netIncome <= 0)) return false;
    if (filters.positiveFreeCashFlow && (freeCashFlow == null || freeCashFlow <= 0)) return false;
    if (
      filters.minFreeCashFlowYield != null &&
      (freeCashFlow == null ||
        freeCashFlow <= 0 ||
        marketCap == null ||
        marketCap <= 0 ||
        freeCashFlow / marketCap < filters.minFreeCashFlowYield)
    )
      return false;
    if (
      filters.maxEvToEbitda != null &&
      (evToEbitda == null ||
        evToEbitda <= 0 ||
        evToEbitda > filters.maxEvToEbitda)
    )
      return false;
    if (
      filters.minCashConversion != null &&
      (netIncome == null ||
        netIncome <= 0 ||
        freeCashFlow == null ||
        freeCashFlow <= 0 ||
        freeCashFlow / netIncome < filters.minCashConversion)
    )
      return false;
    if (
      filters.minReturnOnInvestedCapital != null &&
      (returnOnInvestedCapital == null ||
        returnOnInvestedCapital < filters.minReturnOnInvestedCapital)
    )
      return false;
    if (
      filters.maxNetDebtToFreeCashFlow != null &&
      (netDebt == null ||
        freeCashFlow == null ||
        freeCashFlow <= 0 ||
        netDebt / freeCashFlow > filters.maxNetDebtToFreeCashFlow)
    )
      return false;
    if (filters.maxDebtToEquity != null && (debtToEquity == null || debtToEquity > filters.maxDebtToEquity)) return false;
    if (filters.stableOperatingMargins5Y && operatingMarginStable5Y !== true) return false;
    if (filters.expandingOperatingMargins5Y && operatingMarginsExpanding5Y !== true) return false;
    if (
      filters.sector &&
      !row.sector.value?.toLowerCase().includes(filters.sector.toLowerCase())
    )
      return false;
    if (filters.exchanges?.length && !filters.exchanges.map((exchange) => exchange.toLowerCase()).includes(row.exchange)) return false;
    if (symbols.size > 0 && !symbols.has(row.symbol.toUpperCase())) return false;
    if (query && !`${row.symbol} ${row.company.value ?? ""}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

function comparableValue(row: ScreenerRow, sort: ScreenerSort): string | number | null {
  if (sort === "symbol") return row.symbol;
  if (sort === "company") return row.company.value;
  return row[sort].value;
}

export function sortScreenerRows(
  rows: ScreenerRow[],
  sort: ScreenerSort,
  order: SortOrder,
): ScreenerRow[] {
  const direction = order === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = comparableValue(left, sort);
    const b = comparableValue(right, sort);
    if (a == null && b == null) return left.symbol.localeCompare(right.symbol);
    if (a == null) return 1;
    if (b == null) return -1;
    return (
      (typeof a === "string" && typeof b === "string"
        ? a.localeCompare(b)
        : Number(a) - Number(b)) * direction
    );
  });
}

function responseFromRows(
  rows: ScreenerRow[],
  query: ScreenerQuery,
  options: {
    status: ScreenerResponse["status"];
    totalKnown: boolean;
    alreadyPaged?: boolean;
    scan?: ScanProgress;
    message?: string;
  },
): ScreenerResponse {
  const filtered = applyScreenerFilters(rows, query.filters);
  const sorted = sortScreenerRows(filtered, query.sort, query.order);
  const offset = (query.page - 1) * query.pageSize;
  const data = options.alreadyPaged ? sorted : sorted.slice(offset, offset + query.pageSize);
  const total = options.totalKnown ? filtered.length : null;
  const unsupportedMessage = query.filters.unsupported?.length
    ? `Unsupported filters were not applied: ${query.filters.unsupported.join(", ")}.`
    : "";
  const message = [options.message, unsupportedMessage].filter(Boolean).join(" ");
  return {
    status: options.status,
    data,
    page: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: total == null ? null : Math.max(1, Math.ceil(total / query.pageSize)),
    },
    applied: {
      sort: query.sort,
      order: query.order,
      filters: query.filters,
      columns: query.columns,
    },
    ...(options.scan ? { scan: options.scan } : {}),
    asOf: new Date().toISOString(),
    ...(message ? { message } : {}),
  };
}

export async function getScreenerResponse(
  query: ScreenerQuery,
  db: D1Database,
): Promise<{
  response: ScreenerResponse;
  status: number;
}> {
  const cache = await loadValuationCache(db);
  const response = responseFromRows(cache.rows, query, {
    status: "ready",
    totalKnown: true,
    scan: getScreenerScanProgress(),
    message:
      "Results use the latest stored daily market snapshot for NYSE and NASDAQ members of the monthly Top 1,000 companies by market cap.",
  });
  response.asOf = new Date(cache.refreshedAt).toISOString();
  response.snapshot = {
    generationId: cache.generationId,
    universeRefreshedAt: new Date(cache.universeRefreshedAt).toISOString(),
    refreshedAt: response.asOf,
  };
  return { response, status: 200 };
}

export function resetScreenerCacheForTests(): void {
  valuationCache = null;
  scanProgress = { state: "idle", scanned: 0, total: null };
  scanPromise = null;
}
