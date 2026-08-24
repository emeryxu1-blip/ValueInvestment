import assert from "node:assert/strict";
import test from "node:test";

import {
  OPERATING_MARGIN_STABILITY_RANGE,
  summarizeOperatingMarginHistory,
} from "../lib/screener/operating-margins.ts";

function fiscalYear(year, operatingProfit, revenue = 100) {
  return {
    subject: {
      year: String(year),
      period: "FY",
      endDate: `${year}-12-31`,
    },
    operating_income_total: { value: String(revenue) },
    operating_profit: { value: String(operatingProfit) },
  };
}

test("derives stable and expanding five-year operating margins from unsorted fiscal years", () => {
  const summary = summarizeOperatingMarginHistory({
    data: [
      fiscalYear(2024, 23),
      fiscalYear(2021, 20),
      fiscalYear(2025, 24),
      fiscalYear(2023, 21),
      fiscalYear(2022, 22),
    ],
  });

  assert.deepEqual(summary.margins, [0.2, 0.22, 0.21, 0.23, 0.24]);
  assert.equal(summary.stable5Y, true);
  assert.ok(Math.abs(summary.trend5Y - 0.009) < 1e-12);
  assert.equal(summary.expanding5Y, true);
  assert.equal(summary.asOf, "2025-12-31");
});

test("treats an exact five-percentage-point range as stable", () => {
  const summary = summarizeOperatingMarginHistory({
    data: [20, 25, 22, 23, 24].map((profit, index) =>
      fiscalYear(2021 + index, profit),
    ),
  });

  assert.equal(OPERATING_MARGIN_STABILITY_RANGE, 0.05);
  assert.equal(summary.stable5Y, true);
});

test("returns null filters for incomplete, nonconsecutive, or invalid histories", () => {
  const incomplete = summarizeOperatingMarginHistory({
    data: [2021, 2022, 2023, 2024].map((year) => fiscalYear(year, 20)),
  });
  const nonconsecutive = summarizeOperatingMarginHistory({
    data: [2020, 2021, 2023, 2024, 2025].map((year) => fiscalYear(year, 20)),
  });
  const zeroRevenue = summarizeOperatingMarginHistory({
    data: [
      fiscalYear(2021, 20),
      fiscalYear(2022, 20),
      fiscalYear(2023, 20, 0),
      fiscalYear(2024, 20),
      fiscalYear(2025, 20),
    ],
  });
  const duplicateYear = summarizeOperatingMarginHistory({
    data: [
      ...[2021, 2022, 2023, 2024, 2025].map((year) => fiscalYear(year, 20)),
      fiscalYear(2023, 21),
    ],
  });

  for (const summary of [incomplete, nonconsecutive, zeroRevenue, duplicateYear]) {
    assert.equal(summary.stable5Y, null);
    assert.equal(summary.trend5Y, null);
    assert.equal(summary.expanding5Y, null);
  }
});

test("does not fall back to stale years when a recent fiscal year is invalid", () => {
  const summary = summarizeOperatingMarginHistory({
    data: [
      ...[2019, 2020, 2021, 2022, 2023, 2024].map((year) =>
        fiscalYear(year, 20),
      ),
      fiscalYear(2025, 20, 0),
    ],
  });

  assert.equal(summary.stable5Y, null);
  assert.equal(summary.trend5Y, null);
  assert.equal(summary.expanding5Y, null);
});

test("requires both a positive trend and endpoint improvement for expansion", () => {
  const summary = summarizeOperatingMarginHistory({
    data: [20, 10, 10, 50, 20].map((profit, index) =>
      fiscalYear(2021 + index, profit),
    ),
  });

  assert.ok(summary.trend5Y > 0);
  assert.equal(summary.margins.at(-1), summary.margins[0]);
  assert.equal(summary.expanding5Y, false);
});
