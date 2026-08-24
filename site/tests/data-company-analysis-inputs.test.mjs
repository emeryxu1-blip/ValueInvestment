import assert from "node:assert/strict";
import test from "node:test";

import { companyAnalysisApplicability } from "../lib/security/company-analysis-applicability.ts";

const security = (symbol, securityType = "ES") => ({
  exchange: "amex",
  symbol,
  marketCode: `170:${symbol}`,
  companyName: symbol,
  securityType,
  catalogAsOf: "2026-06-09",
});

const row = (values) => ({
  symbolCode: "170:TEST",
  values: Object.fromEntries(
    Object.entries(values).map(([requestId, value]) => [
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

test("requires operating-company evidence in addition to an equity security code", () => {
  assert.equal(
    companyAnalysisApplicability(
      security("NVDA"),
      row({ sectorCode: "89:861429", companyAnalysisNetMargin: 0.63 }),
    ).companyAnalysis,
    true,
  );
  assert.equal(
    companyAnalysisApplicability(
      security("BXMT"),
      row({
        company: "Blackstone Mortgage Trust",
        industry: "Mortgage REITs IV",
        sectorCode: "89:861216",
        employeeCount: 0,
      }),
    ).companyAnalysis,
    true,
  );
  assert.equal(
    companyAnalysisApplicability(
      security("FRT"),
      row({
        company: "Federal Realty Investment Trust",
        industry: "Retail REITs IV",
        sectorCode: "89:861218",
        employeeCount: 314,
      }),
    ).companyAnalysis,
    true,
  );
  for (const [symbol, company, employeeCount, margin] of [
    ["BENF", "Beneficient", 50, 4.21],
    ["BNC", "CEA Industries", 48, 4.36],
  ]) {
    assert.equal(
      companyAnalysisApplicability(
        security(symbol),
        row({
          company,
          industry: "Asset Management",
          sectorCode: "89:861212",
          employeeCount,
          companyAnalysisNetMargin: margin,
        }),
      ).companyAnalysis,
      true,
    );
  }
  assert.match(
    companyAnalysisApplicability(
      security("GRAF"),
      row({ sectorCode: null, companyAnalysisNetMargin: null }),
    ).reason,
    /operating-industry classification/,
  );
  assert.match(
    companyAnalysisApplicability(
      security("AEF"),
      row({
        company: "abrdn Emerging",
        industry: "Asset Management",
        sectorCode: "89:861212",
        companyAnalysisNetMargin: 14.7,
        employeeCount: null,
      }),
    ).reason,
    /fund-like/,
  );
  assert.match(
    companyAnalysisApplicability(
      security("CEV"),
      row({
        company: "Eaton Vance California Municipal Income Trust",
        industry: "Asset Management",
        sectorCode: "89:861212",
        companyAnalysisNetMargin: 1.43,
        employeeCount: null,
      }),
    ).reason,
    /fund-like/,
  );
  assert.match(
    companyAnalysisApplicability(
      security("AEXA"),
      row({
        company: "American Exceptionalism Acquisition",
        industry: "Special Purpose Acquisition Companies",
        sectorCode: "89:861420",
      }),
    ).reason,
    /special-purpose acquisition/,
  );
});

test("uses provider workforce evidence to distinguish operating trusts from vehicles", () => {
  assert.equal(
    companyAnalysisApplicability(
      security("NTRS"),
      row({
        company: "Northern Trust",
        industry: "Asset Management",
        sectorCode: "89:861212",
        employeeCount: 23_800,
        companyAnalysisNetMargin: 0.22,
      }),
    ).companyAnalysis,
    true,
  );
  for (const [symbol, company, sectorCode] of [
    ["MSDL", "Morgan Stanley Direct Lending Fund", "89:861276"],
    ["CRT", "Cross Timbers Royalty Trust", "89:861108"],
    ["MSB", "Mesabi Trust", "89:861350"],
  ]) {
    assert.equal(
      companyAnalysisApplicability(
        security(symbol),
        row({ company, sectorCode, employeeCount: 0 }),
      ).companyAnalysis,
      false,
    );
  }
  for (const [symbol, company, employeeCount] of [
    ["ACP", "abrdn Income Credit", null],
    ["BBDC", "Barings BDC", 0],
  ]) {
    assert.equal(
      companyAnalysisApplicability(
        security(symbol),
        row({
          company,
          industry: "Asset Management",
          sectorCode: "89:861212",
          employeeCount,
          companyAnalysisNetMargin: 0.5,
        }),
      ).companyAnalysis,
      false,
    );
  }
});

test("retains the catalog security-type gate", () => {
  const result = companyAnalysisApplicability(
    security("SPY", "CE"),
    row({ sectorCode: "89:fund", companyAnalysisNetMargin: 0.2 }),
  );
  assert.equal(result.companyAnalysis, false);
  assert.match(result.reason, /security type CE/);
});
