import type {
  ScanProgress,
  ScreenerFilters,
  ScreenerResponse,
  ScreenerRow,
  ScreenerSort,
  SortOrder,
} from "../contracts";
import { fetchAInvest, hasAInvestAuth } from "../ainvest/client";
import {
  normalizeSnapshot,
  displayNumberValue,
  numberValue,
  objectValue,
  stringValue,
  type NormalizedSnapshotRow,
} from "../ainvest/normalize";
import {
  buildScreenerQuoteRequest,
  buildScreenerSnapshotRequest,
} from "../ainvest/requests";
import { metric } from "../metric";
import {
  catalogEntryForMarketCode,
  routeExchangeForMarketCode,
  symbolFromMarketCode,
} from "../market-codes";
import { deriveMispricing, parseDcfModule } from "../security/derivations";

const CACHE_TTL_MS = 30 * 60 * 1000;

type CacheRecord = {
  rows: ScreenerRow[];
  expiresAt: number;
};

let valuationCache: CacheRecord | null = null;
let scanProgress: ScanProgress = { state: "idle", scanned: 0, total: null };
let scanPromise: Promise<void> | null = null;

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
  const fairAsOf = row.values.fairValueModule?.asOf ?? fetchedAt;
  return {
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
    fairValue: metric(dcf.fairValue, "live", {
      asOf: fairAsOf,
      unit: "USD",
      ...(dcf.fairValue == null
        ? { reason: "Market data returned no supported cash-flow value." }
        : {}),
    }),
    mispricing: metric(deriveMispricing(dcf.fairValue, price), "derived", {
      asOf: fairAsOf,
      unit: "ratio",
      reason: "Calculated as fair value divided by price, minus one.",
    }),
    pe: liveMetricNumber(row, "pe", fetchedAt, "x"),
    revenueGrowth: liveMetricNumber(row, "revenueGrowth", fetchedAt, "%"),
    netIncome: liveMetricNumber(row, "netIncome", fetchedAt, "USD"),
    freeCashFlow: liveMetricNumber(row, "freeCashFlow", fetchedAt, "USD"),
    debtToEquity: liveMetricNumber(row, "debtToEquity", fetchedAt, "%"),
    sector: metric(stringValue(row, "sector"), "live", {
      asOf: row.values.sector?.asOf ?? fetchedAt,
      ...(stringValue(row, "sector") == null
        ? { reason: "Market data returned no sector." }
        : {}),
    }),
    currency: "USD",
  };
}

async function fetchUniversePage(
  begin: number,
  count: number,
  sort: ScreenerSort = "marketCap",
  order: SortOrder = "desc",
): Promise<{
  rows: ScreenerRow[];
  total: number;
}> {
  const payload = await fetchAInvest(
    "snapshot",
    buildScreenerSnapshotRequest({
      begin,
      count: Math.min(1000, count),
      sort,
      order,
      fullSymbols: begin === 0,
    }),
  );
  const fetchedAt = new Date().toISOString();
  const normalized = normalizeSnapshot(payload);
  return {
    rows: normalized.rows.map((row) => screenerRowFromSnapshot(row, fetchedAt)),
    total: normalized.total,
  };
}

async function refreshCachedPageQuotes(
  rows: ScreenerRow[],
): Promise<ScreenerRow[]> {
  if (rows.length === 0) return [];
  const payload = await fetchAInvest(
    "snapshot",
    buildScreenerQuoteRequest(rows.map((row) => row.marketCode)),
  );
  const fetchedAt = new Date().toISOString();
  const quoteRows = new Map(
    normalizeSnapshot(payload).rows.map((row) => [row.symbolCode, row]),
  );
  return rows.map((cached) => {
    const fresh = quoteRows.get(cached.marketCode);
    const missing = (unit: string) =>
      metric<number>(null, "live", {
        asOf: fetchedAt,
        unit,
        reason: "A current market quote was not returned for this security.",
      });
    const price = fresh
      ? liveMetricNumber(fresh, "price", fetchedAt, "USD")
      : missing("USD");
    return {
      ...cached,
      price,
      changePercent: fresh
        ? liveMetricNumber(fresh, "changePercent", fetchedAt, "%")
        : missing("%"),
      marketCap: fresh
        ? liveMetricNumber(fresh, "marketCap", fetchedAt, "USD")
        : missing("USD"),
      mispricing: metric(
        deriveMispricing(cached.fairValue.value, price.value),
        "derived",
        {
          asOf: price.asOf ?? fetchedAt,
          unit: "ratio",
          reason: "Calculated from the cached fair value and current market price.",
        },
      ),
    };
  });
}

function cacheIsFresh(): boolean {
  return Boolean(valuationCache && valuationCache.expiresAt > Date.now());
}

export function getScreenerScanProgress(): ScanProgress {
  if (cacheIsFresh() && scanProgress.state !== "ready") {
    scanProgress = {
      state: "ready",
      scanned: valuationCache?.rows.length ?? 0,
      total: valuationCache?.rows.length ?? null,
      completedAt: new Date(
        (valuationCache?.expiresAt ?? Date.now()) - CACHE_TTL_MS,
      ).toISOString(),
    };
  }
  return { ...scanProgress };
}

export function startScreenerWarmup(): ScanProgress {
  if (cacheIsFresh()) return getScreenerScanProgress();
  if (scanPromise || !hasAInvestAuth()) return getScreenerScanProgress();
  if (
    scanProgress.state === "error" &&
    scanProgress.startedAt &&
    Date.now() - Date.parse(scanProgress.startedAt) < 60_000
  ) {
    return getScreenerScanProgress();
  }

  const startedAt = new Date().toISOString();
  scanProgress = { state: "warming", scanned: 0, total: null, startedAt };
  scanPromise = (async () => {
    try {
      const first = await fetchUniversePage(0, 1000);
      const rows = [...first.rows];
      scanProgress = {
        ...scanProgress,
        scanned: rows.length,
        total: first.total,
      };

      for (let begin = 1000; begin < first.total; begin += 2000) {
        const pages = await Promise.all(
          [begin, begin + 1000]
            .filter((offset) => offset < first.total)
            .map((offset) => fetchUniversePage(offset, 1000)),
        );
        for (const page of pages) rows.push(...page.rows);
        scanProgress = { ...scanProgress, scanned: rows.length, total: first.total };
      }

      const completedAt = new Date().toISOString();
      valuationCache = { rows, expiresAt: Date.now() + CACHE_TTL_MS };
      scanProgress = {
        state: "ready",
        scanned: rows.length,
        total: first.total,
        startedAt,
        completedAt,
      };
    } catch {
      scanProgress = {
        ...scanProgress,
        state: "error",
        error: "The complete valuation scan could not be refreshed.",
      };
    } finally {
      scanPromise = null;
    }
  })();
  return getScreenerScanProgress();
}

function hasGlobalFilters(filters: ScreenerFilters): boolean {
  return Boolean(
    filters.fairValueGtePrice ||
      filters.minMarketCap != null ||
      filters.maxMarketCap != null ||
      filters.minPrice != null ||
      filters.maxPrice != null ||
      filters.minChangePercent != null ||
      filters.maxChangePercent != null ||
      filters.minMispricing != null ||
      filters.maxMispricing != null ||
      filters.minPe != null ||
      filters.maxPe != null ||
      filters.minRevenueGrowth != null ||
      filters.maxRevenueGrowth != null ||
      filters.positiveNetIncome ||
      filters.positiveFreeCashFlow ||
      filters.maxDebtToEquity != null ||
      filters.sector ||
      filters.exchanges?.length ||
      filters.symbols?.length ||
      filters.query,
  );
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
    if (filters.maxPe != null && (pe == null || pe > filters.maxPe)) return false;
    if (filters.minRevenueGrowth != null && (revenueGrowth == null || revenueGrowth < filters.minRevenueGrowth)) return false;
    if (filters.maxRevenueGrowth != null && (revenueGrowth == null || revenueGrowth > filters.maxRevenueGrowth)) return false;
    if (filters.positiveNetIncome && (netIncome == null || netIncome <= 0)) return false;
    if (filters.positiveFreeCashFlow && (freeCashFlow == null || freeCashFlow <= 0)) return false;
    if (filters.maxDebtToEquity != null && (debtToEquity == null || debtToEquity > filters.maxDebtToEquity)) return false;
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

export async function getScreenerResponse(query: ScreenerQuery): Promise<{
  response: ScreenerResponse;
  status: number;
}> {
  const globalNeeded =
    hasGlobalFilters(query.filters) ||
    query.sort === "fairValue" ||
    query.sort === "mispricing";
  if (globalNeeded && cacheIsFresh() && valuationCache) {
    const response = responseFromRows(valuationCache.rows, query, {
      status: "ready",
      totalKnown: true,
      scan: getScreenerScanProgress(),
      message:
        "Intrinsic values and the result count are cached for up to 30 minutes; visible quotes were refreshed and current quote filters reapplied for this request.",
    });
    response.data = sortScreenerRows(
      applyScreenerFilters(
        await refreshCachedPageQuotes(response.data),
        query.filters,
      ),
      query.sort,
      query.order,
    );
    return {
      response,
      status: 200,
    };
  }

  if (globalNeeded) {
    startScreenerWarmup();
    const offset = (query.page - 1) * query.pageSize;
    const upstreamSort =
      query.sort === "fairValue" || query.sort === "mispricing"
        ? "marketCap"
        : query.sort;
    const current = await fetchUniversePage(
      offset,
      query.pageSize,
      upstreamSort,
      query.order,
    );
    const latestScan = getScreenerScanProgress();
    const scanFailed = latestScan.state === "error";
    return {
      response: responseFromRows(current.rows, query, {
        status: scanFailed ? "partial" : "warming",
        totalKnown: false,
        alreadyPaged: true,
        scan: latestScan,
        message:
          scanFailed
            ? "The global valuation scan failed. Results are limited to the current market-cap page."
            : "Scanning the complete supported universe for comparable fair values.",
      }),
      status: scanFailed ? 200 : 202,
    };
  }

  const offset = (query.page - 1) * query.pageSize;
  const current = await fetchUniversePage(
    offset,
    query.pageSize,
    query.sort,
    query.order,
  );
  const response = responseFromRows(current.rows, query, {
    status: "ready",
    totalKnown: false,
    alreadyPaged: true,
  });
  response.page.total = current.total;
  response.page.totalPages = Math.max(1, Math.ceil(current.total / query.pageSize));
  return { response, status: 200 };
}

export function resetScreenerCacheForTests(): void {
  valuationCache = null;
  scanProgress = { state: "idle", scanned: 0, total: null };
  scanPromise = null;
}
