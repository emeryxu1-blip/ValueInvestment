import {
  numberValue,
  type NormalizedSnapshotRow,
} from "../ainvest/normalize.ts";
import { catalogEntryForMarketCode } from "../market-codes.ts";
import { companyAnalysisApplicability } from "./company-analysis-applicability.ts";

export const MINIMUM_PEER_SAMPLE = 3;
export const PEER_CANDIDATE_LIMIT = 100;
export const PEER_REQUEST_LIMIT = 100;

export function peerMarketCodeBatches(marketCodes: string[]): string[][] {
  const bounded = marketCodes.slice(0, PEER_CANDIDATE_LIMIT);
  const batches: string[][] = [];
  for (let index = 0; index < bounded.length; index += PEER_REQUEST_LIMIT) {
    batches.push(bounded.slice(index, index + PEER_REQUEST_LIMIT));
  }
  return batches;
}

const positive = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value > 0;

const positiveMultipleCount = (row: NormalizedSnapshotRow): number =>
  ["pe", "ps", "pb"].filter((id) => positive(numberValue(row, id))).length;

const scaleDistance = (
  targetMarketCap: number | null,
  peerMarketCap: number | null,
): number =>
  positive(targetMarketCap) && positive(peerMarketCap)
    ? Math.abs(Math.log(peerMarketCap / targetMarketCap))
    : Number.POSITIVE_INFINITY;

const issuerName = (value: string | null): string | null => {
  if (!value) return null;
  const normalized = value
    .toLowerCase()
    .replace(/\b(class|ordinary|common|depositary|shares?|stock|adr|ads)\b/g, " ")
    .replace(/\b[abc]\b$/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalized || null;
};

const isSameIssuer = (
  target: NormalizedSnapshotRow,
  candidate: NormalizedSnapshotRow,
): boolean => {
  const targetName = issuerName(
    typeof target.values.company?.value === "string"
      ? target.values.company.value
      : null,
  );
  const candidateName = issuerName(
    typeof candidate.values.company?.value === "string"
      ? candidate.values.company.value
      : null,
  );
  return targetName !== null && targetName === candidateName;
};

export type PeerSelectionPurpose = "valuation" | "quality";

export function hasMinimumPeerCoverage(
  rows: NormalizedSnapshotRow[],
  purpose: PeerSelectionPurpose,
): boolean {
  const ids =
    purpose === "quality"
      ? ["netMargin", "returnOnEquity"]
      : ["pe", "ps", "pb"];
  return ids.every(
    (id) =>
      rows.filter((row) => {
        const value = numberValue(row, id);
        return purpose === "quality" ? value !== null : positive(value);
      }).length >= MINIMUM_PEER_SAMPLE,
  );
}

export function selectComparablePeerRows(
  target: NormalizedSnapshotRow,
  candidates: NormalizedSnapshotRow[],
  limit = 8,
  purpose: PeerSelectionPurpose = "valuation",
): NormalizedSnapshotRow[] {
  const targetMarketCap = numberValue(target, "marketCap");
  const filtered = candidates
    .filter((candidate) => {
      const security = catalogEntryForMarketCode(candidate.symbolCode);
      return (
        security !== null &&
        companyAnalysisApplicability(security, candidate).companyAnalysis
      );
    })
    .filter((candidate) => candidate.symbolCode !== target.symbolCode)
    .filter((candidate) => !isSameIssuer(target, candidate))
    .filter((candidate) =>
      purpose === "quality"
        ? ["netMargin", "returnOnEquity"].some((id) =>
            numberValue(candidate, id) !== null,
          )
        : positiveMultipleCount(candidate) >= 2,
    )
    .filter((candidate) => {
      const peerMarketCap = numberValue(candidate, "marketCap");
      if (!positive(targetMarketCap)) return true;
      if (!positive(peerMarketCap)) return false;
      const ratio = peerMarketCap / targetMarketCap;
      return ratio >= 0.01 && ratio <= 100;
    })
    .sort((left, right) => {
      const distance =
        scaleDistance(targetMarketCap, numberValue(left, "marketCap")) -
        scaleDistance(targetMarketCap, numberValue(right, "marketCap"));
      return distance || left.symbolCode.localeCompare(right.symbolCode);
    });
  const seenIssuers = new Set<string>();
  return filtered
    .filter((candidate) => {
      const name = issuerName(
        typeof candidate.values.company?.value === "string"
          ? candidate.values.company.value
          : null,
      );
      const key = name ?? candidate.symbolCode;
      if (seenIssuers.has(key)) return false;
      seenIssuers.add(key);
      return true;
    })
    .slice(0, limit);
}
