import { fetchAInvest } from "../ainvest/client.ts";
import { normalizeSnapshot, numberValue } from "../ainvest/normalize.ts";
import { buildTopMarketCapUniverseRequest } from "../ainvest/requests.ts";
import {
  routeExchangeForMarketCode,
  symbolFromMarketCode,
} from "../market-codes.ts";

const UNIVERSE_SIZE = 1000;
export const TOP_MARKET_CAP_REFRESH_CRON = "47 3 L * *";

export type TopMarketCapUniverseMember = {
  marketCode: string;
  exchange: string;
  symbol: string;
  marketCap: number;
  marketRank: number;
  refreshedAt: number;
};

type StoredUniverseMember = {
  market_code: string;
  exchange: string;
  symbol: string;
  market_cap: number;
  market_rank: number;
  refreshed_at: number;
};

type StoredUniverseVersion = {
  refreshed_at: number;
};

let initializationInFlight: Promise<TopMarketCapUniverseMember[]> | null = null;

function assertCompleteUniverse(rows: TopMarketCapUniverseMember[]) {
  const marketCodes = new Set(rows.map((row) => row.marketCode));
  if (
    rows.length !== UNIVERSE_SIZE ||
    marketCodes.size !== UNIVERSE_SIZE ||
    rows.some(
      (row, index) =>
        !row.marketCode ||
        !row.symbol ||
        !Number.isFinite(row.marketCap) ||
        row.marketCap < 0 ||
        row.marketRank !== index + 1,
    )
  ) {
    throw new Error("The Top 1,000 universe refresh was incomplete.");
  }
}

export function assertExactUniverseMarketCodes(
  expectedMarketCodes: string[],
  actualMarketCodes: string[],
): void {
  const expected = new Set(expectedMarketCodes);
  const actual = new Set(actualMarketCodes);
  if (
    expected.size !== expectedMarketCodes.length ||
    actual.size !== actualMarketCodes.length ||
    actualMarketCodes.length !== expectedMarketCodes.length ||
    [...actual].some((marketCode) => !expected.has(marketCode))
  ) {
    throw new Error("The Top 1,000 valuation scan returned incomplete membership.");
  }
}

export function topMarketCapUniverseFromPayload(
  payload: unknown,
  refreshedAt = Date.now(),
): TopMarketCapUniverseMember[] {
  const rows = normalizeSnapshot(payload).rows
    .map((row) => {
      const marketCode = row.symbolCode.trim();
      const symbol = symbolFromMarketCode(marketCode).trim().toUpperCase();
      const marketCap = numberValue(row, "marketCap");
      if (!marketCode || !symbol || marketCap == null || marketCap < 0) {
        throw new Error("The Top 1,000 universe refresh contained an invalid security.");
      }
      return {
        marketCode,
        exchange: routeExchangeForMarketCode(marketCode),
        symbol,
        marketCap,
      };
    })
    .sort(
      (left, right) =>
        right.marketCap - left.marketCap ||
        left.marketCode.localeCompare(right.marketCode),
    )
    .map((row, index) => ({
      ...row,
      marketRank: index + 1,
      refreshedAt,
    }));
  assertCompleteUniverse(rows);
  return rows;
}

export async function readTopMarketCapUniverse(
  db: D1Database,
): Promise<TopMarketCapUniverseMember[]> {
  const result = await db
    .prepare(
      `SELECT market_code, exchange, symbol, market_cap, market_rank, refreshed_at
       FROM top_market_cap_universe
       ORDER BY market_rank
       LIMIT 1000`,
    )
    .all<StoredUniverseMember>();
  return (result.results ?? []).map((row) => ({
    marketCode: row.market_code,
    exchange: row.exchange,
    symbol: row.symbol,
    marketCap: row.market_cap,
    marketRank: row.market_rank,
    refreshedAt: row.refreshed_at,
  }));
}

export async function readTopMarketCapUniverseVersion(
  db: D1Database,
): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT refreshed_at
       FROM top_market_cap_universe
       WHERE market_rank = 1
       LIMIT 1`,
    )
    .first<StoredUniverseVersion>();
  return typeof row?.refreshed_at === "number" &&
    Number.isFinite(row.refreshed_at)
    ? row.refreshed_at
    : null;
}

export async function replaceTopMarketCapUniverse(
  db: D1Database,
  rows: TopMarketCapUniverseMember[],
): Promise<void> {
  assertCompleteUniverse(rows);
  const serializedRows = JSON.stringify(rows);
  await db.batch([
    db.prepare("DELETE FROM top_market_cap_universe"),
    db
      .prepare(
        `INSERT INTO top_market_cap_universe
         (market_code, exchange, symbol, market_cap, market_rank, refreshed_at)
         SELECT
           json_extract(value, '$.marketCode'),
           json_extract(value, '$.exchange'),
           json_extract(value, '$.symbol'),
           json_extract(value, '$.marketCap'),
           json_extract(value, '$.marketRank'),
           json_extract(value, '$.refreshedAt')
         FROM json_each(?)`,
      )
      .bind(serializedRows),
  ]);
}

export async function refreshTopMarketCapUniverse(
  db: D1Database,
  options: { fetcher?: typeof fetch; refreshedAt?: number } = {},
): Promise<TopMarketCapUniverseMember[]> {
  const payload = await fetchAInvest(
    "snapshot",
    buildTopMarketCapUniverseRequest(),
    { fetcher: options.fetcher },
  );
  const rows = topMarketCapUniverseFromPayload(
    payload,
    options.refreshedAt ?? Date.now(),
  );
  await replaceTopMarketCapUniverse(db, rows);
  return rows;
}

export async function ensureTopMarketCapUniverse(
  db: D1Database,
): Promise<TopMarketCapUniverseMember[]> {
  const stored = await readTopMarketCapUniverse(db);
  if (stored.length === UNIVERSE_SIZE) return stored;
  initializationInFlight ??= refreshTopMarketCapUniverse(db).finally(() => {
    initializationInFlight = null;
  });
  return initializationInFlight;
}

export function resetUniverseInitializationForTests() {
  initializationInFlight = null;
}
