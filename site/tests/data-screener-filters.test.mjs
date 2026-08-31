import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FILTERS,
  withRequiredUniverseFilters,
} from "../components/screener/screener-data.ts";

test("canonicalizes saved filters and restores both immutable universe rules", () => {
  const filters = withRequiredUniverseFilters([
    {
      id: "margin-10",
      category: "Valuation",
      label: "Legacy margin",
      shortLabel: "Legacy",
      field: "mispricing",
      operator: "gte",
      value: 0.1,
    },
    {
      id: "pe-below-15",
      category: "Valuation",
      label: "Legacy P/E",
      shortLabel: "Legacy",
      field: "pe",
      operator: "lt",
      value: 15,
    },
    {
      id: "fcf-yield-4",
      category: "Valuation",
      label: "Legacy FCF yield",
      shortLabel: "Legacy",
      field: "freeCashFlowYield",
      operator: "gte",
      value: 0.04,
    },
    {
      id: "up-today",
      category: "Momentum",
      label: "Retired momentum",
      shortLabel: "Retired",
      field: "changePercent",
      operator: "gte",
      value: 0,
    },
    {
      id: "low-debt",
      category: "Quality",
      label: "Retired debt-to-equity",
      shortLabel: "Retired",
      field: "debtToEquity",
      operator: "lte",
      value: 0.5,
    },
    {
      id: "stable-margins",
      category: "Quality",
      label: "Stale label",
      shortLabel: "Stale",
      field: "marginStability5Y",
      operator: "eq",
      value: true,
      available: false,
    },
    {
      id: "stable-margins",
      category: "Quality",
      label: "Duplicate",
      shortLabel: "Duplicate",
      field: "marginStability5Y",
      operator: "eq",
      value: true,
    },
  ]);

  assert.deepEqual(
    filters.map((filter) => filter.id),
    [
      "top-market-cap-1000",
      "us-major",
      "margin-20",
      "pe-positive-15",
      "fcf-yield-5",
      "stable-margins",
    ],
  );
  assert.deepEqual(
    filters.slice(2, 5).map((filter) => [filter.label, filter.shortLabel]),
    [
      ["Meaningful DCF value gap", "DCF value ÷ positive price − 1 ≥ 20%"],
      ["Profitable at a low multiple", "0 < P/E ≤ 15×"],
      ["Strong cash-flow yield", "TTM FCF ÷ market cap ≥ 5%"],
    ],
  );
  assert.equal(filters[5].available, undefined);
  assert.equal(filters[5].label, "Stable operating profitability");
  assert.deepEqual(
    DEFAULT_FILTERS.map((filter) => filter.id),
    ["top-market-cap-1000", "us-major", "intrinsic-fair"],
  );
});

test("falls back to required filters for malformed legacy storage", () => {
  assert.deepEqual(
    withRequiredUniverseFilters("not-an-array").map((filter) => filter.id),
    ["top-market-cap-1000", "us-major"],
  );
  assert.deepEqual(
    withRequiredUniverseFilters([null, {}, { id: "intrinsic-fair" }]).map(
      (filter) => filter.id,
    ),
    ["top-market-cap-1000", "us-major", "intrinsic-fair"],
  );
});
