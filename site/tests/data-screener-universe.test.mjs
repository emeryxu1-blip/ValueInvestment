import assert from "node:assert/strict";
import test from "node:test";

import {
  assertExactUniverseMarketCodes,
  readTopMarketCapUniverseVersion,
  replaceTopMarketCapUniverse,
  TOP_MARKET_CAP_REFRESH_CRON,
  topMarketCapUniverseFromPayload,
} from "../lib/screener/universe.ts";

function universePayload(count = 1000, duplicateLast = false) {
  return {
    data: {
      indicator: [
        { id: "55", req_unique_id: "company" },
        { id: "total_market_value", req_unique_id: "marketCap" },
      ],
      data: Array.from({ length: count }, (_, index) => ({
        symbol_code:
          duplicateLast && index === count - 1
            ? "185:T0000"
            : `185:T${String(index).padStart(4, "0")}`,
        value: [
          { v: `Company ${index}` },
          { v: 10_000_000_000_000 - index * 1_000_000 },
        ],
      })),
      page: { total: 20_000 },
    },
  };
}

test("normalizes a complete ranked Top 1,000 universe", () => {
  const refreshedAt = 1_800_000_000_000;
  const rows = topMarketCapUniverseFromPayload(
    universePayload(),
    refreshedAt,
  );
  assert.equal(rows.length, 1000);
  assert.deepEqual(rows[0], {
    marketCode: "185:T0000",
    exchange: "nasdaq",
    symbol: "T0000",
    marketCap: 10_000_000_000_000,
    marketRank: 1,
    refreshedAt,
  });
  assert.equal(rows.at(-1).marketRank, 1000);
  assert.equal(new Set(rows.map((row) => row.marketCode)).size, 1000);
  assert.equal(new Set(rows.map((row) => row.refreshedAt)).size, 1);
});

test("rejects partial or duplicate universe generations before storage", () => {
  assert.throws(
    () => topMarketCapUniverseFromPayload(universePayload(999)),
    /incomplete/i,
  );
  assert.throws(
    () => topMarketCapUniverseFromPayload(universePayload(1000, true)),
    /incomplete/i,
  );
});

test("rejects partial, duplicate, or out-of-universe valuation batches", () => {
  assert.doesNotThrow(() =>
    assertExactUniverseMarketCodes(
      ["185:MSFT", "185:AAPL"],
      ["185:AAPL", "185:MSFT"],
    ),
  );
  assert.throws(
    () => assertExactUniverseMarketCodes(["185:MSFT", "185:AAPL"], ["185:MSFT"]),
    /incomplete membership/i,
  );
  assert.throws(
    () =>
      assertExactUniverseMarketCodes(
        ["185:MSFT", "185:AAPL"],
        ["185:MSFT", "185:MSFT"],
      ),
    /incomplete membership/i,
  );
  assert.throws(
    () =>
      assertExactUniverseMarketCodes(
        ["185:MSFT", "185:AAPL"],
        ["185:MSFT", "185:NVDA"],
      ),
    /incomplete membership/i,
  );
});

test("replaces the universe in one bounded D1 batch", async () => {
  const rows = topMarketCapUniverseFromPayload(universePayload());
  let batch = null;
  const db = {
    prepare(sql) {
      return {
        sql,
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
      };
    },
    async batch(statements) {
      batch = statements;
      return [];
    },
  };

  await replaceTopMarketCapUniverse(db, rows);
  assert.ok(batch);
  assert.equal(batch[0].sql, "DELETE FROM top_market_cap_universe");
  assert.equal(batch.length, 2);
  assert.equal(batch[1].values.length, 1);
  assert.equal(JSON.parse(batch[1].values[0]).length, 1000);
  assert.match(batch[1].sql, /FROM json_each\(\?\)/);
});

test("checks the one-row universe version without loading all members", async () => {
  let sql = "";
  const db = {
    prepare(statement) {
      sql = statement;
      return {
        async first() {
          return { refreshed_at: 1_800_000_000_000 };
        },
      };
    },
  };
  assert.equal(
    await readTopMarketCapUniverseVersion(db),
    1_800_000_000_000,
  );
  assert.match(sql, /WHERE market_rank = 1/);
  assert.doesNotMatch(sql, /SELECT market_code/);
});

test("uses a last-day-of-month UTC Cron Trigger", () => {
  assert.equal(TOP_MARKET_CAP_REFRESH_CRON, "47 3 L * *");
});
