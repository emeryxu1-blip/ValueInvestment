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

export async function getBusinessQualityResponse(
  resolved: ResolvedSecurity,
): Promise<BusinessQualityResponse> {
  const [summary, profitabilityPayload, peers] = await Promise.all([
    getSecuritySummary(resolved),
    getSecurityAnalysis(resolved, "profitability"),
    getPeersResponse(resolved),
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
  );
  const peerMedianReturnOnEquity = medianFinite(
    peerEconomics.map((peer) => peer.returnOnEquity),
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
      narrative:
        netMarginGap === null
          ? "More comparable inputs are needed to place the company against its peers."
          : netMarginGap >= 0
            ? `${resolved.symbol}'s displayed net margin is above the multiple-implied peer median.`
            : `${resolved.symbol}'s displayed net margin is below the multiple-implied peer median.`,
    },
    asOf: [summary.asOf, profitability.asOf, peers.asOf]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? new Date().toISOString(),
    modelVersion: BUSINESS_QUALITY_MODEL_VERSION,
  };
}
