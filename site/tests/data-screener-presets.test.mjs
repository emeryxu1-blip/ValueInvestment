import assert from "node:assert/strict";
import test, { after } from "node:test";

import { register } from "tsx/esm/api";

const typescript = register({ namespace: "screener-preset-data-tests" });
const {
  FILTER_LIBRARY,
  isRequiredUniverseFilter,
} = await typescript.import(
  "../components/screener/screener-data.ts",
  import.meta.url,
);
const {
  matchesScreenerFilterMask,
  SCREENER_FILTER_BITS,
  SCREENER_FILTER_MASK_RETIRED_BITS,
  SCREENER_FILTER_MASK_SCHEMA_VERSION,
  SCREENER_FILTER_MASK_V1_ALL_BITS,
  SCREENER_FILTER_MASK_V2_ALL_BITS,
  SCREENER_FILTER_MASK_V3_ALL_BITS,
  screenerFilterMaskAllBitsForSchema,
  screenerFilterMask,
  selectedScreenerFilterMask,
} = await typescript.import(
  "../lib/screener/filter-presets.ts",
  import.meta.url,
);
const { applyScreenerFilters } = await typescript.import(
  "../lib/screener/service.ts",
  import.meta.url,
);
const { parseScreenerSearchParams } = await typescript.import(
  "../lib/validation.ts",
  import.meta.url,
);

after(async () => {
  await typescript.unregister();
});

const metric = (value, source = "live") => ({
  value,
  source,
  asOf: "2026-08-10T00:00:00.000Z",
});

function presetRow(symbol, overrides = {}) {
  const row = {
    marketCode: `185:${symbol}`,
    exchange: "nasdaq",
    symbol,
    company: metric(`Company ${symbol}`),
    price: metric(100),
    changePercent: metric(0),
    marketCap: metric(1_000_000_000),
    fairValue: metric(100),
    mispricing: metric(0.2, "derived"),
    pe: metric(15),
    revenueGrowth: metric(10),
    netIncome: metric(62_500_000),
    freeCashFlow: metric(50_000_000),
    evToEbitda: metric(10),
    returnOnInvestedCapital: metric(15),
    netDebt: metric(75_000_000),
    debtToEquity: metric(50),
    operatingMarginStable5Y: metric(true, "derived"),
    operatingMarginTrend5Y: metric(0.01, "derived"),
    operatingMarginsExpanding5Y: metric(true, "derived"),
    sector: metric("Technology"),
    currency: "USD",
  };
  for (const [field, value] of Object.entries(overrides)) {
    if (field === "exchange") row.exchange = value;
    else if (field === "symbol") row.symbol = value;
    else if (field === "company") row.company = metric(value);
    else if (field === "sector") row.sector = metric(value);
    else if (field in row && row[field]?.source) {
      row[field] = metric(
        value,
        field.startsWith("operatingMargin") || field === "mispricing"
          ? "derived"
          : "live",
      );
    }
  }
  return {
    ...row,
    filterMask: screenerFilterMask(row),
  };
}

const failingOverrides = {
  technology: { sector: "Industrials" },
  "intrinsic-fair": { fairValue: 99.99 },
  "margin-20": { mispricing: 0.1999 },
  "pe-positive-15": { pe: 15.01 },
  "positive-earnings": { netIncome: 0 },
  "positive-fcf": { freeCashFlow: 0 },
  "stable-margins": { operatingMarginStable5Y: false },
  "revenue-growth": { revenueGrowth: 9.99 },
  "growing-margins": { operatingMarginsExpanding5Y: false },
  "fcf-yield-5": { freeCashFlow: 49_999_999 },
  "ev-ebitda-below-10": { evToEbitda: 10.01 },
  "cash-conversion-80": { netIncome: 62_500_001 },
  "roic-15": { returnOnInvestedCapital: 14.99 },
  "net-debt-fcf-1-5": { netDebt: 75_000_001 },
};

const newPrimitiveBits = {
  "margin-20": 2,
  "pe-positive-15": 3,
  "fcf-yield-5": 12,
  "ev-ebitda-below-10": 13,
  "cash-conversion-80": 14,
  "roic-15": 15,
  "net-debt-fcf-1-5": 16,
};

test("the precomputed bit catalog covers every selectable UI preset exactly", () => {
  const selectableIds = FILTER_LIBRARY.filter(
    (filter) => !isRequiredUniverseFilter(filter.id),
  )
    .map((filter) => filter.id)
    .sort();
  assert.deepEqual(Object.keys(SCREENER_FILTER_BITS).sort(), selectableIds);
  assert.deepEqual(Object.keys(failingOverrides).sort(), selectableIds);
  assert.equal(
    new Set(Object.values(SCREENER_FILTER_BITS)).size,
    selectableIds.length,
  );
  assert.equal(SCREENER_FILTER_MASK_SCHEMA_VERSION, 3);
  for (const [filterId, bitIndex] of Object.entries(newPrimitiveBits)) {
    const bit = SCREENER_FILTER_BITS[filterId];
    assert.equal(bit, 2 ** bitIndex);
    assert.equal(bit & (bit - 1), 0, `${filterId} must use one primitive bit`);
  }
});

test("schema three retains legacy mask validation without writing retired bits", () => {
  assert.equal(SCREENER_FILTER_MASK_V1_ALL_BITS, 4095);
  assert.equal(SCREENER_FILTER_MASK_V2_ALL_BITS, 131071);
  assert.equal(SCREENER_FILTER_MASK_RETIRED_BITS, 304);
  assert.equal(
    SCREENER_FILTER_MASK_V3_ALL_BITS,
    SCREENER_FILTER_MASK_V2_ALL_BITS & ~SCREENER_FILTER_MASK_RETIRED_BITS,
  );
  assert.equal(screenerFilterMaskAllBitsForSchema(0), 4095);
  assert.equal(screenerFilterMaskAllBitsForSchema(1), 4095);
  assert.equal(screenerFilterMaskAllBitsForSchema(2), 131071);
  assert.equal(
    screenerFilterMaskAllBitsForSchema(3),
    SCREENER_FILTER_MASK_V3_ALL_BITS,
  );
  assert.equal(screenerFilterMaskAllBitsForSchema(4), null);
  assert.equal(
    presetRow("NO-RETIRED-BITS", {
      changePercent: 0,
      debtToEquity: 0,
    }).filterMask & SCREENER_FILTER_MASK_RETIRED_BITS,
    0,
  );
});

test("schema-three changed predicates honor exact boundaries", () => {
  const marginBit = SCREENER_FILTER_BITS["margin-20"];
  const peBit = SCREENER_FILTER_BITS["pe-positive-15"];
  const yieldBit = SCREENER_FILTER_BITS["fcf-yield-5"];

  assert.notEqual(presetRow("MOS-BOUNDARY", { mispricing: 0.2 }).filterMask & marginBit, 0);
  assert.equal(presetRow("MOS-BELOW", { mispricing: 0.2 - 1e-12 }).filterMask & marginBit, 0);
  assert.notEqual(presetRow("PE-BOUNDARY", { pe: 15 }).filterMask & peBit, 0);
  for (const pe of [15 + 1e-12, 0, -1, Number.NaN, null]) {
    assert.equal(presetRow(`PE-FAIL-${String(pe)}`, { pe }).filterMask & peBit, 0);
  }
  assert.notEqual(
    presetRow("YIELD-BOUNDARY", { freeCashFlow: 50_000_000 }).filterMask & yieldBit,
    0,
  );
  assert.equal(
    presetRow("YIELD-BELOW", { freeCashFlow: 49_999_999 }).filterMask & yieldBit,
    0,
  );
});

for (const [filterId, failOverrides] of Object.entries(failingOverrides)) {
  test(`precomputed ${filterId} membership matches the canonical backend filter`, () => {
    const descriptor = FILTER_LIBRARY.find((filter) => filter.id === filterId);
    assert.ok(descriptor, `missing UI filter ${filterId}`);
    const search = new URLSearchParams({
      filters: JSON.stringify([descriptor]),
      pageSize: "1000",
    });
    const serverFilters = parseScreenerSearchParams(search).filters;
    const passing = presetRow(`${filterId}-PASS`);
    const failing = presetRow(`${filterId}-FAIL`, failOverrides);
    const bit = SCREENER_FILTER_BITS[filterId];
    const selectedMask = selectedScreenerFilterMask([filterId]);

    assert.equal(selectedMask, bit);
    assert.equal(matchesScreenerFilterMask(passing.filterMask, selectedMask), true);
    assert.equal(matchesScreenerFilterMask(failing.filterMask, selectedMask), false);
    assert.deepEqual(
      applyScreenerFilters([passing, failing], serverFilters).map(
        (row) => row.symbol,
      ),
      [passing.symbol],
    );
  });
}

test("unknown and required universe ids cannot accidentally select a data bit", () => {
  assert.equal(
    selectedScreenerFilterMask([
      "top-market-cap-1000",
      "us-major",
      "up-today",
      "down-today",
      "low-debt",
      "not-a-filter",
    ]),
    0,
  );
});

test("new value filters fail closed on invalid or nonpositive inputs", () => {
  const cases = [
    ["fcf-yield-5", { marketCap: 0 }],
    ["fcf-yield-5", { freeCashFlow: 0 }],
    ["ev-ebitda-below-10", { evToEbitda: 0 }],
    ["ev-ebitda-below-10", { evToEbitda: -1 }],
    ["cash-conversion-80", { netIncome: 0 }],
    ["cash-conversion-80", { freeCashFlow: 0 }],
    ["roic-15", { returnOnInvestedCapital: null }],
    ["net-debt-fcf-1-5", { freeCashFlow: 0 }],
  ];

  for (const [filterId, overrides] of cases) {
    const row = presetRow(`${filterId}-INVALID`, overrides);
    assert.equal(
      (row.filterMask & SCREENER_FILTER_BITS[filterId]) !== 0,
      false,
      `${filterId} must fail for ${JSON.stringify(overrides)}`,
    );
  }
});

test("net-cash companies pass the net-debt ceiling when the provider returns a signed value", () => {
  const row = presetRow("NET-CASH", { netDebt: -1 });
  assert.notEqual(
    row.filterMask & SCREENER_FILTER_BITS["net-debt-fcf-1-5"],
    0,
  );
});
