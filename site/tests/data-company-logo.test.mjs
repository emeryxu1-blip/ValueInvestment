import assert from "node:assert/strict";
import test from "node:test";

import { companyLogoUrl } from "../lib/company-logo.ts";

test("builds deterministic company-logo URLs for supported ticker punctuation", () => {
  assert.equal(
    companyLogoUrl("nvda"),
    "https://cdn.ainvest.com/icon/us/NVDA.png",
  );
  assert.equal(
    companyLogoUrl(" brk.b "),
    "https://cdn.ainvest.com/icon/us/BRK.B.png",
  );
  assert.equal(companyLogoUrl(""), null);
});
