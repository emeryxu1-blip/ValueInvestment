import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateBusinessQuality,
  calculatePeerEconomics,
} from "../lib/security/business-quality.ts";

const metric = (value) => ({ value });

test("keeps business-quality ratios, tones, narratives, and bridge semantics server-owned", () => {
  const summary = {
    quote: {
      marketCap: metric(1_000),
    },
    fundamentals: {
      revenue: metric(100),
      netIncome: metric(20),
      freeCashFlow: metric(18),
      debt: metric(100),
      cash: metric(25),
      roe: metric(22),
      pe: metric(10),
    },
    financials: {
      annual: [
        {
          period: "FY 2024",
          revenue: 90,
          netIncome: 15,
          freeCashFlow: 14,
          debt: null,
          cash: null,
        },
        {
          period: "FY 2025",
          revenue: 100,
          netIncome: 20,
          freeCashFlow: 18,
          debt: null,
          cash: null,
        },
      ],
    },
  };
  const profitability = {
    quote: { marketCap: 1_000 },
    metrics: {
      grossMargin: 0.5,
      operatingMargin: 0.25,
      netMargin: 0.2,
      freeCashFlowMargin: 0.18,
      returnOnEquity: 0.22,
      returnOnAssets: 0.08,
      returnOnInvestedCapital: 0.16,
      revenue: 100,
      netIncome: 20,
      freeCashFlow: 18,
    },
    history: summary.financials.annual,
  };

  const analysis = calculateBusinessQuality(summary, profitability);
  assert.equal(analysis.netMargin, 0.2);
  assert.deepEqual(analysis.marginTones, {
    gross: "positive",
    operating: "positive",
    net: "positive",
    freeCashFlow: "positive",
  });
  assert.match(analysis.returnInterpretations.equity, /high return/i);
  assert.match(
    analysis.returnInterpretations.investedCapital,
    /above 15%/i,
  );
  assert.equal(analysis.earningsBridge.rows.at(-1).value, 18);
});

test("derives peer economics only from positive comparable multiples", () => {
  const peers = calculatePeerEconomics([
    {
      symbol: "AAA",
      company: metric("Alpha"),
      pe: metric(20),
      ps: metric(4),
      pb: metric(5),
    },
    {
      symbol: "BAD",
      company: metric("Missing"),
      pe: metric(-1),
      ps: metric(4),
      pb: metric(5),
    },
  ]);
  assert.deepEqual(peers[0], {
    symbol: "AAA",
    company: "Alpha",
    netMargin: 0.2,
    returnOnEquity: 0.25,
  });
  assert.equal(peers[1].netMargin, null);
  assert.equal(peers[1].returnOnEquity, null);
});
