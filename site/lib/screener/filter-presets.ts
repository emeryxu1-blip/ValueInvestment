import type { ScreenerRow } from "../contracts";

// Increment this whenever a bit is added, removed, or its predicate changes.
// Durable snapshots persist the version so clients never interpret an old mask
// using a newer filter catalog.
export const SCREENER_FILTER_MASK_V1_SCHEMA_VERSION = 1;
export const SCREENER_FILTER_MASK_LEGACY_SCHEMA_VERSION =
  SCREENER_FILTER_MASK_V1_SCHEMA_VERSION;
export const SCREENER_FILTER_MASK_V2_SCHEMA_VERSION = 2;
export const SCREENER_FILTER_MASK_V3_SCHEMA_VERSION = 3;
export const SCREENER_FILTER_MASK_SCHEMA_VERSION =
  SCREENER_FILTER_MASK_V3_SCHEMA_VERSION;
export const SCREENER_FILTER_MASK_V1_ALL_BITS = (1 << 12) - 1;
export const SCREENER_FILTER_MASK_V2_ALL_BITS = (1 << 17) - 1;
export const SCREENER_FILTER_MASK_RETIRED_BITS =
  (1 << 4) | (1 << 5) | (1 << 8);

export const SCREENER_FILTER_BITS = {
  technology: 1 << 0,
  "intrinsic-fair": 1 << 1,
  "margin-20": 1 << 2,
  "pe-positive-15": 1 << 3,
  "positive-earnings": 1 << 6,
  "positive-fcf": 1 << 7,
  "stable-margins": 1 << 9,
  "revenue-growth": 1 << 10,
  "growing-margins": 1 << 11,
  "fcf-yield-5": 1 << 12,
  "ev-ebitda-below-10": 1 << 13,
  "cash-conversion-80": 1 << 14,
  "roic-15": 1 << 15,
  "net-debt-fcf-1-5": 1 << 16,
} as const;

export const SCREENER_FILTER_MASK_V3_ALL_BITS = Object.values(
  SCREENER_FILTER_BITS,
).reduce((mask, bit) => mask | bit, 0);
export const SCREENER_FILTER_MASK_ALL_BITS = SCREENER_FILTER_MASK_V3_ALL_BITS;

export function screenerFilterMaskAllBitsForSchema(
  schemaVersion: number,
): number | null {
  if (
    schemaVersion === 0 ||
    schemaVersion === SCREENER_FILTER_MASK_V1_SCHEMA_VERSION
  ) {
    return SCREENER_FILTER_MASK_V1_ALL_BITS;
  }
  if (schemaVersion === SCREENER_FILTER_MASK_V2_SCHEMA_VERSION) {
    return SCREENER_FILTER_MASK_V2_ALL_BITS;
  }
  if (schemaVersion === SCREENER_FILTER_MASK_V3_SCHEMA_VERSION) {
    return SCREENER_FILTER_MASK_V3_ALL_BITS;
  }
  return null;
}

export type PrecomputedScreenerFilterId = keyof typeof SCREENER_FILTER_BITS;

export function selectedScreenerFilterMask(filterIds: readonly string[]): number {
  return filterIds.reduce(
    (mask, filterId) =>
      mask |
      (SCREENER_FILTER_BITS[filterId as PrecomputedScreenerFilterId] ?? 0),
    0,
  );
}

export function matchesScreenerFilterMask(
  rowMask: number,
  selectedMask: number,
): boolean {
  return (rowMask & selectedMask) === selectedMask;
}

export function screenerFilterMask(
  row: Omit<ScreenerRow, "filterMask">,
): number {
  const price = row.price.value;
  const fairValue = row.fairValue.value;
  const mispricing = row.mispricing.value;
  const pe = row.pe.value;
  const marketCap = row.marketCap.value;
  const netIncome = row.netIncome.value;
  const freeCashFlow = row.freeCashFlow.value;
  const revenueGrowth = row.revenueGrowth.value;
  const evToEbitda = row.evToEbitda.value;
  const returnOnInvestedCapital = row.returnOnInvestedCapital.value;
  const netDebt = row.netDebt.value;
  const sector = row.sector.value?.toLowerCase() ?? "";
  let mask = 0;

  if (sector.includes("technology")) mask |= SCREENER_FILTER_BITS.technology;
  if (price != null && fairValue != null && fairValue >= price) {
    mask |= SCREENER_FILTER_BITS["intrinsic-fair"];
  }
  if (mispricing != null && mispricing >= 0.2) {
    mask |= SCREENER_FILTER_BITS["margin-20"];
  }
  if (pe != null && Number.isFinite(pe) && pe > 0 && pe <= 15) {
    mask |= SCREENER_FILTER_BITS["pe-positive-15"];
  }
  if (netIncome != null && netIncome > 0) {
    mask |= SCREENER_FILTER_BITS["positive-earnings"];
  }
  if (freeCashFlow != null && freeCashFlow > 0) {
    mask |= SCREENER_FILTER_BITS["positive-fcf"];
  }
  if (row.operatingMarginStable5Y.value === true) {
    mask |= SCREENER_FILTER_BITS["stable-margins"];
  }
  if (revenueGrowth != null && revenueGrowth >= 10) {
    mask |= SCREENER_FILTER_BITS["revenue-growth"];
  }
  if (row.operatingMarginsExpanding5Y.value === true) {
    mask |= SCREENER_FILTER_BITS["growing-margins"];
  }
  if (
    freeCashFlow != null &&
    Number.isFinite(freeCashFlow) &&
    freeCashFlow > 0 &&
    marketCap != null &&
    Number.isFinite(marketCap) &&
    marketCap > 0 &&
    freeCashFlow / marketCap >= 0.05
  ) {
    mask |= SCREENER_FILTER_BITS["fcf-yield-5"];
  }
  if (
    evToEbitda != null &&
    Number.isFinite(evToEbitda) &&
    evToEbitda > 0 &&
    evToEbitda <= 10
  ) {
    mask |= SCREENER_FILTER_BITS["ev-ebitda-below-10"];
  }
  if (
    netIncome != null &&
    Number.isFinite(netIncome) &&
    netIncome > 0 &&
    freeCashFlow != null &&
    Number.isFinite(freeCashFlow) &&
    freeCashFlow > 0 &&
    freeCashFlow / netIncome >= 0.8
  ) {
    mask |= SCREENER_FILTER_BITS["cash-conversion-80"];
  }
  if (
    returnOnInvestedCapital != null &&
    Number.isFinite(returnOnInvestedCapital) &&
    returnOnInvestedCapital >= 15
  ) {
    mask |= SCREENER_FILTER_BITS["roic-15"];
  }
  if (
    netDebt != null &&
    Number.isFinite(netDebt) &&
    freeCashFlow != null &&
    Number.isFinite(freeCashFlow) &&
    freeCashFlow > 0 &&
    netDebt / freeCashFlow <= 1.5
  ) {
    mask |= SCREENER_FILTER_BITS["net-debt-fcf-1-5"];
  }

  return mask;
}
