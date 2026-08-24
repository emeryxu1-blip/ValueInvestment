import assert from "node:assert/strict";
import test from "node:test";

import {
  displayNumberValue,
  formatAInvestValue,
  normalizeKline,
  normalizeSeries,
  normalizeSnapshot,
  numberValue,
  ratioNumberValue,
  stringValue,
} from "../lib/ainvest/normalize.ts";

test("normalizes snapshot cells using returned indicator metadata order", () => {
  const payload = {
    data: {
      indicator: [
        { id: "change", req_unique_id: "changePercent", attr: { value_type: "ratio" } },
        { id: "55", req_unique_id: "company" },
        { id: "10", req_unique_id: "price", attr: { value_type: "price" } },
      ],
      data: [
        {
          symbol_code: "185:MSFT",
          value: [
            { t: 1_720_000_000_000, v: -1.25 },
            { v: "Microsoft" },
            { v: 420.5 },
          ],
        },
      ],
      page: { total: 91 },
    },
  };

  const normalized = normalizeSnapshot(payload);
  assert.equal(normalized.total, 91);
  assert.equal(numberValue(normalized.rows[0], "price"), 420.5);
  assert.equal(numberValue(normalized.rows[0], "changePercent"), -1.25);
  assert.equal(stringValue(normalized.rows[0], "company"), "Microsoft");
  assert.equal(normalized.rows[0].values.changePercent.unit, "%");
  assert.equal(formatAInvestValue(normalized.rows[0].values.changePercent), "-1.25%");
});

test("normalizes K-line fields by response field id", () => {
  const normalized = normalizeKline({
    data: {
      quote_data: [
        {
          market: "185",
          code: "MSFT",
          data_fields: ["13", "11", "1", "7", "9", "8"],
          value: [[1000, 420, 1_720_000_000_000, 415, 410, 425]],
        },
      ],
    },
  });
  assert.equal(normalized[0].marketCode, "185:MSFT");
  assert.deepEqual(normalized[0].points[0], {
    time: "2024-07-03",
    open: 415,
    high: 425,
    low: 410,
    close: 420,
    volume: 1000,
  });
});

test("preserves null snapshot values instead of coercing them to zero", () => {
  const normalized = normalizeSnapshot({
    data: {
      indicator: [{ id: "10", req_unique_id: "price" }],
      data: [{ symbol_code: "185:TEST", value: [{ v: null }] }],
    },
  });
  assert.equal(numberValue(normalized.rows[0], "price"), null);
  assert.equal(normalized.rows[0].values.price.value, null);
  assert.equal(formatAInvestValue(normalized.rows[0].values.price), "—");
});

test("formats ratio2 values as display percentages", () => {
  const normalized = normalizeSnapshot({
    data: {
      indicator: [
        { id: "debt_equity_ratio", req_unique_id: "debt", attr: { value_type: "ratio2" } },
      ],
      data: [{ symbol_code: "185:MSFT", value: [{ v: 0.097165 }] }],
    },
  });
  assert.equal(displayNumberValue(normalized.rows[0], "debt"), 9.7165);
  assert.equal(formatAInvestValue(normalized.rows[0].values.debt), "9.7165%");
});

test("normalizes provider ratio scales to fractions for calculations", () => {
  const normalized = normalizeSnapshot({
    data: {
      indicator: [
        {
          id: "sale_net_interest_ratio_ttm",
          req_unique_id: "netMargin",
          attr: { value_type: "ratio2", unit: "x100" },
        },
        {
          id: "index_weighted_avg_roe_ttm",
          req_unique_id: "returnOnEquity",
          attr: { value_type: "ratio2", unit: "x1000" },
        },
        {
          id: "already_fractional",
          req_unique_id: "fractional",
          attr: { value_type: "ratio2" },
        },
      ],
      data: [
        {
          symbol_code: "185:MSFT",
          value: [{ v: 20 }, { v: 250 }, { v: 0.18 }],
        },
      ],
    },
  });

  assert.equal(ratioNumberValue(normalized.rows[0], "netMargin"), 0.2);
  assert.equal(ratioNumberValue(normalized.rows[0], "returnOnEquity"), 0.25);
  assert.equal(ratioNumberValue(normalized.rows[0], "fractional"), 0.18);
});

test("normalizes reordered historical series by req_unique_id", () => {
  const normalized = normalizeSeries({
    data: {
      indicator: [
        { id: "balanced_eps_ttm", req_unique_id: "eps" },
        { id: "10", req_unique_id: "price" },
      ],
      data: [
        {
          symbol_code: "185:MSFT",
          value: [
            { value: [{ t: 1_720_000_000_000, v: 11.2 }] },
            { value: [{ t: 1_720_000_000_000, v: 420.5 }] },
          ],
        },
      ],
    },
  });
  assert.equal(normalized[0].values.eps.points[0].value, 11.2);
  assert.equal(normalized[0].values.price.points[0].value, 420.5);
});
