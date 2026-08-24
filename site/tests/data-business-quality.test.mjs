import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateBusinessQuality,
  calculatePeerEconomics,
} from "../lib/security/business-quality.ts";
import { normalizeProfitabilitySnapshot } from "../lib/security/profitability.ts";

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
        },
        {
          period: "FY 2025",
          revenue: 100,
          netIncome: 20,
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
    /at least 15%/i,
  );
  assert.equal(analysis.earningsBridge.rows.at(-1).value, 18);
});

test("keeps supported numeric-string revenue and earnings history", () => {
  const data = [
    ["2024-09-30", "10", "2", "596003"],
    ["2024-12-31", "11", "3", "596004"],
    ["2025-03-31", "12", "4", "596005"],
    ["2025-06-30", "13", "5", "596006"],
  ].map(([end_date, operating_income_total, net_profit, period]) => ({
    end_date,
    year: "2025",
    period,
    operating_income_total,
    net_profit,
  }));
  const profitability = normalizeProfitabilitySnapshot(
    {
      metrics: {
        earningsRevenueModule: { value: { data } },
      },
    },
    "nasdaq",
    "nvda",
  );

  assert.deepEqual(profitability.history, [
    { period: "FY 2025", revenue: 46, netIncome: 14 },
  ]);
});

test("uses direct peer profitability ratios without inferring missing values", () => {
  const peers = calculatePeerEconomics([
    {
      symbol: "AAA",
      company: metric("Alpha"),
      netMargin: metric(0.2),
      returnOnEquity: metric(0.25),
      pe: metric(20),
      ps: metric(4),
      pb: metric(5),
    },
    {
      symbol: "BAD",
      company: metric("Missing"),
      netMargin: metric(null),
      returnOnEquity: metric(null),
      pe: metric(20),
      ps: metric(4),
      pb: metric(5),
    },
    {
      symbol: "NEG",
      company: metric("Cyclical"),
      netMargin: metric(-0.1),
      returnOnEquity: metric(-0.3),
      pe: metric(null),
      ps: metric(null),
      pb: metric(null),
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
  assert.equal(peers[2].netMargin, -0.1);
  assert.equal(peers[2].returnOnEquity, -0.3);
});

test("does not mix summary totals into a present profitability snapshot", () => {
  const summary = {
    quote: { marketCap: metric(1_000) },
    fundamentals: {
      revenue: metric(100),
      netIncome: metric(20),
      freeCashFlow: metric(18),
      debt: metric(100),
      cash: metric(25),
      roe: metric(22),
      pe: metric(10),
    },
    financials: { annual: [] },
  };
  const profitability = {
    quote: { marketCap: null },
    metrics: {
      revenue: null,
      netIncome: null,
      freeCashFlow: null,
      grossProfit: null,
      ebit: 20,
      ebitda: null,
      operatingCashFlow: null,
      grossMargin: null,
      operatingMargin: null,
      netMargin: null,
      ebitMargin: null,
      ebitdaMargin: null,
      freeCashFlowMargin: null,
      returnOnEquity: null,
      returnOnAssets: null,
      returnOnInvestedCapital: null,
      assetTurnover: null,
    },
    history: [],
  };

  const analysis = calculateBusinessQuality(summary, profitability);
  assert.equal(analysis.revenue, null);
  assert.equal(analysis.netIncome, null);
  assert.equal(analysis.freeCashFlow, null);
  assert.equal(analysis.operatingMargin, null);
  assert.equal(analysis.returnOnEquity, null);
});
