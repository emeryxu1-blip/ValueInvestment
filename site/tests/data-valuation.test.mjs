import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateCashFlowValue,
  calculateRelativeValuation,
  meanPositive,
  medianPositive,
  VALUATION_MODEL_VERSION,
  valuationScenarios,
} from "../lib/security/valuation.ts";
import { derivePeerValue } from "../lib/security/derivations.ts";

test("calculates the canonical five-year cash-flow model from validated inputs", () => {
  const model = calculateCashFlowValue(
    {
      startingCashFlow: 100,
      cash: 20,
      debt: 10,
      shares: 10,
    },
    {
      cashFlowGrowth: 0,
      discountRate: 10,
      terminalGrowth: 0,
    },
  );

  assert.ok(model);
  assert.equal(model.projections.length, 5);
  assert.ok(Math.abs(model.enterpriseValue - 1000) < 1e-9);
  assert.ok(Math.abs(model.equityValue - 1010) < 1e-9);
  assert.ok(Math.abs(model.perShare - 101) < 1e-9);
});

test("rejects unsafe DCF assumptions and never substitutes missing inputs", () => {
  assert.equal(
    calculateCashFlowValue(
      {
        startingCashFlow: 100,
        cash: Number.NaN,
        debt: 10,
        shares: 10,
      },
      {
        cashFlowGrowth: 5,
        discountRate: 9,
        terminalGrowth: 3,
      },
    ),
    null,
  );
  assert.equal(
    calculateCashFlowValue(
      {
        startingCashFlow: 100,
        cash: 20,
        debt: 10,
        shares: 10,
      },
      {
        cashFlowGrowth: 5,
        discountRate: 3,
        terminalGrowth: 3,
      },
    ),
    null,
  );
});

test("uses only positive finite comparisons and builds the canonical scenario range", () => {
  assert.equal(medianPositive([null, -4, 8, 12, Number.NaN]), 10);
  assert.equal(meanPositive([null, -4, 90, 120]), 105);
  assert.deepEqual(valuationScenarios(100), [
    { label: "Conservative", value: 80 },
    { label: "Base", value: 100 },
    { label: "Optimistic", value: 120 },
  ]);
  assert.deepEqual(valuationScenarios(null), []);
});

test("keeps summary peer value and versioned relative valuation on one aggregation policy", () => {
  const metric = (value) => ({
    label: "",
    value,
    asOf: null,
    valueType: "NUMBER",
    unit: null,
    rawUnit: null,
  });
  const metrics = {
    price: metric(100),
    marketCap: metric(10_000),
    sharesOutstanding: metric(100),
    eps: metric(5),
    revenue: metric(1_000),
    bookValuePerShare: metric(20),
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
  ];

  const summaryPeerValue = derivePeerValue({
    price: 100,
    pe: 20,
    pb: 5,
    ps: 10,
    peerPes: [24, 30],
    peerPbs: [6, 8],
    peerPss: [12, 16],
  });
  const valuation = calculateRelativeValuation({ metrics, peers });

  assert.equal(valuation.kind, "relative");
  assert.equal(valuation.aggregation, "mean-positive-implied-values");
  assert.equal(valuation.modelVersion, VALUATION_MODEL_VERSION);
  assert.deepEqual(
    valuation.measures.map((measure) => measure.impliedValue),
    [135, 140, 140],
  );
  assert.deepEqual(
    valuation.measures.map((measure) => measure.premiumDiscount),
    [20 / 27 - 1, 10 / 14 - 1, 5 / 7 - 1],
  );
  assert.ok(Math.abs(valuation.relativeValue - 415 / 3) < 1e-12);
  assert.equal(valuation.relativeValue, summaryPeerValue);
  assert.equal(valuation.baseValue, valuation.relativeValue);
  assert.ok(Math.abs(valuation.gap - 23 / 60) < 1e-12);
});
