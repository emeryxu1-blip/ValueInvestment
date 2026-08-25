import type { BusinessQualityResponse } from "../contracts";
import type { ResolvedSecurity } from "../market-codes";
import type { ScreenerClientSnapshotPayload } from "../screener/client-snapshot-contract";
import { calculateBusinessQuality } from "./business-quality";
import { fallbackAnalysis } from "./fallback-analysis";
import { fallbackSecuritySummary } from "./fallback-summary";
import { normalizeProfitabilitySnapshot } from "./profitability";
import { BUSINESS_QUALITY_MODEL_VERSION } from "./business-quality";

export function fallbackBusinessQuality(
  resolved: ResolvedSecurity,
  snapshot: ScreenerClientSnapshotPayload,
): BusinessQualityResponse {
  const row = snapshot.rows.find(
    (candidate) => candidate.marketCode === resolved.marketCode,
  );
  if (!row) throw new Error("The stored screener snapshot has no matching security.");
  const summary = fallbackSecuritySummary(resolved, row, snapshot.asOf);
  const profitability = normalizeProfitabilitySnapshot(
    fallbackAnalysis(resolved, row, "profitability", snapshot.asOf),
    resolved.exchange,
    resolved.symbol,
  );
  const analysis = calculateBusinessQuality(summary, profitability);
  return {
    summary,
    profitability,
    analysis,
    peerEconomics: [],
    peerMedians: { netMargin: null, returnOnEquity: null },
    peerComparison: {
      netMarginGap: null,
      narrative: "Detailed peer profitability data is temporarily unavailable.",
      selectionReason: "Detailed peer profitability data is temporarily unavailable.",
    },
    asOf: snapshot.asOf,
    modelVersion: BUSINESS_QUALITY_MODEL_VERSION,
  };
}
