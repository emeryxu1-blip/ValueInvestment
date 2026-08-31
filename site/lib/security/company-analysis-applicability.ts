import {
  numberValue,
  stringValue,
  type NormalizedSnapshotRow,
} from "../ainvest/normalize.ts";
import {
  supportsCompanyAnalysis,
  unsupportedCompanyAnalysisReason,
  type ResolvedSecurity,
} from "../market-codes.ts";

export type CompanyAnalysisApplicability = {
  companyAnalysis: boolean;
  securityType: string;
  reason: string | null;
};

export class CompanyAnalysisUnsupportedError extends Error {
  readonly securityType: string;

  constructor(reason: string, securityType: string) {
    super(reason);
    this.name = "CompanyAnalysisUnsupportedError";
    this.securityType = securityType;
  }
}

const NON_OPERATING_INDUSTRY_CODES = new Set(["89:861420"]);
const NON_OPERATING_INDUSTRY_NAMES = /special purpose acquisition|blank check/i;
const FUND_OR_COLLECTIVE_VEHICLE_NAME = /\b(?:fund|closed[- ]end)\b/i;
const NON_OPERATING_TRUST_NAME =
  /\b(?:royalty|income|floating[- ]rate|municipal|investment|credit|bond|dividend|equity|strategic)\b.*\btrust\b/i;

export function companyAnalysisApplicability(
  security: ResolvedSecurity,
  row: NormalizedSnapshotRow,
): CompanyAnalysisApplicability {
  if (!supportsCompanyAnalysis(security)) {
    return {
      companyAnalysis: false,
      securityType: security.securityType,
      reason: unsupportedCompanyAnalysisReason(security),
    };
  }

  const narrowIndustryCode = stringValue(row, "sectorCode");
  const industryCode =
    narrowIndustryCode ?? stringValue(row, "sectorGroupCode");
  if (!industryCode) {
    return {
      companyAnalysis: false,
      securityType: security.securityType,
      reason:
        "An operating-industry classification is unavailable, so company valuation and business-quality models are unavailable for this security.",
    };
  }

  const industryName = stringValue(row, "industry") ?? "";
  if (
    NON_OPERATING_INDUSTRY_CODES.has(narrowIndustryCode ?? "") ||
    NON_OPERATING_INDUSTRY_NAMES.test(industryName)
  ) {
    return {
      companyAnalysis: false,
      securityType: security.securityType,
      reason:
        "This security is classified as a special-purpose acquisition or other non-operating vehicle, so company valuation and business-quality models are unavailable.",
    };
  }

  const companyName =
    stringValue(row, "company") ?? security.companyName ?? security.symbol;
  const employeeCount = numberValue(row, "employeeCount");
  const assetManagementIndustry =
    narrowIndustryCode === "89:861212" || /asset management/i.test(industryName);
  const reitIndustry = /\bREITs?\b/i.test(industryName);
  const fundOrCollectiveVehicle =
    FUND_OR_COLLECTIVE_VEHICLE_NAME.test(companyName) ||
    (!reitIndustry && NON_OPERATING_TRUST_NAME.test(companyName)) ||
    (/\btrust\b/i.test(companyName) &&
      !reitIndustry &&
      (employeeCount === null || employeeCount <= 0));
  if (
    fundOrCollectiveVehicle ||
    (assetManagementIndustry &&
      (employeeCount === null || employeeCount <= 0))
  ) {
    return {
      companyAnalysis: false,
      securityType: security.securityType,
      reason:
        "Available legal-name, industry, and workforce inputs identify fund-like rather than operating-company economics, so valuation and business-quality results are withheld.",
    };
  }

  return {
    companyAnalysis: true,
    securityType: security.securityType,
    reason: null,
  };
}

export function assertCompanyAnalysisApplicable(
  security: ResolvedSecurity,
  row: NormalizedSnapshotRow,
): void {
  const applicability = companyAnalysisApplicability(security, row);
  if (!applicability.companyAnalysis) {
    throw new CompanyAnalysisUnsupportedError(
      applicability.reason ?? "Company analysis is unavailable.",
      applicability.securityType,
    );
  }
}
