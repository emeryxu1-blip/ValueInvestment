import type { BusinessQualityResponse } from "../contracts";
import type { ResolvedSecurity } from "../market-codes";
import {
  BUSINESS_QUALITY_MODEL_VERSION,
  calculateBusinessQuality,
  calculatePeerEconomics,
  medianFinite,
} from "./business-quality";
import { getSecurityAnalysis } from "./analysis";
import { getPeersResponse } from "./peers";
import { normalizeProfitabilitySnapshot } from "./profitability";
import { getSecuritySummary } from "./service";
import { MINIMUM_PEER_SAMPLE } from "./peer-selection.ts";
import { CompanyAnalysisUnsupportedError } from "./company-analysis-applicability.ts";

export async function getBusinessQualityResponse(
  resolved: ResolvedSecurity,
): Promise<BusinessQualityResponse> {
  const summary = await getSecuritySummary(resolved);
  if (!summary.applicability.companyAnalysis) {
    throw new CompanyAnalysisUnsupportedError(
      summary.applicability.reason ?? "Company analysis is unavailable.",
      summary.applicability.securityType,
    );
  }
  const [profitabilityPayload, peers] = await Promise.all([
    getSecurityAnalysis(resolved, "profitability"),
    getPeersResponse(resolved, undefined, "quality"),
  ]);
  const profitability = normalizeProfitabilitySnapshot(
    profitabilityPayload,
    resolved.exchange,
    resolved.symbol,
  );
  const analysis = calculateBusinessQuality(summary, profitability);
  const peerEconomics = calculatePeerEconomics(peers.peers);
  const peerMedianNetMargin = medianFinite(
    peerEconomics.map((peer) => peer.netMargin),
    MINIMUM_PEER_SAMPLE,
  );
  const peerMedianReturnOnEquity = medianFinite(
    peerEconomics.map((peer) => peer.returnOnEquity),
    MINIMUM_PEER_SAMPLE,
  );
  const netMarginGap =
    analysis.netMargin !== null && peerMedianNetMargin !== null
      ? analysis.netMargin - peerMedianNetMargin
      : null;

  return {
    summary,
    profitability,
    analysis,
    peerEconomics,
    peerMedians: {
      netMargin: peerMedianNetMargin,
      returnOnEquity: peerMedianReturnOnEquity,
    },
    peerComparison: {
      netMarginGap,
      selectionReason: peers.selectionReason ?? null,
      narrative:
        netMarginGap === null
          ? "Direct peer profitability data is unavailable for a reliable comparison."
          : netMarginGap >= 0
            ? `${resolved.symbol}'s displayed net margin is above the direct peer median.`
            : `${resolved.symbol}'s displayed net margin is below the direct peer median.`,
    },
    asOf: [summary.asOf, profitability.asOf, peers.asOf]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? new Date().toISOString(),
    modelVersion: BUSINESS_QUALITY_MODEL_VERSION,
  };
}
