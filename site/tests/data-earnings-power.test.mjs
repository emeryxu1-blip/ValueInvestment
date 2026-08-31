import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateEarningsPowerFloor,
  EARNINGS_POWER_METHOD,
} from "../lib/security/intrinsic-value.ts";

test("ties the current NVDA earnings-power floor to the displayed value", () => {
  const result = calculateEarningsPowerFloor({
    freeCashFlow: 127_006_000_000,
    netIncome: 192_880_000_000,
    cash: 99_369_000_000,
    debt: 33_366_000_000,
    sharesOutstanding: 24_100_000_000,
  });

  assert.equal(result.earningsBase, 127_006_000_000);
  assert.equal(result.adjustedEarnings, 101_604_800_000);
  assert.ok(Math.abs(result.value - 44.898381742738586) < 1e-12);
  assert.equal(EARNINGS_POWER_METHOD.id, "no-growth-earnings-power-floor");
});

test("fails closed when required earnings-power inputs are invalid", () => {
  assert.equal(calculateEarningsPowerFloor({}).value, null);
  assert.match(calculateEarningsPowerFloor({ freeCashFlow: 0 }).reason, /free cash flow/i);
  assert.equal(calculateEarningsPowerFloor({
    freeCashFlow: 1,
    netIncome: 1,
    cash: 0,
    debt: 0,
    sharesOutstanding: 0,
  }).value, null);
});
