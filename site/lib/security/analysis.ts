import type {
  AnalysisPeer,
  SecurityAnalysisResponse,
  SecurityAnalysisView,
} from "../contracts";
import { fetchAInvest } from "../ainvest/client";
import {
  normalizeSnapshot,
  stringValue,
  type NormalizedSnapshotRow,
} from "../ainvest/normalize";
import {
  buildAnalysisPeerSnapshotRequest,
  buildRelationRequest,
  buildSecurityAnalysisRequest,
} from "../ainvest/requests";
import {
  catalogEntryForMarketCode,
  supportsCompanyAnalysis,
  symbolFromMarketCode,
  type ResolvedSecurity,
} from "../market-codes";
import { analysisMetricsFromRow } from "./analysis-normalize";
import {
  calculateDcfValuation,
  calculateRelativeValuation,
} from "./valuation";
import {
  MINIMUM_PEER_SAMPLE,
  PEER_CANDIDATE_LIMIT,
  hasMinimumPeerCoverage,
  peerMarketCodeBatches,
  selectComparablePeerRows,
} from "./peer-selection.ts";
import { assertCompanyAnalysisApplicable } from "./company-analysis-applicability.ts";

function peerFromRow(row: NormalizedSnapshotRow): AnalysisPeer {
  const catalog = catalogEntryForMarketCode(row.symbolCode);
  return {
    marketCode: row.symbolCode,
    exchange: catalog?.exchange ?? "",
    symbol: catalog?.symbol ?? symbolFromMarketCode(row.symbolCode),
    company: stringValue(row, "company") ?? catalog?.companyName ?? null,
    metrics: analysisMetricsFromRow(row),
  };
}

async function relatedMarketCodes(
  resolved: ResolvedSecurity,
  sectorCode: string,
): Promise<string[]> {
  const relation = (await fetchAInvest(
    "relation",
    buildRelationRequest(sectorCode),
  )) as {
    data?: { data?: Array<{ v?: unknown }> };
  };
  const seen = new Set<string>();
  return (relation.data?.data ?? [])
    .map((item) => item.v)
    .filter((value): value is string => typeof value === "string")
    .filter((value) => {
      if (value === resolved.marketCode || seen.has(value)) return false;
      seen.add(value);
      const candidate = catalogEntryForMarketCode(value);
      return candidate !== null && supportsCompanyAnalysis(candidate);
    })
    .slice(0, PEER_CANDIDATE_LIMIT);
}

async function analysisPeerRows(
  marketCodes: string[],
): Promise<NormalizedSnapshotRow[]> {
  const payloads = await Promise.all(
    peerMarketCodeBatches(marketCodes).map((batch) =>
      fetchAInvest("snapshot", buildAnalysisPeerSnapshotRequest(batch)),
    ),
  );
  return payloads.flatMap((payload) => normalizeSnapshot(payload).rows);
}

async function getRelativePeers(
  resolved: ResolvedSecurity,
  row: NormalizedSnapshotRow,
): Promise<{ peers: AnalysisPeer[]; peerReason?: string }> {
  const industryCode = stringValue(row, "sectorCode");
  const sectorGroupCode = stringValue(row, "sectorGroupCode");
  if (!industryCode && !sectorGroupCode) {
    return {
      peers: [],
      peerReason: "No supported industry relationship was returned.",
    };
  }
  const primaryCodes = industryCode
    ? await relatedMarketCodes(resolved, industryCode)
    : [];
  let candidateRows = await analysisPeerRows(primaryCodes);
  let selectedRows = selectComparablePeerRows(row, candidateRows);
  let usedBroaderSectorGroup = false;
  if (
    !hasMinimumPeerCoverage(selectedRows, "valuation") &&
    sectorGroupCode &&
    sectorGroupCode !== industryCode
  ) {
    usedBroaderSectorGroup = true;
    const seen = new Set(primaryCodes);
    const broaderCodes = (await relatedMarketCodes(resolved, sectorGroupCode))
      .filter((marketCode) => !seen.has(marketCode));
    candidateRows = [...candidateRows, ...(await analysisPeerRows(broaderCodes))];
    selectedRows = selectComparablePeerRows(row, candidateRows);
  }
  const hasCoverage = hasMinimumPeerCoverage(selectedRows, "valuation");
  const reasons = [
    ...(usedBroaderSectorGroup
      ? [
          "The industry peer set was too thin, so the displayed comparables also include companies from the broader provider sector group.",
        ]
      : []),
    ...(!hasCoverage
      ? [
          `The comparable set does not provide at least ${MINIMUM_PEER_SAMPLE} positive observations for every displayed peer multiple, so incomplete medians remain blank.`,
        ]
      : []),
  ];
  return selectedRows.length > 0
    ? {
        peers: selectedRows.map(peerFromRow),
        ...(reasons.length > 0 ? { peerReason: reasons.join(" ") } : {}),
      }
    : {
        peers: [],
        peerReason:
          "No peers met the minimum valuation coverage and market-cap comparability rules.",
      };
}

export async function getSecurityAnalysis(
  resolved: ResolvedSecurity,
  view: SecurityAnalysisView,
): Promise<SecurityAnalysisResponse> {
  const payload = await fetchAInvest(
    "snapshot",
    buildSecurityAnalysisRequest(resolved.marketCode, view),
  );
  const normalized = normalizeSnapshot(payload);
  const row = normalized.rows[0];
  if (!row || row.symbolCode !== resolved.marketCode) {
    throw new Error("The market data service returned no matching security row.");
  }
  assertCompanyAnalysisApplicable(resolved, row);
  const liveCompany = stringValue(row, "company");
  const peerResult =
    view === "relative-valuation"
      ? await getRelativePeers(resolved, row)
      : { peers: [] };
  const asOf =
    Object.values(row.values)
      .map((value) => value.asOf)
      .filter((value): value is string => value != null)
      .sort()
      .at(-1) ?? new Date().toISOString();

  const response: SecurityAnalysisResponse = {
    view,
    identity: {
      marketCode: resolved.marketCode,
      exchange: resolved.exchange,
      symbol: resolved.symbol,
      company: liveCompany ?? resolved.companyName ?? null,
      currency: "USD",
    },
    metrics: analysisMetricsFromRow(row),
    peers: peerResult.peers,
    valuation: null,
    ...("peerReason" in peerResult && peerResult.peerReason
      ? { peerReason: peerResult.peerReason }
      : {}),
    asOf,
  };
  response.valuation =
    view === "dcf-valuation"
      ? calculateDcfValuation(response.metrics)
      : view === "relative-valuation"
        ? calculateRelativeValuation(response)
        : null;
  if (view === "dcf-valuation") {
    for (const moduleKey of [
      "fairValueModule",
      "growthForecastModule",
      "earningsRevenueModule",
    ]) {
      delete response.metrics[moduleKey];
    }
  }
  return response;
}
