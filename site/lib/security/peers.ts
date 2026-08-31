import type { Metric, PeerRow, PeersResponse } from "../contracts";
import { fetchAInvest } from "../ainvest/client";
import {
  normalizeSnapshot,
  numberValue,
  ratioNumberValue,
  stringValue,
  type NormalizedSnapshotRow,
} from "../ainvest/normalize";
import {
  buildPeerSnapshotRequest,
  buildRelationRequest,
  buildSecuritySnapshotRequest,
} from "../ainvest/requests";
import { metric } from "../metric";
import {
  catalogEntryForMarketCode,
  supportsCompanyAnalysis,
  symbolFromMarketCode,
  type ResolvedSecurity,
} from "../market-codes";
import { derivePeerValue, medianPositive } from "./derivations";
import {
  MINIMUM_PEER_SAMPLE,
  PEER_CANDIDATE_LIMIT,
  hasMinimumPeerCoverage,
  peerMarketCodeBatches,
  selectComparablePeerRows,
} from "./peer-selection.ts";
import { assertCompanyAnalysisApplicable } from "./company-analysis-applicability.ts";

function liveNumber(
  row: NormalizedSnapshotRow,
  id: string,
  unit?: string,
): Metric<number> {
  const value = numberValue(row, id);
  return metric(value, "live", {
    asOf: row.values[id]?.asOf ?? null,
    unit,
    ...(value == null ? { reason: "Market data returned no value for this peer metric." } : {}),
  });
}

function liveRatio(
  row: NormalizedSnapshotRow,
  id: string,
): Metric<number> {
  const value = ratioNumberValue(row, id);
  return metric(value, "live", {
    asOf: row.values[id]?.asOf ?? null,
    unit: "ratio",
    ...(value == null
      ? { reason: "Market data returned no value for this peer ratio." }
      : {}),
  });
}

function peerFromRow(row: NormalizedSnapshotRow): PeerRow {
  const catalog = catalogEntryForMarketCode(row.symbolCode);
  const liveCompany = stringValue(row, "company");
  return {
    marketCode: row.symbolCode,
    symbol: catalog?.symbol ?? symbolFromMarketCode(row.symbolCode),
    company: metric(liveCompany, liveCompany ? "live" : "unknown", {
      asOf: liveCompany ? row.values.company?.asOf ?? null : null,
      ...(!liveCompany ? { reason: "Company name is unavailable in the current market data." } : {}),
    }),
    price: liveNumber(row, "price", "USD"),
    marketCap: liveNumber(row, "marketCap", "USD"),
    pe: liveNumber(row, "pe", "x"),
    pb: liveNumber(row, "pb", "x"),
    ps: liveNumber(row, "ps", "x"),
    netMargin: liveRatio(row, "netMargin"),
    returnOnEquity: liveRatio(row, "returnOnEquity"),
  };
}

export function unavailablePeersResponse(
  resolved: ResolvedSecurity,
  reason: string,
): PeersResponse {
  const missing = (unit?: string) => metric<number>(null, "derived", { reason, ...(unit ? { unit } : {}) });
  return {
    symbol: resolved.symbol,
    marketCode: resolved.marketCode,
    peers: [],
    medians: { pe: missing("x"), pb: missing("x"), ps: missing("x") },
    peerValue: missing(),
    selectionReason: reason,
    source: "live",
    asOf: null,
  };
}

async function fetchTargetRow(resolved: ResolvedSecurity): Promise<NormalizedSnapshotRow> {
  const payload = await fetchAInvest("snapshot", buildSecuritySnapshotRequest(resolved.marketCode));
  const row = normalizeSnapshot(payload).rows[0];
  if (!row || row.symbolCode !== resolved.marketCode) {
    throw new Error("The market data service returned no matching security row.");
  }
  return row;
}

async function relatedMarketCodes(
  resolved: ResolvedSecurity,
  sectorCode: string,
): Promise<string[]> {
  const relation = (await fetchAInvest("relation", buildRelationRequest(sectorCode))) as {
    data?: { data?: Array<{ v?: unknown }> };
  };
  return [...new Set((relation.data?.data ?? [])
    .map((item) => item.v)
    .filter((value): value is string => typeof value === "string")
    .filter((value) => value !== resolved.marketCode)
    .filter((value) => {
      const candidate = catalogEntryForMarketCode(value);
      return candidate !== null && supportsCompanyAnalysis(candidate);
    }))].slice(0, PEER_CANDIDATE_LIMIT);
}

async function peerSnapshotRows(
  marketCodes: string[],
): Promise<NormalizedSnapshotRow[]> {
  const payloads = await Promise.all(
    peerMarketCodeBatches(marketCodes).map((batch) =>
      fetchAInvest("snapshot", buildPeerSnapshotRequest(batch)),
    ),
  );
  return payloads.flatMap((payload) => normalizeSnapshot(payload).rows);
}

export async function getPeersResponse(
  resolved: ResolvedSecurity,
  targetRow?: NormalizedSnapshotRow,
  purpose: "valuation" | "quality" = "valuation",
): Promise<PeersResponse> {
  const target = targetRow ?? (await fetchTargetRow(resolved));
  assertCompanyAnalysisApplicable(resolved, target);
  const industryCode = stringValue(target, "sectorCode");
  const sectorGroupCode = stringValue(target, "sectorGroupCode");
  if (!industryCode && !sectorGroupCode) {
    throw new Error("A supported industry relationship was not returned.");
  }
  const primaryCodes = industryCode
    ? await relatedMarketCodes(resolved, industryCode)
    : [];
  let candidateRows = await peerSnapshotRows(primaryCodes);
  let selectedRows = selectComparablePeerRows(target, candidateRows, 8, purpose);
  let usedBroaderSectorGroup = false;
  if (
    !hasMinimumPeerCoverage(selectedRows, purpose) &&
    sectorGroupCode &&
    sectorGroupCode !== industryCode
  ) {
    usedBroaderSectorGroup = true;
    const seen = new Set(primaryCodes);
    const broaderCodes = (await relatedMarketCodes(resolved, sectorGroupCode))
      .filter((marketCode) => !seen.has(marketCode));
    candidateRows = [...candidateRows, ...(await peerSnapshotRows(broaderCodes))];
    selectedRows = selectComparablePeerRows(target, candidateRows, 8, purpose);
  }
  if (selectedRows.length === 0) {
    throw new Error("No supported comparable peers were returned.");
  }
  const peers = selectedRows.map(peerFromRow);
  const asOf = peers
    .flatMap((peer) => [
      peer.price.asOf,
      peer.marketCap.asOf,
      peer.pe.asOf,
      peer.pb.asOf,
      peer.ps.asOf,
      peer.netMargin.asOf,
      peer.returnOnEquity.asOf,
    ])
    .filter((value): value is string => value != null)
    .sort()
    .at(-1) ?? null;
  const medianPe = medianPositive(
    peers.map((peer) => peer.pe.value),
    MINIMUM_PEER_SAMPLE,
  );
  const medianPb = medianPositive(
    peers.map((peer) => peer.pb.value),
    MINIMUM_PEER_SAMPLE,
  );
  const medianPs = medianPositive(
    peers.map((peer) => peer.ps.value),
    MINIMUM_PEER_SAMPLE,
  );
  const peerValue = derivePeerValue({
    price: numberValue(target, "price"),
    pe: numberValue(target, "pe"),
    pb: numberValue(target, "pb"),
    ps: numberValue(target, "ps"),
    peerPes: peers.map((peer) => peer.pe.value),
    peerPbs: peers.map((peer) => peer.pb.value),
    peerPss: peers.map((peer) => peer.ps.value),
  });
  const medianMetric = (value: number | null) =>
    metric(value, "derived", {
      asOf,
      unit: "x",
      reason:
        value === null
          ? `At least ${MINIMUM_PEER_SAMPLE} positive observations are required for this peer median.`
          : "Median of positive peer multiples returned by market data.",
    });
  const hasCoverage = hasMinimumPeerCoverage(selectedRows, purpose);
  const coverageLabel =
    purpose === "quality"
      ? "direct net-margin and return-on-equity observations"
      : "positive valuation-multiple observations";
  const selectionReasons = [
    ...(usedBroaderSectorGroup
      ? [
          `The industry peer set did not provide enough ${coverageLabel}, so the displayed set also includes companies from the broader sector group.`,
        ]
      : []),
    ...(!hasCoverage
      ? [
          `At least ${MINIMUM_PEER_SAMPLE} ${coverageLabel} are required for every displayed median; incomplete values remain blank.`,
        ]
      : []),
  ];
  return {
    symbol: resolved.symbol,
    marketCode: resolved.marketCode,
    peers,
    medians: {
      pe: medianMetric(medianPe),
      pb: medianMetric(medianPb),
      ps: medianMetric(medianPs),
    },
    peerValue: metric(peerValue, "derived", {
      asOf,
      reason:
        peerValue === null
          ? `A peer valuation requires target multiples and at least ${MINIMUM_PEER_SAMPLE} positive peer observations for the displayed measures.`
          : "Median of positive PE-, PS-, and PB-implied values using share-class-consistent company multiples.",
    }),
    ...(selectionReasons.length > 0
      ? { selectionReason: selectionReasons.join(" ") }
      : {}),
    source: "live",
    asOf,
  };
}
