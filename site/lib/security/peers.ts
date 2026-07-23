import type { Metric, PeerRow, PeersResponse } from "../contracts";
import { fetchAInvest } from "../ainvest/client";
import {
  normalizeSnapshot,
  numberValue,
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
  symbolFromMarketCode,
  type ResolvedSecurity,
} from "../market-codes";
import { derivePeerValue, medianPositive } from "./derivations";

function liveNumber(
  row: NormalizedSnapshotRow,
  id: string,
  fetchedAt: string,
  unit?: string,
): Metric<number> {
  const value = numberValue(row, id);
  return metric(value, "live", {
    asOf: row.values[id]?.asOf ?? fetchedAt,
    unit,
    ...(value == null ? { reason: "Market data returned no value for this peer metric." } : {}),
  });
}

function peerFromRow(row: NormalizedSnapshotRow, fetchedAt: string): PeerRow {
  const catalog = catalogEntryForMarketCode(row.symbolCode);
  const liveCompany = stringValue(row, "company");
  return {
    marketCode: row.symbolCode,
    symbol: catalog?.symbol ?? symbolFromMarketCode(row.symbolCode),
    company: metric(liveCompany ?? catalog?.companyName ?? null, liveCompany ? "live" : "derived", {
      asOf: liveCompany ? row.values.company?.asOf ?? fetchedAt : null,
      ...(!liveCompany && !catalog?.companyName ? { reason: "Company name is unavailable." } : {}),
    }),
    price: liveNumber(row, "price", fetchedAt, "USD"),
    marketCap: liveNumber(row, "marketCap", fetchedAt, "USD"),
    pe: liveNumber(row, "pe", fetchedAt, "x"),
    pb: liveNumber(row, "pb", fetchedAt, "x"),
    ps: liveNumber(row, "ps", fetchedAt, "x"),
  };
}

export function unavailablePeersResponse(
  resolved: ResolvedSecurity,
  reason: string,
): PeersResponse {
  const missing = (unit: string) => metric<number>(null, "derived", { reason, unit });
  return {
    symbol: resolved.symbol,
    marketCode: resolved.marketCode,
    peers: [],
    medians: { pe: missing("x"), pb: missing("x"), ps: missing("x") },
    peerValue: missing("USD"),
    source: "live",
    asOf: new Date().toISOString(),
  };
}

async function fetchTargetRow(resolved: ResolvedSecurity): Promise<NormalizedSnapshotRow> {
  const payload = await fetchAInvest("snapshot", buildSecuritySnapshotRequest(resolved.marketCode));
  const row = normalizeSnapshot(payload).rows[0];
  if (!row) throw new Error("The market data service returned no security row.");
  return row;
}

export async function getPeersResponse(
  resolved: ResolvedSecurity,
  targetRow?: NormalizedSnapshotRow,
): Promise<PeersResponse> {
  const target = targetRow ?? (await fetchTargetRow(resolved));
  const sectorCode = stringValue(target, "sectorCode");
  if (!sectorCode) {
    return unavailablePeersResponse(
      resolved,
      "A supported industry relationship was not returned.",
    );
  }
  const relation = (await fetchAInvest("relation", buildRelationRequest(sectorCode))) as {
    data?: { data?: Array<{ v?: unknown }> };
  };
  const marketCodes = (relation.data?.data ?? [])
    .map((item) => item.v)
    .filter((value): value is string => typeof value === "string")
    .filter((value) => value !== resolved.marketCode)
    .slice(0, 8);
  if (marketCodes.length === 0) {
    return unavailablePeersResponse(resolved, "No supported peers were returned.");
  }
  const payload = await fetchAInvest("snapshot", buildPeerSnapshotRequest(marketCodes));
  const fetchedAt = new Date().toISOString();
  const peers = normalizeSnapshot(payload).rows.map((row) => peerFromRow(row, fetchedAt));
  const medianPe = medianPositive(peers.map((peer) => peer.pe.value));
  const medianPb = medianPositive(peers.map((peer) => peer.pb.value));
  const medianPs = medianPositive(peers.map((peer) => peer.ps.value));
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
      asOf: fetchedAt,
      unit: "x",
      reason: "Median of positive peer multiples returned by market data.",
    });
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
      asOf: fetchedAt,
      unit: "USD",
      reason:
        "Mean of positive implied values from median peer PE, PS, and PB applied to company per-share fundamentals.",
    }),
    source: "live",
    asOf: fetchedAt,
  };
}
