import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAnalysisPeerSnapshotRequest,
  buildSecurityAnalysisRequest,
} from "../lib/ainvest/requests.ts";
import { normalizeSnapshot } from "../lib/ainvest/normalize.ts";
import {
  analysisMetricFromNormalized,
  analysisMetricsFromRow,
} from "../lib/security/analysis-normalize.ts";
import { analysisQuerySchema } from "../lib/validation.ts";

test("builds view-specific analysis requests with stable unique mapping keys", () => {
  const dcf = buildSecurityAnalysisRequest("185:NVDA", "dcf-valuation");
  const relative = buildSecurityAnalysisRequest(
    "185:NVDA",
    "relative-valuation",
  );
  const profitability = buildSecurityAnalysisRequest(
    "185:NVDA",
    "profitability",
  );

  for (const request of [dcf, relative, profitability]) {
    assert.deepEqual(request.symbol, [
      { type: "market_code", value: ["185:NVDA"] },
    ]);
    const keys = request.indicator.map((indicator) => indicator.req_unique_id);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(keys.includes("company"));
    assert.ok(keys.includes("price"));
    assert.ok(keys.includes("marketCap"));
  }

  assert.ok(
    dcf.indicator.some(
      (indicator) =>
        indicator.id === "stockdiag_fundamental_value_dcf" &&
        indicator.req_unique_id === "fairValueModule",
    ),
  );
  assert.ok(
    relative.indicator.some(
      (indicator) =>
        indicator.id === "ev_ebitda_ratio_ttm" &&
        indicator.req_unique_id === "evEbitda",
    ),
  );
  assert.ok(
    profitability.indicator.some(
      (indicator) =>
        indicator.id === "capital_invested_return_ratio_ttm" &&
        indicator.req_unique_id === "roic",
    ),
  );
});

test("builds raw comparable-company requests without server valuation outputs", () => {
  const request = buildAnalysisPeerSnapshotRequest([
    "185:MSFT",
    "185:AAPL",
  ]);
  assert.deepEqual(request.symbol[0].value, ["185:MSFT", "185:AAPL"]);
  assert.equal(request.page.count, 2);
  const keys = request.indicator.map((indicator) => indicator.req_unique_id);
  assert.ok(keys.includes("pe"));
  assert.ok(keys.includes("pb"));
  assert.ok(keys.includes("ps"));
  assert.ok(keys.includes("freeCashFlow"));
  assert.equal(keys.includes("peerMedian"), false);
  assert.equal(keys.includes("fairValue"), false);
});

test("analysis mapping preserves nulls, raw objects, ratio metadata, and response order", () => {
  const normalized = normalizeSnapshot({
    data: {
      indicator: [
        {
          id: "sale_gross_margin_ttm",
          req_unique_id: "grossMargin",
          attr: { value_type: "ratio2", unit: "x100" },
        },
        {
          id: "stockdiag_fundamental_value_dcf",
          req_unique_id: "fairValueModule",
        },
        { id: "pe_ttm", req_unique_id: "pe" },
      ],
      data: [
        {
          symbol_code: "185:NVDA",
          value: [
            { t: 1_720_000_000_000, v: null },
            { v: { fair_value: 180, history: [[20240101, 120]] } },
            { v: 31.4 },
          ],
        },
      ],
    },
  });
  const metrics = analysisMetricsFromRow(normalized.rows[0]);

  assert.equal(metrics.grossMargin.value, null);
  assert.equal(metrics.grossMargin.valueType, "ratio2");
  assert.equal(metrics.grossMargin.rawUnit, "x100");
  assert.equal(metrics.grossMargin.unit, "x100");
  assert.match(metrics.grossMargin.reason, /no current value/i);
  assert.deepEqual(metrics.fairValueModule.value, {
    fair_value: 180,
    history: [[20240101, 120]],
  });
  assert.equal(metrics.pe.value, 31.4);
  assert.deepEqual(Object.keys(metrics), [
    "grossMargin",
    "fairValueModule",
    "pe",
  ]);
});

test("analysis mapping returns an explicit null when an indicator is absent", () => {
  assert.deepEqual(analysisMetricFromNormalized("roic", undefined), {
    label: "Return on invested capital",
    value: null,
    asOf: null,
    valueType: null,
    unit: null,
    rawUnit: null,
    reason: "The requested metric was not returned.",
  });
});

test("validates only the three supported analysis views", () => {
  for (const view of [
    "dcf-valuation",
    "relative-valuation",
    "profitability",
  ]) {
    assert.equal(analysisQuerySchema.parse({ view }).view, view);
  }
  assert.throws(() => analysisQuerySchema.parse({ view: "summary" }));
  assert.throws(() => analysisQuerySchema.parse({}));
});
