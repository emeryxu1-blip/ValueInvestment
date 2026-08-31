import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveScreenerView,
  FILTER_LIBRARY,
  filterMatchesSearch,
  filterScreenerStocks,
  isFilterSupportedBySnapshot,
  normalizeScreenerPayload,
  SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION,
  sortScreenerStocks,
  withRequiredUniverseFilters,
  withSnapshotCompatibleFilters,
} from "../components/screener/screener-data.ts";
import { SCREENER_FILTER_BITS } from "../lib/screener/filter-presets.ts";

const metric = (value) => ({
  value,
  source: "live",
  asOf: "2026-08-10T00:00:00.000Z",
});

function stock(symbol, options = {}) {
  return {
    marketCode: `185:${symbol}`,
    exchange: "nasdaq",
    symbol,
    company: options.company ?? symbol,
    filterMask: options.filterMask ?? 0,
    currency: options.currency ?? "USD",
    price: metric(options.price ?? 10),
    changePercent: metric(options.changePercent ?? 1),
    marketCap: metric(
      Object.hasOwn(options, "marketCap") ? options.marketCap : 1,
    ),
    fairValue: metric(options.fairValue ?? 20),
    mispricing: metric(options.mispricing ?? 1),
    pe: metric(options.pe ?? 10),
    revenueGrowth: metric(options.revenueGrowth ?? 10),
  };
}

const filterById = (id) => {
  const filter = FILTER_LIBRARY.find((candidate) => candidate.id === id);
  assert.ok(filter, `missing filter fixture ${id}`);
  return filter;
};

test("publishes the exact v3 plain-title and investing-formula catalog", () => {
  assert.deepEqual(
    FILTER_LIBRARY.map(({ id, label, shortLabel }) => [
      id,
      label,
      shortLabel,
    ]),
    [
      ["top-market-cap-1000", "Largest companies", "Market-cap rank ≤ 1,000"],
      ["us-major", "Major U.S. exchanges", "Exchange ∈ {NYSE, NASDAQ}"],
      ["technology", "Technology companies", "Sector contains Technology"],
      ["intrinsic-fair", "DCF value at least matches price", "Positive DCF value ÷ positive price ≥ 1.0×"],
      ["margin-20", "Meaningful DCF value gap", "DCF value ÷ positive price − 1 ≥ 20%"],
      ["pe-positive-15", "Profitable at a low multiple", "0 < P/E ≤ 15×"],
      ["fcf-yield-5", "Strong cash-flow yield", "TTM FCF ÷ market cap ≥ 5%"],
      ["ev-ebitda-below-10", "Low enterprise-value multiple", "0 < EV ÷ TTM EBITDA ≤ 10×"],
      ["positive-earnings", "Profitable business", "TTM net income > 0"],
      ["positive-fcf", "Positive cash generation", "TTM FCF > 0"],
      ["cash-conversion-80", "Earnings convert into cash", "Positive TTM FCF ÷ positive TTM net income ≥ 80%"],
      ["roic-15", "High returns on capital", "ROIC ≥ 15%"],
      ["net-debt-fcf-1-5", "Debt covered by cash flow", "Net debt ÷ positive TTM FCF ≤ 1.5×"],
      ["stable-margins", "Stable operating profitability", "5Y operating-margin range ≤ 5 pp"],
      ["revenue-growth", "Revenue growing", "TTM revenue growth ≥ 10%"],
      ["growing-margins", "Operating margins improving", "5Y margin slope > 0; latest > oldest"],
    ],
  );
  assert.equal(FILTER_LIBRARY.length, 16);
  assert.ok(FILTER_LIBRARY.every((filter) => filter.description === undefined));
  assert.ok(FILTER_LIBRARY.every((filter) => filter.category !== "Momentum"));
  assert.ok(FILTER_LIBRARY.every((filter) => filter.id !== "low-debt"));
});

test("matches normalized titles, formulas, symbols, and finance aliases", () => {
  assert.equal(filterMatchesSearch(filterById("fcf-yield-5"), "free cash flow"), true);
  assert.equal(filterMatchesSearch(filterById("fcf-yield-5"), "fcf / market cap >= 5%"), true);
  assert.equal(filterMatchesSearch(filterById("ev-ebitda-below-10"), "ev/ebitda"), true);
  assert.equal(filterMatchesSearch(filterById("pe-positive-15"), "price earnings <= 15"), true);
  assert.equal(filterMatchesSearch(filterById("net-debt-fcf-1-5"), "debt cash flow"), true);
  assert.equal(filterMatchesSearch(filterById("roic-15"), "roic"), true);
  assert.equal(filterMatchesSearch(filterById("us-major"), "exchange in nasdaq"), true);
  assert.equal(filterMatchesSearch(filterById("technology"), "NYSE"), false);
});

test("filters a complete client snapshot by precomputed membership bits", () => {
  const fair = SCREENER_FILTER_BITS["intrinsic-fair"];
  const cash = SCREENER_FILTER_BITS["positive-fcf"];
  const rows = [
    stock("BOTH", { filterMask: fair | cash }),
    stock("FAIR", { filterMask: fair }),
    stock("CASH", { filterMask: cash }),
  ];
  const filters = withRequiredUniverseFilters([
    filterById("intrinsic-fair"),
    filterById("positive-fcf"),
  ]);

  assert.deepEqual(
    filterScreenerStocks(rows, filters).map((row) => row.symbol),
    ["BOTH"],
  );
});

test("gates v2 and changed-v3 filters until a compatible snapshot is known", () => {
  const schemaTwoFilters = {
    "ev-ebitda-below-10": ["Valuation", "evToEbitda", "lte", 10],
    "cash-conversion-80": ["Quality", "cashConversion", "gte", 0.8],
    "roic-15": ["Quality", "returnOnInvestedCapital", "gte", 0.15],
    "net-debt-fcf-1-5": ["Quality", "netDebtToFreeCashFlow", "lte", 1.5],
  };

  for (const [filterId, descriptor] of Object.entries(schemaTwoFilters)) {
    const filter = filterById(filterId);
    assert.deepEqual(
      [filter.category, filter.field, filter.operator, filter.value],
      descriptor,
    );
    assert.equal(filter.minimumSnapshotSchemaVersion, 2);
    assert.equal(isFilterSupportedBySnapshot(filter, null), false);
    assert.equal(isFilterSupportedBySnapshot(filter, 1), false);
    assert.equal(isFilterSupportedBySnapshot(filter, 2), true);
    assert.equal(isFilterSupportedBySnapshot(filter, 3), true);
  }

  const schemaThreeFilters = {
    "margin-20": ["Valuation", "mispricing", "gte", 0.2],
    "pe-positive-15": ["Valuation", "pe", "lte", 15],
    "fcf-yield-5": ["Valuation", "freeCashFlowYield", "gte", 0.05],
  };
  for (const [filterId, descriptor] of Object.entries(schemaThreeFilters)) {
    const filter = filterById(filterId);
    assert.deepEqual(
      [filter.category, filter.field, filter.operator, filter.value],
      descriptor,
    );
    assert.equal(filter.minimumSnapshotSchemaVersion, 3);
    assert.equal(isFilterSupportedBySnapshot(filter, null), false);
    assert.equal(isFilterSupportedBySnapshot(filter, 2), false);
    assert.equal(isFilterSupportedBySnapshot(filter, 3), true);
  }

  assert.equal(isFilterSupportedBySnapshot(filterById("intrinsic-fair"), null), true);

  const savedDefinitions = withRequiredUniverseFilters([
    { id: "margin-10" },
    { id: "pe-below-15" },
    { id: "fcf-yield-4" },
    filterById("ev-ebitda-below-10"),
  ]);
  const savedIds = savedDefinitions.map((filter) => filter.id);
  assert.deepEqual(savedIds, [
    "top-market-cap-1000",
    "us-major",
    "margin-20",
    "pe-positive-15",
    "fcf-yield-5",
    "ev-ebitda-below-10",
  ]);
  assert.deepEqual(
    withSnapshotCompatibleFilters(savedDefinitions, null).map((filter) => filter.id),
    ["top-market-cap-1000", "us-major"],
  );
  assert.deepEqual(
    withSnapshotCompatibleFilters(savedDefinitions, 2).map((filter) => filter.id),
    ["top-market-cap-1000", "us-major", "ev-ebitda-below-10"],
  );
  assert.deepEqual(savedDefinitions.map((filter) => filter.id), savedIds);
});

test("combines the new primitive memberships locally", () => {
  const fcfYield = SCREENER_FILTER_BITS["fcf-yield-5"];
  const roic = SCREENER_FILTER_BITS["roic-15"];
  const rows = [
    stock("BOTH", { filterMask: fcfYield | roic }),
    stock("YIELD", { filterMask: fcfYield }),
    stock("ROIC", { filterMask: roic }),
  ];
  const filters = withRequiredUniverseFilters([
    filterById("fcf-yield-5"),
    filterById("roic-15"),
  ]);

  assert.deepEqual(
    filterScreenerStocks(rows, filters).map((row) => row.symbol),
    ["BOTH"],
  );
});

test("sorts locally with nulls last in both directions", () => {
  const rows = [
    stock("MISSING", { marketCap: null }),
    stock("LOW", { marketCap: 10 }),
    stock("HIGH", { marketCap: 100 }),
  ];

  assert.deepEqual(
    sortScreenerStocks(rows, "marketCap", "asc").map((row) => row.symbol),
    ["LOW", "HIGH", "MISSING"],
  );
  assert.deepEqual(
    sortScreenerStocks(rows, "marketCap", "desc").map((row) => row.symbol),
    ["HIGH", "LOW", "MISSING"],
  );
});

test("derives totals and clamps pagination without mutating the snapshot", () => {
  const fair = SCREENER_FILTER_BITS["intrinsic-fair"];
  const rows = [
    stock("THREE", { company: "Three", filterMask: fair }),
    stock("ONE", { company: "One", filterMask: fair }),
    stock("TWO", { company: "Two", filterMask: fair }),
  ];
  const originalOrder = rows.map((row) => row.symbol);
  const view = deriveScreenerView({
    rows,
    filters: withRequiredUniverseFilters([filterById("intrinsic-fair")]),
    sortKey: "company",
    sortOrder: "asc",
    page: 99,
    pageSize: 2,
  });

  assert.equal(view.total, 3);
  assert.equal(view.totalPages, 2);
  assert.equal(view.page, 2);
  assert.deepEqual(view.rows.map((row) => row.symbol), ["TWO"]);
  assert.deepEqual(rows.map((row) => row.symbol), originalOrder);
});

test("preserves the server filter mask while normalizing a snapshot", () => {
  const normalized = normalizeScreenerPayload(
    {
      status: "ready",
      data: [
        {
          marketCode: "185:MSFT",
          exchange: "nasdaq",
          symbol: "MSFT",
          company: { value: "Microsoft", source: "live", asOf: null },
          filterMask:
            SCREENER_FILTER_BITS["intrinsic-fair"] |
            SCREENER_FILTER_BITS.technology,
        },
      ],
      page: { page: 1, pageSize: 1000, total: 1, totalPages: 1 },
    },
    200,
  );

  assert.equal(normalized.rows.length, 1);
  assert.equal(
    normalized.rows[0].filterMask,
    SCREENER_FILTER_BITS["intrinsic-fair"] |
      SCREENER_FILTER_BITS.technology,
  );
});

test("preserves the provider-confirmed USD currency in compact snapshots", () => {
  const normalized = normalizeScreenerPayload(
    {
      schemaVersion: SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION,
      generationId: "daily-unknown-currency",
      asOf: "2026-08-10T03:17:00.000Z",
      total: 1,
      rows: [{
        marketCode: "185:MSFT",
        exchange: "nasdaq",
        symbol: "MSFT",
        company: "Microsoft",
        filterMask: SCREENER_FILTER_BITS.technology,
        currency: "USD",
        price: 525.4,
        changePercent: -0.4,
        marketCap: 3_900_000_000_000,
        fairValue: null,
        mispricing: null,
        pe: 37.2,
        revenueGrowth: 12,
      }],
    },
    200,
  );
  assert.equal(normalized.rows[0].currency, "USD");
});

test("normalizes the compact primitive snapshot contract", () => {
  const asOf = "2026-08-10T03:17:00.000Z";
  const normalized = normalizeScreenerPayload(
    {
      schemaVersion: SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION,
      generationId: "daily-2026-08-10",
      asOf,
      total: 1,
      rows: [
        {
          marketCode: "185:MSFT",
          exchange: "nasdaq",
          symbol: "MSFT",
          company: "Microsoft",
          filterMask: SCREENER_FILTER_BITS.technology,
          currency: "USD",
          price: 525.4,
          changePercent: -0.4,
          marketCap: 3_900_000_000_000,
          fairValue: null,
          mispricing: null,
          pe: 37.2,
          revenueGrowth: 12,
        },
      ],
    },
    200,
  );

  assert.equal(normalized.generationId, "daily-2026-08-10");
  assert.equal(normalized.schemaVersion, SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION);
  assert.equal(normalized.total, 1);
  assert.equal(normalized.rows[0].price.value, 525.4);
  assert.equal(normalized.rows[0].price.asOf, asOf);
  assert.equal(normalized.rows[0].price.unit, "USD");
  assert.equal(normalized.rows[0].fairValue.value, null);
  assert.equal(normalized.rows[0].mispricing.source, "derived");
  assert.equal(normalized.rows[0].revenueGrowth.value, 12);
  assert.equal(normalized.rows[0].revenueGrowth.unit, "%");
});

test("accepts a schema-two snapshot during the schema-three rollout", () => {
  const asOf = "2026-08-10T03:17:00.000Z";
  const normalized = normalizeScreenerPayload(
    {
      schemaVersion: 2,
      generationId: "daily-schema-two",
      asOf,
      total: 1,
      rows: [
        {
          marketCode: "185:MSFT",
          exchange: "nasdaq",
          symbol: "MSFT",
          company: "Microsoft",
          filterMask: SCREENER_FILTER_BITS.technology | (1 << 4),
          currency: "USD",
          price: 525.4,
          changePercent: -0.4,
          marketCap: 3_900_000_000_000,
          fairValue: null,
          mispricing: null,
          pe: 37.2,
          revenueGrowth: 12,
        },
      ],
    },
    200,
  );

  assert.equal(SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION, 3);
  assert.equal(normalized.schemaVersion, 2);
  assert.equal(normalized.rows.length, 1);
});

test("rejects unsupported or incomplete compact snapshot payloads", () => {
  assert.throws(
    () =>
      normalizeScreenerPayload(
        {
          schemaVersion: SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION + 1,
          generationId: "future-generation",
          asOf: "2026-08-10T03:17:00.000Z",
          total: 1,
          rows: [],
        },
        200,
      ),
    /unsupported format/,
  );

  assert.throws(
    () =>
      normalizeScreenerPayload(
        {
          schemaVersion: SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION,
          generationId: "incomplete-generation",
          asOf: "2026-08-10T03:17:00.000Z",
          total: 2,
          rows: [],
        },
        200,
      ),
    /unsupported format/,
  );
});
