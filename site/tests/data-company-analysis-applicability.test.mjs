import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogEntryForMarketCode,
  resolveMarketCode,
  supportsCompanyAnalysis,
  unsupportedCompanyAnalysisReason,
} from "../lib/market-codes.ts";
import {
  MARKET_CODE_BY_ROUTE,
  MARKET_CODE_CATALOG_AS_OF,
} from "../data/market-codes.generated.mjs";

const COMPANY_ANALYSIS_TYPES = new Set(["ES", "ED"]);

function catalogRoute(route) {
  const separator = route.indexOf(":");
  assert.notEqual(separator, -1, `catalog route ${route} must include an exchange`);
  return {
    exchange: route.slice(0, separator),
    symbol: route.slice(separator + 1),
  };
}

test("every generated catalog route resolves and round-trips uniquely", () => {
  const entries = Object.entries(MARKET_CODE_BY_ROUTE);
  const resolvedRoutes = new Set();
  const marketCodes = new Set();

  for (const [route, [marketCode, companyName, securityType]] of entries) {
    const { exchange, symbol } = catalogRoute(route);
    const resolved = resolveMarketCode(exchange, symbol);

    assert.ok(resolved, `expected ${route} to resolve`);
    assert.deepEqual(
      resolved,
      {
        exchange,
        symbol,
        marketCode,
        companyName,
        securityType,
        catalogAsOf: MARKET_CODE_CATALOG_AS_OF,
      },
      `resolved metadata drifted for ${route}`,
    );
    assert.deepEqual(
      catalogEntryForMarketCode(marketCode),
      resolved,
      `market code ${marketCode} did not round-trip to ${route}`,
    );

    const canonicalRoute = `${resolved.exchange}:${resolved.symbol}`;
    assert.equal(
      resolvedRoutes.has(canonicalRoute),
      false,
      `duplicate canonical catalog route ${canonicalRoute}`,
    );
    assert.equal(
      marketCodes.has(resolved.marketCode),
      false,
      `duplicate catalog market code ${resolved.marketCode}`,
    );
    resolvedRoutes.add(canonicalRoute);
    marketCodes.add(resolved.marketCode);
  }

  assert.equal(resolvedRoutes.size, entries.length);
  assert.equal(marketCodes.size, entries.length);
});

test("company analysis support is exhaustive by generated security type", () => {
  const catalogTypes = new Set();

  for (const [route, entry] of Object.entries(MARKET_CODE_BY_ROUTE)) {
    const { exchange, symbol } = catalogRoute(route);
    const resolved = resolveMarketCode(exchange, symbol);
    assert.ok(resolved, `expected ${route} to resolve`);

    catalogTypes.add(entry[2]);
    assert.equal(
      supportsCompanyAnalysis(resolved),
      COMPANY_ANALYSIS_TYPES.has(entry[2]),
      `unexpected company-analysis capability for ${route} (${entry[2]})`,
    );
  }

  assert.deepEqual(
    [...catalogTypes].sort(),
    ["CE", "DB", "DC", "ED", "EP", "ER", "ES", "EU", "M", "RW"],
  );
});

test("representative equities are supported and other instruments are not", () => {
  const cases = [
    ["nasdaq", "MSFT", "ES", true],
    ["nasdaq", "NVDA", "ES", true],
    ["arca", "SPY", "CE", false],
    ["amex", "BESS.WS", "RW", false],
    ["amex", "BCVPA", "EP", false],
    ["nasdaq", "ADAMG", "DB", false],
  ];

  for (const [exchange, symbol, securityType, supported] of cases) {
    const resolved = resolveMarketCode(exchange, symbol);
    assert.ok(resolved, `expected representative ${exchange}:${symbol} to resolve`);
    assert.equal(resolved.securityType, securityType);
    assert.equal(supportsCompanyAnalysis(resolved), supported);
  }
});

test("unsupported instruments receive an explicit capability reason", () => {
  const unsupportedTypes = new Map();

  for (const [route, entry] of Object.entries(MARKET_CODE_BY_ROUTE)) {
    if (COMPANY_ANALYSIS_TYPES.has(entry[2]) || unsupportedTypes.has(entry[2])) {
      continue;
    }
    const { exchange, symbol } = catalogRoute(route);
    const resolved = resolveMarketCode(exchange, symbol);
    assert.ok(resolved, `expected ${route} to resolve`);
    unsupportedTypes.set(entry[2], resolved);
  }

  for (const [securityType, security] of unsupportedTypes) {
    const reason = unsupportedCompanyAnalysisReason(security);
    assert.match(reason, /unavailable/i);
    assert.match(reason, new RegExp(`security type ${securityType}\\b`, "i"));
    assert.match(reason, /common and depositary equities/i);
  }
});
