import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveMispricing,
  derivePeerValue,
  medianPositive,
  parseDcfModule,
  parseEarningsRevenueModule,
  parseGrowthForecastModule,
  yyyymmddToIso,
} from "../lib/security/derivations.ts";
import { buildCashFlowBridge } from "../lib/security/bridges.ts";

test("derives valuation ratios without treating missing or zero price as valid", () => {
  assert.ok(Math.abs(deriveMispricing(120, 100) - 0.2) < 1e-12);
  assert.equal(deriveMispricing(null, 100), null);
  assert.equal(deriveMispricing(120, 0), null);
});

test("converts the live earnings/revenue module into quarterly and fiscal periods", () => {
  const data = [
    ["2024-09-30", "2025", "596003", "10", "2"],
    ["2024-12-31", "2025", "596004", "11", "3"],
    ["2025-03-31", "2025", "596005", "12", "4"],
    ["2025-06-30", "2025", "596006", "13", "5"],
  ].map(([end_date, year, period, operating_income_total, net_profit]) => ({
    end_date,
    year,
    period,
    operating_income_total,
    net_profit,
  }));
  const parsed = parseEarningsRevenueModule({ data });
  assert.equal(parsed.quarterly.length, 4);
  assert.deepEqual(parsed.annual[0], {
    period: "FY 2025",
    revenue: 46,
    netIncome: 14,
  });
});

test("uses only positive finite peer multiples and per-share fundamentals", () => {
  assert.equal(medianPositive([null, -2, 8, 10, Number.NaN]), 9);
  const peerValue = derivePeerValue({
    price: 100,
    pe: 20,
    pb: 5,
    ps: 10,
    peerPes: [24, 27, 30],
    peerPbs: [6, 7, 8],
    peerPss: [12, 14, 16],
  });
  // PE implies 135, PB 140, and PS 140; the canonical policy uses the median.
  assert.equal(peerValue, 140);
});

test("keeps only positive DCF predictions and selects the latest one", () => {
  const parsed = parseDcfModule({
    predicted_prices: [
      ["20250331", 110],
      ["20260331", 135],
      ["20261231", 0],
      ["20271231", -10],
      ["20251231", 125],
    ],
    history_prices: [["20250201", 98], ["20250101", 95]],
    latest_qfq_price: 99,
  });
  assert.equal(parsed.fairValue, 135);
  assert.equal(parsed.fairValuePeriod, "2026-03-31");
  assert.deepEqual(parsed.predicted, [
    ["20260331", 135],
    ["20251231", 125],
    ["20250331", 110],
  ]);
  assert.deepEqual(parsed.history, [["20250101", 95], ["20250201", 98]]);
  assert.equal(parsed.latestAdjustedPrice, 99);
  assert.equal(yyyymmddToIso("20260331"), "2026-03-31");
});

test("returns no provider DCF value when every prediction is nonpositive", () => {
  const parsed = parseDcfModule({
    predicted_prices: [["20261231", 0], ["20251231", -10]],
  });
  assert.equal(parsed.fairValue, null);
  assert.equal(parsed.fairValuePeriod, null);
  assert.deepEqual(parsed.predicted, []);
});

test("normalizes reported and forecast quarterly free cash flow", () => {
  const parsed = parseGrowthForecastModule({
    freecash: [["20250630", 20], ["20250331", "10"]],
    freecash_pred: [["20251231", 40], ["20250930", 30]],
  });
  assert.deepEqual(parsed, {
    reported: [["2025-03-31", 10], ["2025-06-30", 20]],
    forecast: [["2025-09-30", 30], ["2025-12-31", 40]],
  });
  assert.deepEqual(parseGrowthForecastModule(null), {
    reported: [],
    forecast: [],
  });
});

test("builds financial bridge semantics on the server boundary", () => {
  assert.equal(
    buildCashFlowBridge({
      period: "FY 2025",
      revenue: null,
      netIncome: 20,
      freeCashFlow: 18,
    }),
    null,
  );
  const bridge = buildCashFlowBridge({
    period: "FY 2025",
    revenue: 100,
    netIncome: 20,
    freeCashFlow: 18,
  });
  assert.equal(bridge.period, "FY 2025");
  assert.deepEqual(
    bridge.rows.map(({ label, value, from, to, kind }) => ({
      label,
      value,
      from,
      to,
      kind,
    })),
    [
      { label: "Revenue", value: 100, from: 0, to: 100, kind: "total" },
      {
        label: "Combined costs, interest & tax",
        value: -80,
        from: 100,
        to: 20,
        kind: "negative",
      },
      { label: "Net income", value: 20, from: 0, to: 20, kind: "total" },
      {
        label: "Cash conversion & reinvestment",
        value: -2,
        from: 20,
        to: 18,
        kind: "negative",
      },
      { label: "Free cash flow", value: 18, from: 0, to: 18, kind: "cash" },
    ],
  );
});
