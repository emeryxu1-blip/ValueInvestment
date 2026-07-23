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
  symbolFromMarketCode,
  type ResolvedSecurity,
} from "../market-codes";
import { analysisMetricsFromRow } from "./analysis-normalize";
import {
  calculateDcfValuation,
  calculateRelativeValuation,
} from "./valuation";

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

async function getRelativePeers(
  resolved: ResolvedSecurity,
  row: NormalizedSnapshotRow,
): Promise<{ peers: AnalysisPeer[]; peerReason?: string }> {
  const sectorCode = stringValue(row, "sectorCode");
  if (!sectorCode) {
    return {
      peers: [],
      peerReason: "No supported industry relationship was returned.",
    };
  }
  const relation = (await fetchAInvest(
    "relation",
    buildRelationRequest(sectorCode),
  )) as {
    data?: { data?: Array<{ v?: unknown }> };
  };
  const marketCodes = (relation.data?.data ?? [])
    .map((item) => item.v)
    .filter((value): value is string => typeof value === "string")
    .filter((value) => value !== resolved.marketCode)
    .slice(0, 8);
  if (marketCodes.length === 0) {
    return { peers: [], peerReason: "No supported comparable companies were returned." };
  }
  const peerPayload = await fetchAInvest(
    "snapshot",
    buildAnalysisPeerSnapshotRequest(marketCodes),
  );
  return {
    peers: normalizeSnapshot(peerPayload).rows.map(peerFromRow),
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
  return response;
}
