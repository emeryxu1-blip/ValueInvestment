import type { SeriesResponse } from "../contracts";
import { fetchAInvest } from "../ainvest/client";
import {
  normalizeKline,
  normalizeSeries,
  normalizeSnapshot,
  objectValue,
} from "../ainvest/normalize";
import {
  buildMultiKlineRequest,
  buildSeriesRequest,
  pointsForRange,
} from "../ainvest/requests";
import type { ResolvedSecurity } from "../market-codes";
import {
  normalizeChartPoints,
  normalizeChartPricePoints,
} from "./chart-series";
import {
  parseDcfModule,
  parseEarningsRevenueModule,
  yyyymmddToIso,
} from "./derivations";

const LABELS: Record<string, { label: string; unit?: string }> = {
  price: { label: "Market price" },
  eps: { label: "Earnings per share" },
  revenue: { label: "Revenue" },
  netIncome: { label: "Net income" },
};

type SeriesWindow = {
  before?: number;
  limit?: number;
};

function responseWindow(options: {
  points: Array<{ time: string; value: number }>;
  providerPageFull: boolean;
  before?: number;
}) {
  const { points, providerPageFull, before } = options;
  const oldestTime = points[0]?.time ?? null;
  const newestTime = points.at(-1)?.time ?? null;
  const oldestTimestamp = oldestTime ? Date.parse(oldestTime) : Number.NaN;
  const nextCursor = Number.isFinite(oldestTimestamp)
    ? oldestTimestamp - 1
    : null;
  const advancedPastCursor =
    before == null || (nextCursor !== null && nextCursor < before);
  return {
    oldestTime,
    newestTime,
    hasMore: providerPageFull && nextCursor !== null && advancedPastCursor,
    nextCursor,
    before: before ?? null,
  };
}

async function getValuationSeries(
  resolved: ResolvedSecurity,
  range: string,
): Promise<SeriesResponse> {
  const [snapshotPayload, pricePayload] = await Promise.all([
    fetchAInvest("snapshot", {
      symbol: [{ type: "market_code", value: [resolved.marketCode] }],
      indicator: [
        { id: "stockdiag_fundamental_value_dcf", req_unique_id: "fairValueModule" },
      ],
      page: { begin: 0, count: 1 },
      res_symbol_type: "market_code",
    }),
    fetchAInvest("multiKline", buildMultiKlineRequest(resolved.marketCode, range, {
      count: Math.min(pointsForRange(range), 500),
    })),
  ]);
  const row = normalizeSnapshot(snapshotPayload).rows[0];
  if (!row || row.symbolCode !== resolved.marketCode) {
    throw new Error("The market data service returned no matching security row.");
  }
  const dcf = parseDcfModule(objectValue(row, "fairValueModule"));
  const pricePoints = normalizeChartPricePoints(normalizeKline(pricePayload)[0]?.points ?? []);
  const providerDcfPoints = normalizeChartPoints(
    dcf.predicted.map(([time, value]) => ({ time: yyyymmddToIso(time), value })),
  );
  if (pricePoints.length === 0 && providerDcfPoints.length === 0) {
    throw new Error("No market-price history or DCF periods are available.");
  }
  const providerAsOf = row.values.fairValueModule?.asOf ?? null;
  const providerAsOfDate = providerAsOf?.slice(0, 10) ?? null;
  return {
    symbol: resolved.symbol,
    marketCode: resolved.marketCode,
    group: "valuation",
    range,
    series: [
      { id: "price", label: "Market price", unit: "USD", points: pricePoints, seriesKind: "historical" },
      {
        id: "provider-dcf",
        label: "DCF value",
        unit: "USD",
        points: providerDcfPoints,
        seriesKind: "model-period",
      },
    ],
    source: "live",
    asOf: providerAsOf,
    ...(providerDcfPoints.length === 0
      ? { reason: "No positive DCF model-period values are available." }
      : {}),
    valuationCoverage: {
      marketPrice: {
        startTime: pricePoints[0]?.time ?? null,
        endTime: pricePoints.at(-1)?.time ?? null,
        pointCount: pricePoints.length,
        limited: false,
      },
      providerDcf: providerDcfPoints.length
        ? {
            startTime: providerDcfPoints[0]?.time ?? null,
            endTime: providerDcfPoints.at(-1)?.time ?? null,
            pointCount: providerDcfPoints.length,
            sourceAsOf: providerAsOf,
            includesFuturePeriod:
              providerAsOfDate != null &&
              providerDcfPoints.some((point) => point.time > providerAsOfDate),
            isEstimateRevisionHistory: false,
          }
        : null,
    },
  };
}

async function getPriceSeries(
  resolved: ResolvedSecurity,
  range: string,
  window: SeriesWindow = {},
): Promise<SeriesResponse> {
  const requestedLimit = Math.min(
    2000,
    Math.max(20, window.limit ?? pointsForRange(range)),
  );
  const payload = await fetchAInvest(
    "multiKline",
    buildMultiKlineRequest(resolved.marketCode, range, {
      endTime: window.before,
      count: requestedLimit,
    }),
  );
  const normalized = normalizeKline(payload)[0];
  const points = normalizeChartPricePoints(normalized?.points ?? []);
  if (points.length === 0) {
    throw new Error("No market-price history was returned.");
  }
  const page = responseWindow({
    points,
    providerPageFull: points.length >= requestedLimit,
    before: window.before,
  });
  return {
    symbol: resolved.symbol,
    marketCode: resolved.marketCode,
    group: "price",
    range,
    series: [
      {
        id: "price",
        label: "Market price",
        unit: "USD",
        points,
        seriesKind: "historical",
      },
    ],
    source: "live",
    asOf: points.at(-1)?.time ?? null,
    ...page,
  };
}

async function getFinancialSeries(
  resolved: ResolvedSecurity,
  range: string,
): Promise<SeriesResponse> {
  const payload = await fetchAInvest(
    "snapshot",
    {
      symbol: [{ type: "market_code", value: [resolved.marketCode] }],
      indicator: [
        {
          id: "stockdiag_fundamental_past_earningsrevenue",
          req_unique_id: "earningsRevenueModule",
        },
      ],
      page: { begin: 0, count: 1 },
      res_symbol_type: "market_code",
    },
  );
  const row = normalizeSnapshot(payload).rows[0];
  if (!row || row.symbolCode !== resolved.marketCode) {
    throw new Error("The market data service returned no matching security row.");
  }
  const financials = parseEarningsRevenueModule(
    objectValue(row, "earningsRevenueModule"),
  );
  if (financials.quarterly.length === 0) {
    throw new Error("No supported financial series was returned.");
  }
  return {
    symbol: resolved.symbol,
    marketCode: resolved.marketCode,
    group: "financials",
    range,
    series: ["revenue", "netIncome"].map((id) => ({
      id,
      label: id === "revenue" ? "Revenue" : "Net income",
      unit: "",
      points: normalizeChartPoints(
        financials.quarterly
          .map((period) => ({ time: period.period, value: period[id as "revenue" | "netIncome"] }))
          .filter((point): point is { time: string; value: number } => point.value != null),
      ),
      seriesKind: "historical" as const,
    })),
    source: "live",
    asOf: row.values.earningsRevenueModule?.asOf ?? null,
  };
}

export async function getSeriesResponse(
  resolved: ResolvedSecurity,
  group: string,
  range: string,
  window: SeriesWindow = {},
): Promise<SeriesResponse> {
  if (group === "valuation") return getValuationSeries(resolved, range);
  if (group === "price") return getPriceSeries(resolved, range, window);
  if (group === "financials") return getFinancialSeries(resolved, range);
  const payload = await fetchAInvest(
    "series",
    buildSeriesRequest(resolved.marketCode, group, range),
  );
  const normalized = normalizeSeries(payload)[0];
  const series = Object.entries(normalized?.values ?? {}).flatMap(([id, value]) => {
    const definition = LABELS[id];
    if (!definition) return [];
    return [{
      id,
      label: definition.label,
      unit: definition.unit ?? "",
      points: normalizeChartPoints(value.points),
    }];
  });
  if (series.length === 0 || series.every((item) => item.points.length === 0)) {
    throw new Error("No supported series was returned.");
  }
  const asOf = normalized?.asOf ?? null;
  return {
    symbol: resolved.symbol,
    marketCode: resolved.marketCode,
    group,
    range,
    series,
    source: "live",
    asOf,
  };
}
