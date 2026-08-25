import type { MetricSource, ScreenerRow } from "../contracts";
import { metric } from "../metric";
import {
  SCREENER_FILTER_MASK_RETIRED_BITS,
  SCREENER_FILTER_MASK_SCHEMA_VERSION,
  SCREENER_FILTER_MASK_V1_SCHEMA_VERSION,
  SCREENER_FILTER_MASK_V2_SCHEMA_VERSION,
  SCREENER_FILTER_MASK_V3_SCHEMA_VERSION,
  screenerFilterMask,
  screenerFilterMaskAllBitsForSchema,
} from "./filter-presets";
import {
  SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION,
  type ScreenerClientSnapshotSchemaVersion,
  type ScreenerClientSnapshotPayload,
} from "./client-snapshot-contract";

const SNAPSHOT_CHUNK_SIZE = 100;
const MAX_SNAPSHOT_ROWS = 1000;

type StoredSnapshotMetadata = {
  generation_id: string;
  universe_refreshed_at: number;
  refreshed_at: number;
  row_count: number;
  filter_mask_schema_version: number;
};

type StoredClientSnapshotMetadata = StoredSnapshotMetadata & {
  client_payload_json: string;
  client_payload_etag: string;
};

type StoredActiveSnapshotState = {
  active_generation_id: string;
  updated_at: number;
};

type StoredSnapshotRow = {
  market_code: string;
  exchange: string;
  symbol: string;
  payload_json: string;
};

type StoredSnapshotPayload = {
  company: string | null;
  companySource: MetricSource;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  fairValue: number | null;
  mispricing: number | null;
  pe: number | null;
  revenueGrowth: number | null;
  netIncome: number | null;
  freeCashFlow: number | null;
  debtToEquity: number | null;
  evToEbitda: number | null;
  returnOnInvestedCapital: number | null;
  netDebt: number | null;
  operatingMarginStable5Y: boolean | null;
  operatingMarginTrend5Y: number | null;
  operatingMarginsExpanding5Y: boolean | null;
  sector: string | null;
  filterMask: number;
  asOf: {
    company: string | null;
    price: string | null;
    changePercent: string | null;
    marketCap: string | null;
    fairValue: string | null;
    mispricing: string | null;
    pe: string | null;
    revenueGrowth: string | null;
    netIncome: string | null;
    freeCashFlow: string | null;
    debtToEquity: string | null;
    evToEbitda: string | null;
    returnOnInvestedCapital: string | null;
    netDebt: string | null;
    operatingMarginStable5Y: string | null;
    operatingMarginTrend5Y: string | null;
    operatingMarginsExpanding5Y: string | null;
    sector: string | null;
  };
};

export type DurableScreenerSnapshot = {
  generationId: string;
  universeRefreshedAt: number;
  refreshedAt: number;
  rows: ScreenerRow[];
};

export type ScreenerClientSnapshot = {
  generationId: string;
  refreshedAt: number;
  universeRefreshedAt: number;
  rowCount: number;
  schemaVersion: ScreenerClientSnapshotSchemaVersion;
  etag: string;
  payloadJson: string;
};

function finiteOrNull(value: number | null): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function payloadFromRow(row: ScreenerRow): StoredSnapshotPayload {
  return {
    company: row.company.value,
    companySource: row.company.source,
    price: finiteOrNull(row.price.value),
    changePercent: finiteOrNull(row.changePercent.value),
    marketCap: finiteOrNull(row.marketCap.value),
    fairValue: finiteOrNull(row.fairValue.value),
    mispricing: finiteOrNull(row.mispricing.value),
    pe: finiteOrNull(row.pe.value),
    revenueGrowth: finiteOrNull(row.revenueGrowth.value),
    netIncome: finiteOrNull(row.netIncome.value),
    freeCashFlow: finiteOrNull(row.freeCashFlow.value),
    debtToEquity: finiteOrNull(row.debtToEquity.value),
    evToEbitda: finiteOrNull(row.evToEbitda.value),
    returnOnInvestedCapital: finiteOrNull(
      row.returnOnInvestedCapital.value,
    ),
    netDebt: finiteOrNull(row.netDebt.value),
    operatingMarginStable5Y: row.operatingMarginStable5Y.value,
    operatingMarginTrend5Y: finiteOrNull(row.operatingMarginTrend5Y.value),
    operatingMarginsExpanding5Y: row.operatingMarginsExpanding5Y.value,
    sector: row.sector.value,
    filterMask: row.filterMask,
    asOf: {
      company: row.company.asOf,
      price: row.price.asOf,
      changePercent: row.changePercent.asOf,
      marketCap: row.marketCap.asOf,
      fairValue: row.fairValue.asOf,
      mispricing: row.mispricing.asOf,
      pe: row.pe.asOf,
      revenueGrowth: row.revenueGrowth.asOf,
      netIncome: row.netIncome.asOf,
      freeCashFlow: row.freeCashFlow.asOf,
      debtToEquity: row.debtToEquity.asOf,
      evToEbitda: row.evToEbitda.asOf,
      returnOnInvestedCapital: row.returnOnInvestedCapital.asOf,
      netDebt: row.netDebt.asOf,
      operatingMarginStable5Y: row.operatingMarginStable5Y.asOf,
      operatingMarginTrend5Y: row.operatingMarginTrend5Y.asOf,
      operatingMarginsExpanding5Y: row.operatingMarginsExpanding5Y.asOf,
      sector: row.sector.asOf,
    },
  };
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isNullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

function isNullableAsOf(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

function isValidFilterMask(
  value: unknown,
  schemaVersion = SCREENER_FILTER_MASK_SCHEMA_VERSION,
): value is number {
  const allowedBits = screenerFilterMaskAllBitsForSchema(schemaVersion);
  return (
    allowedBits != null &&
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    (value & ~allowedBits) === 0 &&
    (schemaVersion !== SCREENER_FILTER_MASK_V3_SCHEMA_VERSION ||
      (value & SCREENER_FILTER_MASK_RETIRED_BITS) === 0)
  );
}

function legacyAsOf(missingAsOf: string): StoredSnapshotPayload["asOf"] {
  return {
    company: missingAsOf,
    price: missingAsOf,
    changePercent: missingAsOf,
    marketCap: missingAsOf,
    fairValue: missingAsOf,
    mispricing: missingAsOf,
    pe: missingAsOf,
    revenueGrowth: missingAsOf,
    netIncome: missingAsOf,
    freeCashFlow: missingAsOf,
    debtToEquity: missingAsOf,
    evToEbitda: missingAsOf,
    returnOnInvestedCapital: missingAsOf,
    netDebt: missingAsOf,
    operatingMarginStable5Y: missingAsOf,
    operatingMarginTrend5Y: missingAsOf,
    operatingMarginsExpanding5Y: missingAsOf,
    sector: missingAsOf,
  };
}

function parsePayload(
  raw: string,
  legacyFallbackAsOf: string,
  schemaVersion: number,
): StoredSnapshotPayload {
  const value = JSON.parse(raw) as Partial<StoredSnapshotPayload> | null;
  const legacyAsOfValues = legacyAsOf(legacyFallbackAsOf);
  const asOf = {
    ...legacyAsOfValues,
    ...(value?.asOf ?? {}),
  };
  const acceptsMissingV2Fields =
    schemaVersion === 0 ||
    schemaVersion === SCREENER_FILTER_MASK_V1_SCHEMA_VERSION;
  const evToEbitda = value?.evToEbitda ?? null;
  const returnOnInvestedCapital = value?.returnOnInvestedCapital ?? null;
  const netDebt = value?.netDebt ?? null;
  if (
    !value ||
    (value.company !== null && typeof value.company !== "string") ||
    (value.companySource !== "live" && value.companySource !== "derived") ||
    !isNullableFiniteNumber(value.price) ||
    !isNullableFiniteNumber(value.changePercent) ||
    !isNullableFiniteNumber(value.marketCap) ||
    !isNullableFiniteNumber(value.fairValue) ||
    !isNullableFiniteNumber(value.mispricing) ||
    !isNullableFiniteNumber(value.pe) ||
    !isNullableFiniteNumber(value.revenueGrowth) ||
    !isNullableFiniteNumber(value.netIncome) ||
    !isNullableFiniteNumber(value.freeCashFlow) ||
    !isNullableFiniteNumber(value.debtToEquity) ||
    (!acceptsMissingV2Fields && !Object.hasOwn(value, "evToEbitda")) ||
    (!acceptsMissingV2Fields &&
      !Object.hasOwn(value, "returnOnInvestedCapital")) ||
    (!acceptsMissingV2Fields && !Object.hasOwn(value, "netDebt")) ||
    !isNullableFiniteNumber(evToEbitda) ||
    !isNullableFiniteNumber(returnOnInvestedCapital) ||
    !isNullableFiniteNumber(netDebt) ||
    !isNullableBoolean(value.operatingMarginStable5Y) ||
    !isNullableFiniteNumber(value.operatingMarginTrend5Y) ||
    !isNullableBoolean(value.operatingMarginsExpanding5Y) ||
    (value.sector !== null && typeof value.sector !== "string") ||
    !isValidFilterMask(value.filterMask, schemaVersion) ||
    !isNullableAsOf(asOf.company) ||
    !isNullableAsOf(asOf.price) ||
    !isNullableAsOf(asOf.changePercent) ||
    !isNullableAsOf(asOf.marketCap) ||
    !isNullableAsOf(asOf.fairValue) ||
    !isNullableAsOf(asOf.mispricing) ||
    !isNullableAsOf(asOf.pe) ||
    !isNullableAsOf(asOf.revenueGrowth) ||
    !isNullableAsOf(asOf.netIncome) ||
    !isNullableAsOf(asOf.freeCashFlow) ||
    !isNullableAsOf(asOf.debtToEquity) ||
    !isNullableAsOf(asOf.evToEbitda) ||
    !isNullableAsOf(asOf.returnOnInvestedCapital) ||
    !isNullableAsOf(asOf.netDebt) ||
    !isNullableAsOf(asOf.operatingMarginStable5Y) ||
    !isNullableAsOf(asOf.operatingMarginTrend5Y) ||
    !isNullableAsOf(asOf.operatingMarginsExpanding5Y) ||
    !isNullableAsOf(asOf.sector)
  ) {
    throw new Error("The stored screener snapshot contained an invalid row.");
  }
  return {
    ...value,
    evToEbitda,
    returnOnInvestedCapital,
    netDebt,
    asOf,
  } as StoredSnapshotPayload;
}

function rowFromStored(
  row: StoredSnapshotRow,
  payload: StoredSnapshotPayload,
  preserveStoredFilterMask: boolean,
): ScreenerRow {
  const liveNumber = (
    value: number | null,
    asOf: string | null,
    unit?: string,
  ) =>
    metric(value, "live", {
      asOf,
      unit,
      ...(value == null ? { reason: "The stored market snapshot has no value for this metric." } : {}),
    });
  const derivedNumber = (
    value: number | null,
    asOf: string | null,
    unit?: string,
    reason?: string,
  ) =>
    metric(value, "derived", {
      asOf,
      unit,
      ...(reason ? { reason } : {}),
    });
  const derivedBoolean = (
    value: boolean | null,
    asOf: string | null,
    reason: string,
  ) =>
    metric(value, "derived", { asOf, reason });

  const result: Omit<ScreenerRow, "filterMask"> = {
    marketCode: row.market_code,
    exchange: row.exchange,
    symbol: row.symbol,
    company: metric(payload.company, payload.companySource, {
      asOf: payload.asOf.company,
      ...(payload.company == null ? { reason: "Company name is unavailable." } : {}),
    }),
    price: liveNumber(payload.price, payload.asOf.price, "USD"),
    changePercent: liveNumber(
      payload.changePercent,
      payload.asOf.changePercent,
      "%",
    ),
    marketCap: liveNumber(payload.marketCap, payload.asOf.marketCap, "USD"),
    fairValue: liveNumber(payload.fairValue, payload.asOf.fairValue, "USD"),
    mispricing: derivedNumber(
      payload.mispricing,
      payload.asOf.mispricing,
      "ratio",
      "Calculated as stored fair value divided by stored price, minus one.",
    ),
    pe: liveNumber(payload.pe, payload.asOf.pe, "x"),
    revenueGrowth: liveNumber(
      payload.revenueGrowth,
      payload.asOf.revenueGrowth,
      "%",
    ),
    netIncome: liveNumber(payload.netIncome, payload.asOf.netIncome, "USD"),
    freeCashFlow: liveNumber(
      payload.freeCashFlow,
      payload.asOf.freeCashFlow,
      "USD",
    ),
    debtToEquity: liveNumber(
      payload.debtToEquity,
      payload.asOf.debtToEquity,
      "%",
    ),
    evToEbitda: liveNumber(
      payload.evToEbitda,
      payload.asOf.evToEbitda,
      "x",
    ),
    returnOnInvestedCapital: liveNumber(
      payload.returnOnInvestedCapital,
      payload.asOf.returnOnInvestedCapital,
      "%",
    ),
    netDebt: liveNumber(payload.netDebt, payload.asOf.netDebt, "USD"),
    operatingMarginStable5Y: derivedBoolean(
      payload.operatingMarginStable5Y,
      payload.asOf.operatingMarginStable5Y,
      "True when the five-year operating-margin range is no more than five percentage points.",
    ),
    operatingMarginTrend5Y: derivedNumber(
      payload.operatingMarginTrend5Y,
      payload.asOf.operatingMarginTrend5Y,
      "ratio per year",
      "Least-squares annual trend across the latest five fiscal-year operating margins.",
    ),
    operatingMarginsExpanding5Y: derivedBoolean(
      payload.operatingMarginsExpanding5Y,
      payload.asOf.operatingMarginsExpanding5Y,
      "True when the five-year least-squares slope is positive and the latest margin exceeds the earliest.",
    ),
    sector: metric(payload.sector, "live", {
      asOf: payload.asOf.sector,
      ...(payload.sector == null ? { reason: "The stored market snapshot has no sector." } : {}),
    }),
    currency: "USD",
  };
  return {
    ...result,
    filterMask: preserveStoredFilterMask
      ? payload.filterMask
      : screenerFilterMask(result),
  };
}

function assertCompleteRows(
  rows: ScreenerRow[],
  schemaVersion = SCREENER_FILTER_MASK_SCHEMA_VERSION,
): void {
  const marketCodes = new Set(rows.map((row) => row.marketCode));
  if (
    rows.length === 0 ||
    rows.length > MAX_SNAPSHOT_ROWS ||
    marketCodes.size !== rows.length ||
    rows.some(
      (row) =>
        !row.marketCode ||
        !row.symbol ||
        !["nasdaq", "nyse"].includes(row.exchange.toLowerCase()) ||
        !isValidFilterMask(row.filterMask, schemaVersion),
    )
  ) {
    throw new Error("The screener snapshot was incomplete and was not stored.");
  }
}

function assertSupportedSchemaVersion(
  version: unknown,
): asserts version is ScreenerClientSnapshotSchemaVersion {
  if (
    version !== SCREENER_FILTER_MASK_V1_SCHEMA_VERSION &&
    version !== SCREENER_FILTER_MASK_V2_SCHEMA_VERSION &&
    version !== SCREENER_FILTER_MASK_V3_SCHEMA_VERSION
  ) {
    throw new Error(
      `The active screener snapshot uses unsupported filter-mask schema version ${String(version)}.`,
    );
  }
}

function clientPayloadFromRows(
  generationId: string,
  refreshedAt: number,
  rows: ScreenerRow[],
  schemaVersion: ScreenerClientSnapshotSchemaVersion =
    SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION,
): ScreenerClientSnapshotPayload {
  assertCompleteRows(rows, schemaVersion);
  return {
    schemaVersion,
    generationId,
    asOf: new Date(refreshedAt).toISOString(),
    total: rows.length,
    rows: rows.map((row) => ({
      marketCode: row.marketCode,
      exchange: row.exchange,
      symbol: row.symbol,
      company: row.company.value,
      filterMask: row.filterMask,
      currency: row.currency,
      price: finiteOrNull(row.price.value),
      changePercent: finiteOrNull(row.changePercent.value),
      marketCap: finiteOrNull(row.marketCap.value),
      fairValue: finiteOrNull(row.fairValue.value),
      mispricing: finiteOrNull(row.mispricing.value),
      pe: finiteOrNull(row.pe.value),
      revenueGrowth: finiteOrNull(row.revenueGrowth.value),
    })),
  };
}

async function snapshotEtag(payloadJson: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payloadJson),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256-${hex}`;
}

function isValidClientRow(
  value: unknown,
  schemaVersion: number,
): value is ScreenerClientSnapshotPayload["rows"][number] {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ScreenerClientSnapshotPayload["rows"][number]>;
  return (
    typeof row.marketCode === "string" &&
    row.marketCode.length > 0 &&
    (row.exchange === "nasdaq" || row.exchange === "nyse") &&
    typeof row.symbol === "string" &&
    row.symbol.length > 0 &&
    (row.company === null ||
      (typeof row.company === "string" && row.company.length > 0)) &&
    isValidFilterMask(row.filterMask, schemaVersion) &&
    typeof row.currency === "string" &&
    row.currency.length > 0 &&
    isNullableFiniteNumber(row.price) &&
    isNullableFiniteNumber(row.changePercent) &&
    isNullableFiniteNumber(row.marketCap) &&
    isNullableFiniteNumber(row.fairValue) &&
    isNullableFiniteNumber(row.mispricing) &&
    isNullableFiniteNumber(row.pe) &&
    isNullableFiniteNumber(row.revenueGrowth)
  );
}

function validateClientPayload(
  raw: string,
  metadata: StoredClientSnapshotMetadata,
): void {
  const value = JSON.parse(raw) as Partial<ScreenerClientSnapshotPayload> | null;
  const expectedAsOf = new Date(metadata.refreshed_at).toISOString();
  if (
    !value ||
    value.schemaVersion !== metadata.filter_mask_schema_version ||
    value.generationId !== metadata.generation_id ||
    value.asOf !== expectedAsOf ||
    value.total !== metadata.row_count ||
    !Array.isArray(value.rows) ||
    value.rows.length !== metadata.row_count ||
    !value.rows.every((row) =>
      isValidClientRow(row, metadata.filter_mask_schema_version),
    ) ||
    new Set(value.rows.map((row) => row.marketCode)).size !== value.rows.length
  ) {
    throw new Error("The stored screener client snapshot was invalid.");
  }
}

async function readActiveSnapshotState(
  db: D1Database,
): Promise<StoredActiveSnapshotState | null> {
  return db
    .prepare(
      `SELECT active_generation_id, updated_at
       FROM screener_snapshot_state
       WHERE id = 1
       LIMIT 1`,
    )
    .first<StoredActiveSnapshotState>();
}

async function readRowsForMetadata(
  db: D1Database,
  metadata: StoredSnapshotMetadata,
  options: { preserveStoredFilterMask?: boolean } = {},
): Promise<ScreenerRow[]> {
  const result = await db
    .prepare(
      `SELECT market_code, exchange, symbol, payload_json
       FROM screener_snapshot_rows
       WHERE generation_id = ?
       ORDER BY market_code`,
    )
    .bind(metadata.generation_id)
    .all<StoredSnapshotRow>();
  const storedRows = result.results ?? [];
  if (
    !Number.isInteger(metadata.row_count) ||
    metadata.row_count <= 0 ||
    metadata.row_count > MAX_SNAPSHOT_ROWS ||
    storedRows.length !== metadata.row_count
  ) {
    throw new Error("The active screener snapshot was incomplete.");
  }
  const missingAsOf = new Date(metadata.refreshed_at).toISOString();
  const rows = storedRows.map((row) =>
    rowFromStored(
      row,
      parsePayload(
        row.payload_json,
        missingAsOf,
        metadata.filter_mask_schema_version,
      ),
      options.preserveStoredFilterMask === true,
    ),
  );
  assertCompleteRows(
    rows,
    options.preserveStoredFilterMask
      ? metadata.filter_mask_schema_version
      : SCREENER_FILTER_MASK_SCHEMA_VERSION,
  );
  return rows;
}

export async function replaceScreenerSnapshot(
  db: D1Database,
  rows: ScreenerRow[],
  options: {
    generationId?: string;
    universeRefreshedAt: number;
    refreshedAt?: number;
    dailyRunCompletion?: {
      tradingDate: string;
      leaseToken: string;
    };
  },
): Promise<DurableScreenerSnapshot> {
  assertCompleteRows(rows);
  const generationId = options.generationId ?? crypto.randomUUID();
  const refreshedAt = options.refreshedAt ?? Date.now();
  if (
    !Number.isSafeInteger(refreshedAt) ||
    refreshedAt <= 0 ||
    !Number.isSafeInteger(options.universeRefreshedAt) ||
    options.universeRefreshedAt <= 0
  ) {
    throw new Error("The screener snapshot timestamps were invalid.");
  }
  const clientPayloadJson = JSON.stringify(
    clientPayloadFromRows(generationId, refreshedAt, rows),
  );
  const clientPayloadEtag = await snapshotEtag(clientPayloadJson);
  const createdAt = Date.now();
  const generationInsert = options.dailyRunCompletion
    ? db
        .prepare(
          `INSERT INTO screener_snapshot_generations
           (id, universe_refreshed_at, refreshed_at, row_count, created_at,
            filter_mask_schema_version, client_payload_json, client_payload_etag)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1
             FROM screener_snapshot_daily_runs
             WHERE trading_date = ?
               AND status = 'running'
               AND lease_token = ?
           )`,
        )
        .bind(
          generationId,
          options.universeRefreshedAt,
          refreshedAt,
          rows.length,
          createdAt,
          SCREENER_FILTER_MASK_SCHEMA_VERSION,
          clientPayloadJson,
          clientPayloadEtag,
          options.dailyRunCompletion.tradingDate,
          options.dailyRunCompletion.leaseToken,
        )
    : db
        .prepare(
          `INSERT INTO screener_snapshot_generations
           (id, universe_refreshed_at, refreshed_at, row_count, created_at,
            filter_mask_schema_version, client_payload_json, client_payload_etag)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          generationId,
          options.universeRefreshedAt,
          refreshedAt,
          rows.length,
          createdAt,
          SCREENER_FILTER_MASK_SCHEMA_VERSION,
          clientPayloadJson,
          clientPayloadEtag,
        );
  const statements = [
    generationInsert,
  ];

  for (let start = 0; start < rows.length; start += SNAPSHOT_CHUNK_SIZE) {
    const serialized = JSON.stringify(
      rows.slice(start, start + SNAPSHOT_CHUNK_SIZE).map((row) => ({
        marketCode: row.marketCode,
        exchange: row.exchange,
        symbol: row.symbol,
        payloadJson: JSON.stringify(payloadFromRow(row)),
      })),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO screener_snapshot_rows
           (generation_id, market_code, exchange, symbol, payload_json)
           SELECT
             ?,
             json_extract(value, '$.marketCode'),
             json_extract(value, '$.exchange'),
             json_extract(value, '$.symbol'),
             json_extract(value, '$.payloadJson')
           FROM json_each(?)`,
        )
        .bind(generationId, serialized),
    );
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO screener_snapshot_state (id, active_generation_id, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           active_generation_id = excluded.active_generation_id,
           updated_at = excluded.updated_at
         WHERE excluded.updated_at > screener_snapshot_state.updated_at`,
      )
      .bind(generationId, refreshedAt),
  );
  if (options.dailyRunCompletion) {
    statements.push(
      db
        .prepare(
          `UPDATE screener_snapshot_daily_runs
           SET status = 'complete',
               completed_at = ?,
               generation_id = ?,
               error_message = NULL
           WHERE trading_date = ?
             AND status = 'running'
             AND lease_token = ?`,
        )
        .bind(
          createdAt,
          generationId,
          options.dailyRunCompletion.tradingDate,
          options.dailyRunCompletion.leaseToken,
        ),
    );
  }
  statements.push(
    db
      .prepare(
      `DELETE FROM screener_snapshot_generations
       WHERE created_at < ?
       AND id <> (
         SELECT active_generation_id
         FROM screener_snapshot_state
         WHERE id = 1
       )
       AND id NOT IN (
         SELECT generation_id
         FROM screener_snapshot_daily_runs
         WHERE generation_id IS NOT NULL
       )`,
      )
      .bind(createdAt - 7 * 24 * 60 * 60 * 1000),
  );

  await db.batch(statements);
  const active = await readActiveSnapshotState(db);
  if (!active) {
    throw new Error("The screener snapshot was stored without an active generation.");
  }
  if (active.active_generation_id !== generationId) {
    const activeSnapshot = await readScreenerSnapshot(db);
    if (!activeSnapshot) {
      throw new Error("The newer active screener snapshot could not be read.");
    }
    return activeSnapshot;
  }
  return {
    generationId,
    universeRefreshedAt: options.universeRefreshedAt,
    refreshedAt,
    rows,
  };
}

export async function readScreenerSnapshot(
  db: D1Database,
): Promise<DurableScreenerSnapshot | null> {
  const metadata = await db
    .prepare(
      `SELECT
         generation.id AS generation_id,
         generation.universe_refreshed_at AS universe_refreshed_at,
         generation.refreshed_at AS refreshed_at,
         generation.row_count AS row_count,
         generation.filter_mask_schema_version AS filter_mask_schema_version
       FROM screener_snapshot_state AS state
       INNER JOIN screener_snapshot_generations AS generation
         ON generation.id = state.active_generation_id
       WHERE state.id = 1
       LIMIT 1`,
    )
    .first<StoredSnapshotMetadata>();
  if (!metadata) return null;
  assertSupportedSchemaVersion(metadata.filter_mask_schema_version);

  const rows = await readRowsForMetadata(db, metadata);
  return {
    generationId: metadata.generation_id,
    universeRefreshedAt: metadata.universe_refreshed_at,
    refreshedAt: metadata.refreshed_at,
    rows,
  };
}

export async function readScreenerSnapshotGeneration(
  db: D1Database,
  generationId: string,
): Promise<DurableScreenerSnapshot | null> {
  const metadata = await db
    .prepare(
      `SELECT
         id AS generation_id,
         universe_refreshed_at,
         refreshed_at,
         row_count,
         filter_mask_schema_version
       FROM screener_snapshot_generations
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(generationId)
    .first<StoredSnapshotMetadata>();
  if (!metadata) return null;
  assertSupportedSchemaVersion(metadata.filter_mask_schema_version);
  const rows = await readRowsForMetadata(db, metadata);
  return {
    generationId: metadata.generation_id,
    universeRefreshedAt: metadata.universe_refreshed_at,
    refreshedAt: metadata.refreshed_at,
    rows,
  };
}

export async function readScreenerClientSnapshot(
  db: D1Database,
): Promise<ScreenerClientSnapshot | null> {
  const metadata = await db
    .prepare(
      `SELECT
         generation.id AS generation_id,
         generation.universe_refreshed_at AS universe_refreshed_at,
         generation.refreshed_at AS refreshed_at,
         generation.row_count AS row_count,
         generation.filter_mask_schema_version AS filter_mask_schema_version,
         generation.client_payload_json AS client_payload_json,
         generation.client_payload_etag AS client_payload_etag
       FROM screener_snapshot_state AS state
       INNER JOIN screener_snapshot_generations AS generation
         ON generation.id = state.active_generation_id
       WHERE state.id = 1
       LIMIT 1`,
    )
    .first<StoredClientSnapshotMetadata>();
  if (!metadata) return null;
  const isLegacyCompactPayload =
    metadata.client_payload_json === "{}" &&
    metadata.client_payload_etag === "";
  const isKnownLegacySchema = metadata.filter_mask_schema_version === 0;
  if (!isLegacyCompactPayload || !isKnownLegacySchema) {
    assertSupportedSchemaVersion(metadata.filter_mask_schema_version);
  }
  if (isLegacyCompactPayload) {
    const storedSchemaVersion = metadata.filter_mask_schema_version;
    const targetSchemaVersion =
      storedSchemaVersion === 0
        ? SCREENER_FILTER_MASK_V1_SCHEMA_VERSION
        : storedSchemaVersion;
    assertSupportedSchemaVersion(targetSchemaVersion);
    const rows = await readRowsForMetadata(db, metadata, {
      preserveStoredFilterMask: true,
    });
    const payloadJson = JSON.stringify(
      clientPayloadFromRows(
        metadata.generation_id,
        metadata.refreshed_at,
        rows,
        targetSchemaVersion,
      ),
    );
    const etag = await snapshotEtag(payloadJson);
    await db
      .prepare(
        `UPDATE screener_snapshot_generations
         SET filter_mask_schema_version = ?,
             client_payload_json = ?,
             client_payload_etag = ?
         WHERE id = ?
           AND filter_mask_schema_version = ?
           AND client_payload_json = '{}'
           AND client_payload_etag = ''`,
      )
      .bind(
        targetSchemaVersion,
        payloadJson,
        etag,
        metadata.generation_id,
        storedSchemaVersion,
      )
      .run();
    metadata.filter_mask_schema_version = targetSchemaVersion;
    metadata.client_payload_json = payloadJson;
    metadata.client_payload_etag = etag;
  }
  assertSupportedSchemaVersion(metadata.filter_mask_schema_version);
  validateClientPayload(metadata.client_payload_json, metadata);
  const expectedEtag = await snapshotEtag(metadata.client_payload_json);
  if (metadata.client_payload_etag !== expectedEtag) {
    throw new Error("The stored screener client snapshot failed its integrity check.");
  }
  return {
    generationId: metadata.generation_id,
    refreshedAt: metadata.refreshed_at,
    universeRefreshedAt: metadata.universe_refreshed_at,
    rowCount: metadata.row_count,
    schemaVersion: metadata.filter_mask_schema_version,
    etag: metadata.client_payload_etag,
    payloadJson: metadata.client_payload_json,
  };
}
