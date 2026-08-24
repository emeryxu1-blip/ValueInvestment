import {
  SCREENER_FILTER_MASK_LEGACY_SCHEMA_VERSION,
  SCREENER_FILTER_MASK_SCHEMA_VERSION,
  SCREENER_FILTER_MASK_V1_SCHEMA_VERSION,
  SCREENER_FILTER_MASK_V2_SCHEMA_VERSION,
  SCREENER_FILTER_MASK_V3_SCHEMA_VERSION,
} from "./filter-presets.ts";

export const SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION =
  SCREENER_FILTER_MASK_SCHEMA_VERSION;
export const SCREENER_CLIENT_SNAPSHOT_LEGACY_SCHEMA_VERSION =
  SCREENER_FILTER_MASK_LEGACY_SCHEMA_VERSION;
export const SCREENER_CLIENT_SNAPSHOT_V1_SCHEMA_VERSION =
  SCREENER_FILTER_MASK_V1_SCHEMA_VERSION;
export const SCREENER_CLIENT_SNAPSHOT_V2_SCHEMA_VERSION =
  SCREENER_FILTER_MASK_V2_SCHEMA_VERSION;
export const SCREENER_CLIENT_SNAPSHOT_V3_SCHEMA_VERSION =
  SCREENER_FILTER_MASK_V3_SCHEMA_VERSION;
export const SCREENER_CLIENT_SNAPSHOT_SUPPORTED_SCHEMA_VERSIONS = [
  SCREENER_CLIENT_SNAPSHOT_V1_SCHEMA_VERSION,
  SCREENER_CLIENT_SNAPSHOT_V2_SCHEMA_VERSION,
  SCREENER_CLIENT_SNAPSHOT_V3_SCHEMA_VERSION,
] as const;
export const MAX_SCREENER_CLIENT_SNAPSHOT_ROWS = 1000;

export type ScreenerClientSnapshotSchemaVersion =
  (typeof SCREENER_CLIENT_SNAPSHOT_SUPPORTED_SCHEMA_VERSIONS)[number];

export type ScreenerClientSnapshotRow = {
  marketCode: string;
  exchange: string;
  symbol: string;
  company: string | null;
  filterMask: number;
  currency: string;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  fairValue: number | null;
  mispricing: number | null;
  pe: number | null;
  revenueGrowth: number | null;
};

export type ScreenerClientSnapshotPayload = {
  schemaVersion: ScreenerClientSnapshotSchemaVersion;
  generationId: string;
  asOf: string;
  total: number;
  rows: ScreenerClientSnapshotRow[];
};
