import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveMarketCode,
  routeExchangeForMarketCode,
  supportsCompanyAnalysis,
  symbolFromMarketCode,
  unsupportedCompanyAnalysisReason,
} from "../lib/market-codes.ts";
import {
  MARKET_CODE_BY_ROUTE,
  MARKET_CODE_CATALOG_AS_OF,
} from "../data/market-codes.generated.mjs";

test("resolves exchange and ticker through the generated catalog", () => {
  assert.deepEqual(resolveMarketCode("NASDAQ", "msft"), {
    exchange: "nasdaq",
    symbol: "MSFT",
    marketCode: "185:MSFT",
    companyName: "Microsoft",
    securityType: "ES",
    catalogAsOf: "2026-06-09",
  });
  assert.equal(resolveMarketCode("nyse", "JPM")?.marketCode, "169:JPM");
  assert.equal(resolveMarketCode("arca", "SPY")?.marketCode, "169:SPY");
  assert.equal(resolveMarketCode("nasdaq", "JPM"), null);
  assert.equal(resolveMarketCode("nasdaq", "NOT-A-REAL-SYMBOL"), null);
});

test("gates company analysis by catalog security type", () => {
  const common = resolveMarketCode("nasdaq", "MSFT");
  const fund = resolveMarketCode("arca", "SPY");
  assert.ok(common);
  assert.ok(fund);
  assert.equal(supportsCompanyAnalysis(common), true);
  assert.equal(supportsCompanyAnalysis(fund), false);
  assert.match(unsupportedCompanyAnalysisReason(fund), /security type CE/i);
});

test("keeps route metadata deterministic and distinguishes ARCA from NYSE", () => {
  assert.equal(MARKET_CODE_CATALOG_AS_OF, "2026-06-09");
  assert.ok(Object.keys(MARKET_CODE_BY_ROUTE).length > 12_000);
  assert.equal(routeExchangeForMarketCode("169:SPY"), "arca");
  assert.equal(routeExchangeForMarketCode("169:JPM"), "nyse");
  assert.equal(symbolFromMarketCode("185:MSFT"), "MSFT");
});
