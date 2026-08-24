import assert from "node:assert/strict";
import test from "node:test";

import {
  parseScreenerSearchParams,
  securityParamsSchema,
  seriesQuerySchema,
} from "../lib/validation.ts";

test("applies the default fair-value filter and market-cap sort", () => {
  const parsed = parseScreenerSearchParams(new URLSearchParams());
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, 25);
  assert.equal(parsed.sort, "marketCap");
  assert.equal(parsed.order, "desc");
  assert.equal(parsed.filters.fairValueGtePrice, true);
  assert.deepEqual(parsed.filters.exchanges, ["NASDAQ", "NYSE"]);
});

test("supports JSON filters, direct overrides, and deterministic language presets", () => {
  const parsed = parseScreenerSearchParams(
    new URLSearchParams({
      filters: JSON.stringify({ fairValueGtePrice: false, minPrice: 20 }),
      preset: "undervalued mega-cap gainers",
      minPrice: "30",
      symbols: "MSFT,AAPL",
      columns: "company,price,not-a-column",
    }),
  );
  assert.equal(parsed.filters.fairValueGtePrice, true);
  assert.equal(parsed.filters.minMarketCap, 200_000_000_000);
  assert.equal(parsed.filters.minChangePercent, 0);
  assert.equal(parsed.filters.minPrice, 30);
  assert.deepEqual(parsed.filters.symbols, ["MSFT", "AAPL"]);
  assert.deepEqual(parsed.columns, ["company", "price"]);
});

test("does not allow callers to clear the required US-major exchange scope", () => {
  const parsed = parseScreenerSearchParams(
    new URLSearchParams({
      filters: JSON.stringify({ fairValueGtePrice: false, exchanges: [] }),
    }),
  );
  assert.deepEqual(parsed.filters.exchanges, ["NASDAQ", "NYSE"]);
});

test("rejects inverted ranges and unsafe route parameters", () => {
  assert.throws(() =>
    parseScreenerSearchParams(
      new URLSearchParams({ minPrice: "100", maxPrice: "20" }),
    ),
  );
  assert.throws(() =>
    securityParamsSchema.parse({ exchange: "nasdaq", symbol: "../../MSFT" }),
  );
  assert.deepEqual(seriesQuerySchema.parse({}), { group: "valuation", range: "1y" });
});

test("maps UI filter descriptors and reports unsupported filters", () => {
  const descriptors = [
    { id: "fair", field: "fairValueToPrice", operator: "gte", value: 1 },
    { id: "margin", field: "mispricing", operator: "gte", value: 0.2 },
    { id: "pe", field: "pe", operator: "lte", value: 15 },
    { id: "yield", field: "freeCashFlowYield", operator: "gte", value: 0.05 },
    { id: "growth", field: "revenueGrowth", operator: "gte", value: 0.1 },
    { id: "cash", field: "freeCashFlow", operator: "gt", value: 0 },
    { id: "debt", field: "debtToEquity", operator: "lte", value: 0.5 },
    { id: "margin", field: "marginStability5Y", operator: "eq", value: true },
    { id: "trend", field: "marginTrend", operator: "gt", value: 0 },
  ];
  const parsed = parseScreenerSearchParams(
    new URLSearchParams({ filters: JSON.stringify(descriptors) }),
  );
  assert.equal(parsed.filters.fairValueGtePrice, true);
  assert.equal(parsed.filters.minMispricing, 0.2);
  assert.equal(parsed.filters.maxPe, 15);
  assert.equal(parsed.filters.minFreeCashFlowYield, 0.05);
  assert.equal(parsed.filters.minRevenueGrowth, 10);
  assert.equal(parsed.filters.positiveFreeCashFlow, true);
  assert.equal(parsed.filters.maxDebtToEquity, 50);
  assert.equal(parsed.filters.stableOperatingMargins5Y, true);
  assert.equal(parsed.filters.expandingOperatingMargins5Y, true);
  assert.equal(parsed.filters.unsupported, undefined);
});

test("keeps retired direct filter fields available for API compatibility", () => {
  const parsed = parseScreenerSearchParams(
    new URLSearchParams({
      filters: JSON.stringify({
        fairValueGtePrice: false,
        minChangePercent: 0,
        maxChangePercent: 5,
        maxDebtToEquity: 50,
        maxPe: 15,
      }),
    }),
  );
  assert.equal(parsed.filters.minChangePercent, 0);
  assert.equal(parsed.filters.maxChangePercent, 5);
  assert.equal(parsed.filters.maxDebtToEquity, 50);
  assert.equal(parsed.filters.maxPe, 15);
});
