import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalChartTime,
  cursorBeforeTime,
  mergeChartPoints,
  normalizeChartCandles,
  normalizeChartPoints,
  normalizeChartPricePoints,
  referencePriceFromLines,
  timeToTimestamp,
} from "../lib/security/chart-series.ts";

test("selects the current intrinsic reference value for a horizontal line", () => {
  assert.equal(
    referencePriceFromLines([
      { seriesKind: "historical", points: [{ value: 100 }] },
      { seriesKind: "reference-overlay", points: [{ value: 44.9 }] },
    ]),
    44.9,
  );
  assert.equal(referencePriceFromLines([{ seriesKind: "historical", points: [{ value: 100 }] }]), null);
  assert.equal(referencePriceFromLines([{ seriesKind: "reference-overlay", points: [] }]), null);
  assert.equal(referencePriceFromLines([{ seriesKind: "reference-overlay", points: [{ value: 44 }, { value: 45 }] }]), null);
  assert.equal(referencePriceFromLines([{ seriesKind: "model-period", points: [{ value: 44.9 }] }]), null);
  assert.equal(referencePriceFromLines([{ seriesKind: "reference-overlay", points: [{ value: Number.NaN }] }]), null);
});

test("canonicalizes valid dates and rejects invalid calendar dates", () => {
  assert.equal(canonicalChartTime("2024-02-29"), "2024-02-29");
  assert.equal(canonicalChartTime("20240229"), "2024-02-29");
  assert.equal(canonicalChartTime("2024-02-30"), null);
  assert.equal(canonicalChartTime("20240230"), null);
  assert.equal(canonicalChartTime(20241301), null);
  assert.equal(canonicalChartTime("1720000000"), "2024-07-03");
  assert.equal(canonicalChartTime("1720000000000"), "2024-07-03");
  assert.equal(canonicalChartTime("8"), null);
  assert.equal(canonicalChartTime("2500-01-01"), null);
});

test("sorts, deduplicates, and accepts numeric-string line values", () => {
  assert.deepEqual(
    normalizeChartPoints([
      { time: "2024-01-03", value: "3.00" },
      { time: "2024-01-01", value: 1 },
      { time: "2024-01-03", value: "4.00" },
      { time: "not-a-date", value: 9 },
    ]),
    [
      { time: "2024-01-01", value: 1 },
      { time: "2024-01-03", value: 4 },
    ],
  );
});

test("accepts close-only K-line rows for the price chart", () => {
  assert.deepEqual(
    normalizeChartPricePoints([
      { time: "2024-01-02", timestamp: "not-a-time", close: 2 },
      { time: "2024-01-02", timestamp: 1704153600000, close: "3.5" },
      { time: "2024-01-01", close: "2.5" },
    ]),
    [
      { time: "2024-01-01", value: 2.5 },
      { time: "2024-01-02", value: 3.5 },
    ],
  );
});

test("requires complete OHLC only for candle consumers", () => {
  assert.deepEqual(
    normalizeChartCandles([
      { time: "2024-01-01", open: 1, high: 2, low: 0.5, close: "1.5" },
      { time: "2024-01-02", open: 1, high: null, low: 0.5, close: 1.5 },
    ]),
    [{ time: "2024-01-01", open: 1, high: 2, low: 0.5, close: 1.5, volume: null }],
  );
});

test("merges with newest duplicate observation winning", () => {
  assert.deepEqual(
    mergeChartPoints(
      [{ time: "2024-01-01", value: 1 }],
      [{ time: "2024-01-01", value: "2" }, { time: "2024-01-02", value: 3 }],
    ),
    [
      { time: "2024-01-01", value: 2 },
      { time: "2024-01-02", value: 3 },
    ],
  );
});

test("creates a strict inclusive-end cursor", () => {
  assert.equal(cursorBeforeTime("2024-01-01"), Date.parse("2023-12-31T23:59:59.999Z"));
  assert.equal(cursorBeforeTime(null), null);
  assert.equal(timeToTimestamp("20240131"), Date.parse("2024-01-31T00:00:00.000Z"));
  assert.equal(timeToTimestamp(20241301), null);
});
