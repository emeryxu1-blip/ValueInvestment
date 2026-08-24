import assert from "node:assert/strict";
import test from "node:test";

import {
  MINIMUM_PEER_SAMPLE,
  PEER_CANDIDATE_LIMIT,
  PEER_REQUEST_LIMIT,
  hasMinimumPeerCoverage,
  peerMarketCodeBatches,
  selectComparablePeerRows,
} from "../lib/security/peer-selection.ts";

const row = (symbolCode, marketCap, pe, ps, pb) => ({
  symbolCode,
  values: Object.fromEntries(
    Object.entries({
      marketCap,
      pe,
      ps,
      pb,
      sectorCode: "89:operating",
      companyAnalysisNetMargin: 0.1,
    }).map(([requestId, value]) => [
      requestId,
      {
        id: requestId,
        requestId,
        value,
        asOf: null,
        valueType: null,
        unit: null,
        rawUnit: null,
      },
    ]),
  ),
});

test("selects covered peers within a broad market-cap range and orders by scale", () => {
  const target = row("185:NVDA", 100_000, 20, 5, 4);
  const selected = selectComparablePeerRows(target, [
    row("185:AMD", 500, 10, 2, 2),
    row("185:ARM", 11_000_000, 10, 2, 2),
    row("185:INTC", 90_000, 10, null, null),
    row("185:MU", 50_000, 10, 2, 2),
    row("185:MRVL", 200_000, 10, 2, 2),
    row("185:QCOM", 2_000, -1, 2, 2),
  ]);

  assert.equal(MINIMUM_PEER_SAMPLE, 3);
  assert.deepEqual(
    selected.map((candidate) => candidate.symbolCode),
    ["185:MRVL", "185:MU", "185:QCOM"],
  );
});

test("bounds peer candidates and splits provider requests into stable batches", () => {
  const marketCodes = Array.from({ length: 130 }, (_, index) => `185:P${index}`);
  const batches = peerMarketCodeBatches(marketCodes);

  assert.equal(PEER_CANDIDATE_LIMIT, 100);
  assert.equal(PEER_REQUEST_LIMIT, 100);
  assert.deepEqual(batches.map((batch) => batch.length), [100]);
  assert.equal(batches.flat().at(-1), "185:P99");
});

test("excludes alternate share classes and selects quality peers by direct ratios", () => {
  const target = row("169:BRK.B", 1_000_000, 10, 2, 2);
  target.values.company = { value: "Berkshire Hathaway B" };
  const alternateClass = row("169:BRK.A", 1_000_000, 10, 2, 2);
  alternateClass.values.company = { value: "Berkshire Hathaway A" };
  const lossMaker = row("185:INTC", 500_000, -4, null, 1);
  lossMaker.values.company = { value: "Loss Maker" };
  lossMaker.values.netMargin = { value: -0.1 };
  lossMaker.values.returnOnEquity = { value: -0.2 };

  assert.deepEqual(selectComparablePeerRows(target, [alternateClass]), []);
  assert.deepEqual(
    selectComparablePeerRows(target, [lossMaker], 8, "quality").map(
      (candidate) => candidate.symbolCode,
    ),
    ["185:INTC"],
  );
});

test("deduplicates peer issuers and checks coverage per requested metric", () => {
  const target = row("185:META", 1_000_000, 20, 5, 4);
  target.values.company = { value: "Meta Platforms A" };
  const goog = row("185:GOOG", 900_000, 20, 5, 4);
  goog.values.company = { value: "Alphabet C" };
  const googl = row("185:GOOGL", 850_000, 21, 6, 5);
  googl.values.company = { value: "Alphabet A" };
  const bidu = row("185:BIDU", 300_000, 10, 2, 2);
  bidu.values.company = { value: "Baidu" };
  const selected = selectComparablePeerRows(target, [goog, googl, bidu]);

  assert.deepEqual(
    selected.map((candidate) => candidate.symbolCode),
    ["185:GOOG", "185:BIDU"],
  );
  assert.equal(hasMinimumPeerCoverage(selected, "valuation"), false);

  goog.values.netMargin = { value: 0.2 };
  bidu.values.returnOnEquity = { value: 0.1 };
  assert.equal(hasMinimumPeerCoverage([goog, bidu], "quality"), false);
});

test("excludes fund-like candidates even when the catalog labels them as equity", () => {
  const target = row("185:BEN", 100_000, 20, 5, 4);
  target.values.company = { value: "Franklin Resources" };
  const fund = row("185:CSQ", 50_000, 10, 2, 2);
  fund.values.company = { value: "Calamos Strategic Total Return Fund" };
  fund.values.industry = { value: "Asset Management" };
  fund.values.sectorCode = { value: "89:861212" };

  assert.deepEqual(selectComparablePeerRows(target, [fund]), []);
});
