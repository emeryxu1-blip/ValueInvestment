import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSummary } from "../components/security/data.ts";

test("preserves explicit company-analysis applicability without inventing valuation fields", () => {
  const summary = normalizeSummary(
    {
      applicability: {
        companyAnalysis: false,
        securityType: "CE",
        reason: "Company analysis is unavailable for this security type.",
      },
      identity: {
        exchange: "arca",
        symbol: "SPY",
        company: { value: "SPDR S&P 500 ETF Trust", source: "live", asOf: null },
        currency: "USD",
      },
      quote: {
        price: { value: 700, source: "live", asOf: null, unit: "USD" },
      },
      valuation: {
        dcfValue: { value: null, source: "live", asOf: null, unit: "USD" },
        peerValue: { value: null, source: "derived", asOf: null, unit: "USD" },
        fairValue: { value: null, source: "derived", asOf: null, unit: "USD" },
        mispricing: { value: null, source: "derived", asOf: null, unit: "ratio" },
        bearValue: 560,
        bullValue: 840,
      },
      asOf: "2026-08-12T00:00:00.000Z",
    },
    "arca",
    "spy",
  );

  assert.deepEqual(summary.applicability, {
    companyAnalysis: false,
    securityType: "CE",
    reason: "Company analysis is unavailable for this security type.",
  });
  assert.equal(summary.quote.price.value, 700);
  assert.deepEqual(Object.keys(summary.valuation).sort(), [
    "dcfValue",
    "fairValue",
    "mispricing",
    "peerValue",
  ]);
});
