import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSummary,
  providerNeutralText,
} from "../components/security/data.ts";

test("removes vendor and provider wording from user-facing text", () => {
  const text = providerNeutralText(
    "AInvest reports a Provider DCF value from the provider's model.",
  );

  assert.equal(
    text,
    "Reported figures show a DCF value from the valuation model.",
  );
  assert.doesNotMatch(text, /AInvest|provider/i);
});

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
        dcfValue: { value: null, source: "unknown", asOf: null, unit: "USD", reason: "DCF value is unavailable." },
        dcfModelPeriod: null,
        earningsPowerFloor: { value: null, source: "unknown", asOf: null, unit: "USD", reason: "Floor is unavailable." },
        peerValue: { value: null, source: "derived", asOf: null, unit: "USD" },
        fairValue: { value: null, source: "derived", asOf: null, unit: "USD" },
        mispricing: { value: null, source: "derived", asOf: null, unit: "ratio" },
        earningsPowerMethod: { id: "no-growth-earnings-power-floor", version: "test", requiredReturn: 0.1, earningsHaircut: 0.8, terminalGrowth: 0, description: "Test method" },
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
  assert.equal(summary.identity.currency, "USD");
  assert.equal(summary.quote.price.unit, "USD");
  assert.equal(summary.valuation.dcfValue.unit, "USD");
  assert.equal(summary.valuation.earningsPowerFloor.unit, "USD");
  assert.equal(summary.valuation.fairValue.unit, "USD");
  assert.deepEqual(Object.keys(summary.valuation).sort(), [
    "dcfModelPeriod",
    "dcfValue",
    "earningsPowerFloor",
    "earningsPowerMethod",
    "fairValue",
    "mispricing",
    "peerValue",
  ]);
});
