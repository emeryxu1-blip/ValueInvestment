import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(path, import.meta.url), "utf8");

test("canonical research views expose an accessible calculation method", async () => {
  const [component, overview, valuation, quality, screener] = await Promise.all([
    source("../components/security/CalculationDisclosure.tsx"),
    source("../components/security/SecuritySummaryClient.tsx"),
    source("../components/security/ValueAnalysisClient.tsx"),
    source("../components/security/business-quality/BusinessQualityClient.tsx"),
    source("../components/screener/ScreenerClient.tsx"),
  ]);

  assert.match(component, /<details/);
  assert.match(component, /<summary>/);
  assert.match(component, /data-calculation-disclosure="true"/);

  assert.match(
    overview,
    /Implied value gap = selected value ÷ current price − 1/,
  );
  assert.match(
    overview,
    /Net margin = net income ÷ revenue · FCF margin = free cash flow ÷ revenue/,
  );
  assert.match(
    valuation,
    /Implied value gap = selected provider DCF per share ÷ analysis price − 1/,
  );
  assert.match(
    valuation,
    /Peer median × \(analysis price ÷ company multiple\)/,
  );
  assert.match(
    quality,
    /Score = round\(100 × earned points ÷ available points\)/,
  );
  assert.match(
    quality,
    /Cash conversion = FCF ÷ positive net income · FCF yield = FCF ÷ market cap/,
  );
  assert.doesNotMatch(
    screener,
    /results-method-disclosure/,
  );
});

test("collapsed calculation disclosures use the compact single-line treatment", async () => {
  const styles = await source("../app/security/research-shell.css");

  assert.match(
    styles,
    /\.calculation-disclosure > summary \{[\s\S]*?min-height: 42px;[\s\S]*?grid-template-columns: 24px minmax\(0, 1fr\) auto 14px;/,
  );
  assert.match(
    styles,
    /\.calculation-disclosure-heading \{[\s\S]*?display: flex;[\s\S]*?white-space: nowrap;/,
  );
  assert.match(
    styles,
    /\.calculation-disclosure-heading > span \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/,
  );
  assert.match(
    styles,
    /\.calculation-disclosure-badges \{[\s\S]*?flex-wrap: nowrap;[\s\S]*?overflow: hidden;/,
  );
});
