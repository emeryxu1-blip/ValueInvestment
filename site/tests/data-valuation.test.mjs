import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateDcfValuation,
  calculateRelativeValuation,
  medianPositive,
  opportunityLabel,
  positiveNumber,
  VALUATION_MODEL_VERSION,
} from "../lib/security/valuation.ts";
import { derivePeerValue } from "../lib/security/derivations.ts";

const metric = (value, asOf = null) => ({
  label: "",
  value,
  asOf,
  valueType: "NUMBER",
  unit: null,
  rawUnit: null,
});

test("uses only positive finite comparisons", () => {
  assert.equal(medianPositive([null, -4, 8, 12, Number.NaN]), 10);
  assert.equal(medianPositive([90, 120, 10_000]), 120);
  assert.equal(medianPositive([null, -1]), null);
  assert.equal(medianPositive([90, 120], 3), null);
});

test("uses AInvest DCF and quarterly free-cash-flow evidence without model assumptions", () => {
  const valuation = calculateDcfValuation({
    price: metric(100, "2026-03-20T00:00:00.000Z"),
    fairValueModule: metric({
      predicted_prices: [
        ["20250331", 110],
        ["20260331", 135],
        ["20251231", 125],
      ],
    }, "2026-03-18T00:00:00.000Z"),
    growthForecastModule: metric({
      freecash: [
        ["20250101", 50],
        ["20240401", 20],
        ["20241001", 40],
        ["20240101", 10],
        ["20240701", 30],
      ],
      freecash_pred: [
        ["20260101", 90],
        ["20250401", 60],
        ["20251001", 80],
        ["20250701", 70],
      ],
    }, "2026-03-17T00:00:00.000Z"),
  });

  assert.equal(valuation.kind, "dcf");
  assert.equal(valuation.method, "ainvest-dcf");
  assert.equal(valuation.providerValue, 135);
  assert.equal(valuation.baseValue, 135);
  assert.equal(valuation.price, 100);
  assert.ok(Math.abs(valuation.gap - 0.35) < 1e-12);
  assert.equal(valuation.opportunity, "Wide implied value gap");
  assert.equal(valuation.providerValuePeriod, "2026-03-31");
  assert.equal(valuation.providerValueAsOf, "2026-03-18T00:00:00.000Z");
  assert.equal(valuation.cashFlowAsOf, "2026-03-17T00:00:00.000Z");
  assert.equal(valuation.priceAsOf, "2026-03-20T00:00:00.000Z");
  assert.equal(valuation.cashFlow.latestReported, 50);
  assert.equal(valuation.cashFlow.trailingFourQuarter, 140);
  assert.equal(valuation.cashFlow.nextForecast, 60);
  assert.equal(valuation.cashFlow.forwardFourQuarter, 300);
  assert.ok(
    Math.abs(valuation.cashFlow.forwardGrowth - (300 / 140 - 1)) < 1e-12,
  );
  assert.deepEqual(valuation.cashFlow.reported[0], {
    period: "2024-01-01",
    value: 10,
  });
  assert.deepEqual(valuation.providerValuePeriods, [
    { period: "2025-03-31", value: 110 },
    { period: "2025-12-31", value: 125 },
    { period: "2026-03-31", value: 135 },
  ]);
  assert.equal(valuation.modelVersion, VALUATION_MODEL_VERSION);
  assert.equal("assumptions" in valuation, false);
  assert.equal("scenarios" in valuation, false);
});

test("uses exact unrounded value-gap boundaries and rejects nonpositive selected values", () => {
  assert.equal(opportunityLabel(0.2), "Wide implied value gap");
  assert.equal(opportunityLabel(0.199999), "Positive implied value gap");
  assert.equal(opportunityLabel(0), "Positive implied value gap");
  assert.equal(opportunityLabel(-0.000001), "Near indicated value");
  assert.equal(opportunityLabel(-0.1), "Near indicated value");
  assert.equal(opportunityLabel(-0.100001), "Price above indicated value");
  assert.equal(opportunityLabel(null), "Needs more evidence");
  assert.equal(positiveNumber(0), null);
  assert.equal(positiveNumber(-10), null);
  assert.equal(positiveNumber(10), 10);
});

test("selects the latest positive DCF date consistently across compact and ISO date formats", () => {
  const valuation = calculateDcfValuation({
    price: metric(100),
    fairValueModule: metric({
      predicted_prices: [
        ["2026-03-31", 130],
        ["20251231", 120],
        ["2026-12-31", 0],
        ["2027-12-31", -5],
        ["2027-06-30", 140],
      ],
    }),
  });

  assert.equal(valuation.providerValue, 140);
  assert.equal(valuation.providerValuePeriod, "2027-06-30");
  assert.deepEqual(valuation.providerValuePeriods, [
    { period: "2025-12-31", value: 120 },
    { period: "2026-03-31", value: 130 },
    { period: "2027-06-30", value: 140 },
  ]);
});

test("does not publish a nonpositive latest provider DCF value", () => {
  const valuation = calculateDcfValuation({
    price: metric(100),
    fairValueModule: metric({
      predicted_prices: [["20261231", 0], ["20251231", -10]],
    }),
  });

  assert.equal(valuation.providerValue, null);
  assert.equal(valuation.providerValuePeriod, null);
  assert.deepEqual(valuation.providerValuePeriods, []);
});

test("does not synthesize a DCF when provider modules are unavailable", () => {
  const valuation = calculateDcfValuation({
    price: metric(100),
    freeCashFlow: metric(1_000_000),
  });

  assert.equal(valuation.providerValue, null);
  assert.equal(valuation.baseValue, null);
  assert.equal(valuation.gap, null);
  assert.deepEqual(valuation.cashFlow.reported, []);
  assert.deepEqual(valuation.cashFlow.forecast, []);
  assert.deepEqual(valuation.providerValuePeriods, []);
});

test("keeps summary peer value and relative valuation on a robust share-class-safe policy", () => {
  const metrics = {
    price: metric(100),
    marketCap: metric(10_000),
    sharesOutstanding: metric(1),
    eps: metric(10_000),
    revenue: metric(1),
    bookValuePerShare: metric(1_000_000),
    pe: metric(20),
    ps: metric(10),
    pb: metric(5),
  };
  const peers = [
    {
      marketCode: "185:AAA",
      exchange: "nasdaq",
      symbol: "AAA",
      company: "AAA",
      metrics: { pe: metric(24), ps: metric(12), pb: metric(6) },
    },
    {
      marketCode: "185:BBB",
      exchange: "nasdaq",
      symbol: "BBB",
      company: "BBB",
      metrics: { pe: metric(30), ps: metric(16), pb: metric(8) },
    },
    {
      marketCode: "185:CCC",
      exchange: "nasdaq",
      symbol: "CCC",
      company: "CCC",
      metrics: { pe: metric(27), ps: metric(14), pb: metric(7) },
    },
  ];

  const summaryPeerValue = derivePeerValue({
    price: 100,
    pe: 20,
    pb: 5,
    ps: 10,
    peerPes: [24, 27, 30],
    peerPbs: [6, 7, 8],
    peerPss: [12, 14, 16],
  });
  const valuation = calculateRelativeValuation({ metrics, peers });

  assert.equal(valuation.kind, "relative");
  assert.equal(valuation.aggregation, "median-positive-implied-values");
  assert.equal(valuation.modelVersion, VALUATION_MODEL_VERSION);
  assert.deepEqual(
    valuation.measures.map((measure) => measure.denominatorPerShare),
    [5, 10, 20],
  );
  assert.deepEqual(
    valuation.measures.map((measure) => measure.impliedValue),
    [135, 140, 140],
  );
  assert.deepEqual(
    valuation.measures.map((measure) => measure.premiumDiscount),
    [20 / 27 - 1, 10 / 14 - 1, 5 / 7 - 1],
  );
  assert.deepEqual(
    valuation.measures.map((measure) => measure.peerSampleSize),
    [3, 3, 3],
  );
  assert.equal(valuation.relativeValue, 140);
  assert.equal(valuation.relativeValue, summaryPeerValue);
  assert.equal(valuation.baseValue, valuation.relativeValue);
  assert.ok(Math.abs(valuation.gap - 0.4) < 1e-12);
  assert.equal("scenarios" in valuation, false);
});
