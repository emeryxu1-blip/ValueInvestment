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
  parseDcfModule,
  parseEarningsRevenueModule,
  yyyymmddToIso,
} from "./derivations";

const LABELS: Record<string, { label: string; unit: string }> = {
  price: { label: "Market price", unit: "USD" },
  eps: { label: "Earnings per share", unit: "USD" },
  revenue: { label: "Revenue", unit: "USD" },
  netIncome: { label: "Net income", unit: "USD" },
  freeCashFlow: { label: "Free cash flow", unit: "USD" },
  target: { label: "Analyst target", unit: "USD" },
};

function emptySeries(
  resolved: ResolvedSecurity,
  group: string,
  range: string,
  reason: string,
): SeriesResponse {
  return {
    symbol: resolved.symbol,
    marketCode: resolved.marketCode,
    group,
    range,
    series: [],
    source: "live",
    asOf: new Date().toISOString(),
    reason,
  };
}

async function getValuationSeries(
  resolved: ResolvedSecurity,
  range: string,
): Promise<SeriesResponse> {
  const payload = await fetchAInvest("snapshot", {
    symbol: [{ type: "market_code", value: [resolved.marketCode] }],
    indicator: [
      {
        id: "stockdiag_fundamental_value_dcf",
        req_unique_id: "fairValueModule",
      },
    ],
    page: { begin: 0, count: 1 },
  });
  const normalized = normalizeSnapshot(payload);
  const dcf = parseDcfModule(objectValue(normalized.rows[0], "fairValueModule"));
  const limit = pointsForRange(range);
  const history = dcf.history.slice(-limit);
  if (history.length === 0 && dcf.predicted.length === 0) {
    return emptySeries(
      resolved,
      "valuation",
      range,
      "No supported valuation series was returned.",
    );
  }
  return {
    symbol: resolved.symbol,
    marketCode: resolved.marketCode,
    group: "valuation",
    range,
    series: [
      {
        id: "price",
        label: "Market price",
        unit: "USD",
        points: history.map(([time, value]) => ({ time: yyyymmddToIso(time), value })),
      },
      {
        id: "dcf",
        label: "Cash-flow value",
        unit: "USD",
        points: [...dcf.predicted]
          .sort((left, right) => left[0].localeCompare(right[0]))
          .map(([time, value]) => ({ time: yyyymmddToIso(time), value })),
      },
    ],
    source: "live",
    asOf:
      normalized.rows[0]?.values.fairValueModule?.asOf ?? new Date().toISOString(),
  };
}

async function getPriceSeries(
  resolved: ResolvedSecurity,
  range: string,
): Promise<SeriesResponse> {
  const payload = await fetchAInvest(
    "multiKline",
    buildMultiKlineRequest(resolved.marketCode, range),
  );
  const points = normalizeKline(payload)[0]?.points ?? [];
  if (points.length === 0) {
    return emptySeries(
      resolved,
      "price",
      range,
      "No supported price series was returned.",
    );
  }
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
        points: points.map((point) => ({ time: point.time, value: point.close })),
      },
    ],
    source: "live",
    asOf: new Date().toISOString(),
  };
}

async function getFinancialSeries(
  resolved: ResolvedSecurity,
  range: string,
): Promise<SeriesResponse> {
  const payload = await fetchAInvest("snapshot", {
    symbol: [{ type: "market_code", value: [resolved.marketCode] }],
    indicator: [
      {
        id: "stockdiag_fundamental_past_earningsrevenue",
        req_unique_id: "earningsRevenueModule",
      },
    ],
    page: { begin: 0, count: 1 },
  });
  const normalized = normalizeSnapshot(payload);
  const financials = parseEarningsRevenueModule(
    objectValue(normalized.rows[0], "earningsRevenueModule"),
  );
  if (financials.quarterly.length === 0) {
    return emptySeries(
      resolved,
      "financials",
      range,
      "No supported financial series was returned.",
    );
  }
  return {
    symbol: resolved.symbol,
    marketCode: resolved.marketCode,
    group: "financials",
    range,
    series: [
      ["revenue", "Revenue"],
      ["netIncome", "Net income"],
    ].map(([id, label]) => ({
      id,
      label,
      unit: "USD",
      points: financials.quarterly.map((period) => ({
        time: period.period,
        value: period[id as "revenue" | "netIncome"],
      })),
    })),
    source: "live",
    asOf:
      normalized.rows[0]?.values.earningsRevenueModule?.asOf ??
      new Date().toISOString(),
  };
}

export async function getSeriesResponse(
  resolved: ResolvedSecurity,
  group: string,
  range: string,
): Promise<SeriesResponse> {
  if (group === "valuation") return getValuationSeries(resolved, range);
  if (group === "price") return getPriceSeries(resolved, range);
  if (group === "financials") return getFinancialSeries(resolved, range);
  const payload = await fetchAInvest(
    "series",
    buildSeriesRequest(resolved.marketCode, group, range),
  );
  const normalized = normalizeSeries(payload)[0];
  const series = Object.entries(normalized?.values ?? {}).map(([id, value]) => ({
    id,
    label: LABELS[id]?.label ?? id,
    unit: LABELS[id]?.unit ?? "",
    points: value.points,
  }));
  if (series.length === 0 || series.every((item) => item.points.length === 0)) {
    return emptySeries(
      resolved,
      group,
      range,
      "No supported series was returned.",
    );
  }
  return {
    symbol: resolved.symbol,
    marketCode: resolved.marketCode,
    group,
    range,
    series,
    source: "live",
    asOf: new Date().toISOString(),
  };
}
