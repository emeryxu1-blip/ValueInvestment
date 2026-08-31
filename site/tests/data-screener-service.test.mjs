import assert from "node:assert/strict";
import test, { after } from "node:test";

import { register } from "tsx/esm/api";

const typescript = register({ namespace: "screener-service-data-tests" });
const {
  applyScreenerFilters,
  getScreenerResponse,
  refreshScreenerSnapshot,
  resetScreenerCacheForTests,
  ScreenerSnapshotUnavailableError,
  screenerRowFromSnapshot,
} = await typescript.import("../lib/screener/service.ts", import.meta.url);
const { normalizeSnapshot } = await typescript.import(
  "../lib/ainvest/normalize.ts",
  import.meta.url,
);
const { resetUniverseInitializationForTests } = await typescript.import(
  "../lib/screener/universe.ts",
  import.meta.url,
);
const { __resetAInvestAuthForTests } = await typescript.import(
  "../lib/ainvest/auth.ts",
  import.meta.url,
);
const {
  SCREENER_FILTER_MASK_SCHEMA_VERSION,
  SCREENER_FILTER_MASK_V3_ALL_BITS,
} = await typescript.import(
  "../lib/screener/filter-presets.ts",
  import.meta.url,
);

after(async () => {
  await typescript.unregister();
});

const AUTH_ENV_KEYS = [
  "AINVEST_USERID",
  "AINVEST_SESSIONID",
];

const query = {
  page: 1,
  pageSize: 20,
  sort: "symbol",
  order: "asc",
  filters: {},
  columns: [],
};

function storedUniverse(prefix, refreshedAt) {
  return Array.from({ length: 1000 }, (_, index) => ({
    market_code: `185:${prefix}${String(index).padStart(4, "0")}`,
    exchange: "nasdaq",
    symbol: `${prefix}${String(index).padStart(4, "0")}`,
    market_cap: 1_000_000_000_000 - index,
    market_rank: index + 1,
    refreshed_at: refreshedAt,
  }));
}

function coldSnapshotDatabase(versions, generations) {
  let versionReads = 0;
  let universeReads = 0;
  let snapshotReads = 0;
  let activeGenerationId = null;
  let activeUpdatedAt = null;
  const batches = [];
  return {
    db: {
      prepare(statement) {
        if (/SELECT active_generation_id, updated_at/.test(statement)) {
          return {
            async first() {
              return activeGenerationId
                ? {
                    active_generation_id: activeGenerationId,
                    updated_at: activeUpdatedAt,
                  }
                : null;
            },
          };
        }
        if (/FROM screener_snapshot_state AS state/.test(statement)) {
          return {
            async first() {
              snapshotReads += 1;
              return null;
            },
          };
        }
        if (/WHERE market_rank = 1/.test(statement)) {
          return {
            async first() {
              const index = Math.min(versionReads, versions.length - 1);
              versionReads += 1;
              return { refreshed_at: versions[index] };
            },
          };
        }
        if (/SELECT market_code, exchange, symbol/.test(statement)) {
          return {
            async all() {
              const index = Math.min(universeReads, generations.length - 1);
              universeReads += 1;
              return { results: generations[index] };
            },
          };
        }
        return {
          sql: statement,
          values: [],
          bind(...values) {
            this.values = values;
            return this;
          },
        };
      },
      async batch(statements) {
        batches.push(statements);
        const activation = statements.find(({ sql }) =>
          /INSERT INTO screener_snapshot_state/.test(sql),
        );
        activeGenerationId = activation?.values[0] ?? activeGenerationId;
        activeUpdatedAt = activation?.values[1] ?? activeUpdatedAt;
        return statements.map(() => ({ success: true }));
      },
    },
    counts: {
      get versionReads() {
        return versionReads;
      },
      get universeReads() {
        return universeReads;
      },
      get snapshotReads() {
        return snapshotReads;
      },
      get snapshotWrites() {
        return batches.length;
      },
    },
    batches,
  };
}

function snapshotFetcher({ missingValueFor, omitIndicator } = {}) {
  let detailRequests = 0;
  return {
    async fetch(_url, init = {}) {
      const request = JSON.parse(String(init.body));
      assert.equal(request.symbol[0].type, "market_code");
      const marketCodes = request.symbol[0].value;
      assert.ok(request.indicator.length > 3);
      detailRequests += 1;

      // Keep the scan pending long enough for a second cold caller to join it.
      await new Promise((resolve) => setTimeout(resolve, 2));
      const returnedIndicators = request.indicator.filter(
        (indicator) => indicator.req_unique_id !== omitIndicator,
      );
      return Response.json({
        status_code: 0,
        status_msg: "success",
        data: {
          indicator: returnedIndicators,
          data: marketCodes.map((symbolCode) => ({
            symbol_code: symbolCode,
            value: returnedIndicators.map((indicator) => {
              if (indicator.req_unique_id === missingValueFor) {
                return { v: null };
              }
              if (indicator.req_unique_id === "company") {
                return { v: `Company ${symbolCode}` };
              }
              if (indicator.req_unique_id === "sector") {
                return { v: "Technology" };
              }
              if (indicator.req_unique_id === "fairValueModule") {
                return { v: null };
              }
              return { v: 1 };
            }),
          })),
          page: { total: marketCodes.length },
        },
      });
    },
    counts: {
      get detailRequests() {
        return detailRequests;
      },
    },
  };
}

function storedSnapshotDatabase({
  generationId = "stored-generation",
  universeRefreshedAt = 1_800_000_000_000,
  refreshedAt = universeRefreshedAt + 123,
  symbol = "STORED",
} = {}) {
  let metadataReads = 0;
  let rowReads = 0;
  const payload = JSON.stringify({
    company: `Company ${symbol}`,
    companySource: "live",
    price: 10,
    changePercent: 1,
    marketCap: 1_000_000,
    fairValue: 20,
    mispricing: 1,
    pe: 10,
    revenueGrowth: 12,
    netIncome: 100,
    freeCashFlow: 80,
    debtToEquity: 20,
    evToEbitda: 8,
    returnOnInvestedCapital: 20,
    netDebt: 50,
    operatingMarginStable5Y: true,
    operatingMarginTrend5Y: 0.01,
    operatingMarginsExpanding5Y: true,
    sector: "Technology",
    filterMask: SCREENER_FILTER_MASK_V3_ALL_BITS,
    asOf: {
      company: null,
      price: null,
      changePercent: null,
      marketCap: null,
      fairValue: null,
      mispricing: null,
      pe: null,
      revenueGrowth: null,
      netIncome: null,
      freeCashFlow: null,
      debtToEquity: null,
      evToEbitda: null,
      returnOnInvestedCapital: null,
      netDebt: null,
      operatingMarginStable5Y: null,
      operatingMarginTrend5Y: null,
      operatingMarginsExpanding5Y: null,
      sector: null,
    },
  });
  return {
    db: {
      prepare(statement) {
        if (/FROM screener_snapshot_state AS state/.test(statement)) {
          return {
            async first() {
              metadataReads += 1;
              return {
                generation_id: generationId,
                universe_refreshed_at: universeRefreshedAt,
                refreshed_at: refreshedAt,
                row_count: 1,
                filter_mask_schema_version:
                  SCREENER_FILTER_MASK_SCHEMA_VERSION,
              };
            },
          };
        }
        if (/FROM screener_snapshot_rows/.test(statement)) {
          return {
            bind(value) {
              assert.equal(value, generationId);
              return this;
            },
            async all() {
              rowReads += 1;
              return {
                results: [
                  {
                    market_code: `185:${symbol}`,
                    exchange: "nasdaq",
                    symbol,
                    payload_json: payload,
                  },
                ],
              };
            },
          };
        }
        throw new Error(`Unexpected D1 statement in stored snapshot test: ${statement}`);
      },
      async batch() {
        throw new Error("A stored snapshot must not be replaced while serving it.");
      },
    },
    counts: {
      get metadataReads() {
        return metadataReads;
      },
      get rowReads() {
        return rowReads;
      },
    },
    generationId,
    universeRefreshedAt,
    refreshedAt,
  };
}

async function withScreenerTestEnvironment(callback) {
  const previousFetch = globalThis.fetch;
  const previousAuth = Object.fromEntries(
    AUTH_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  for (const key of AUTH_ENV_KEYS) delete process.env[key];
  process.env.AINVEST_USERID = "unit";
  process.env.AINVEST_SESSIONID = "unit";
  resetScreenerCacheForTests();
  resetUniverseInitializationForTests();
  __resetAInvestAuthForTests();
  try {
    return await callback();
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of AUTH_ENV_KEYS) {
      if (previousAuth[key] == null) delete process.env[key];
      else process.env[key] = previousAuth[key];
    }
    resetScreenerCacheForTests();
    resetUniverseInitializationForTests();
    __resetAInvestAuthForTests();
  }
}

test("serves a durable snapshot without any request-time market-data call", async () => {
  await withScreenerTestEnvironment(async () => {
    const database = storedSnapshotDatabase();
    globalThis.fetch = async () => {
      throw new Error("The upstream must not be called for a stored snapshot.");
    };

    const { response, status } = await getScreenerResponse(query, database.db);

    assert.equal(status, 200);
    assert.equal(response.data.length, 1);
    assert.equal(response.data[0].symbol, "STORED");
    assert.equal(response.snapshot.generationId, database.generationId);
    assert.equal(response.asOf, new Date(database.refreshedAt).toISOString());
    assert.equal(database.counts.metadataReads, 1);
    assert.equal(database.counts.rowReads, 1);
  });
});

test("an unseeded public request fails safely without contacting upstream", async () => {
  await withScreenerTestEnvironment(async () => {
    const generation = 1_800_000_000_000;
    const database = coldSnapshotDatabase(
      [generation],
      [storedUniverse("T", generation)],
    );
    let upstreamCalls = 0;
    globalThis.fetch = async () => {
      upstreamCalls += 1;
      throw new Error("The public request path must not contact upstream.");
    };

    await assert.rejects(
      () => getScreenerResponse(query, database.db),
      (error) => {
        assert.ok(error instanceof ScreenerSnapshotUnavailableError);
        assert.match(error.message, /No stored screener snapshot/);
        return true;
      },
    );

    assert.equal(upstreamCalls, 0);
    assert.equal(database.counts.universeReads, 0);
    assert.equal(database.counts.versionReads, 0);
    assert.equal(database.counts.snapshotReads, 1);
    assert.equal(database.counts.snapshotWrites, 0);
  });
});

test("a scheduled refresh seeds one reusable durable generation", async () => {
  await withScreenerTestEnvironment(async () => {
    const generation = 1_800_000_000_000;
    const database = coldSnapshotDatabase(
      [generation],
      [storedUniverse("T", generation)],
    );
    const upstream = snapshotFetcher();
    globalThis.fetch = upstream.fetch;

    const snapshot = await refreshScreenerSnapshot(database.db);
    const { response, status } = await getScreenerResponse(query, database.db);

    assert.equal(upstream.counts.detailRequests, 5);
    assert.equal(database.counts.universeReads, 1);
    assert.equal(database.counts.versionReads, 1);
    assert.equal(database.counts.snapshotReads, 0);
    assert.equal(database.counts.snapshotWrites, 1);
    assert.equal(database.batches[0].length, 13);
    assert.equal(status, 200);
    assert.equal(response.snapshot.generationId, snapshot.generationId);
    assert.equal(response.data.length, 20);
  });
});

test("a scheduled refresh retries once and publishes only the latest universe generation", async () => {
  await withScreenerTestEnvironment(async () => {
    const oldGeneration = 1_800_000_000_000;
    const newGeneration = oldGeneration + 1;
    const database = coldSnapshotDatabase(
      [newGeneration, newGeneration],
      [
        storedUniverse("O", oldGeneration),
        storedUniverse("N", newGeneration),
      ],
    );
    const upstream = snapshotFetcher();
    globalThis.fetch = upstream.fetch;

    const snapshot = await refreshScreenerSnapshot(database.db);

    assert.equal(upstream.counts.detailRequests, 10);
    assert.equal(database.counts.universeReads, 2);
    assert.equal(database.counts.versionReads, 2);
    assert.equal(database.counts.snapshotWrites, 1);
    assert.equal(snapshot.rows[0].marketCode, "185:N0000");
    assert.ok(snapshot.rows.every((row) => row.marketCode.startsWith("185:N")));
  });
});

test("does not activate a generation with missing filter descriptors or coverage", async () => {
  await withScreenerTestEnvironment(async () => {
    const generation = 1_800_000_000_000;
    for (const upstream of [
      snapshotFetcher({ omitIndicator: "returnOnInvestedCapital" }),
      snapshotFetcher({ missingValueFor: "netDebt" }),
    ]) {
      const database = coldSnapshotDatabase(
        [generation],
        [storedUniverse("G", generation)],
      );
      globalThis.fetch = upstream.fetch;
      await assert.rejects(
        refreshScreenerSnapshot(database.db),
        /omitted required (?:indicators|filter coverage)/i,
      );
      assert.equal(database.counts.snapshotWrites, 0);
      resetScreenerCacheForTests();
      resetUniverseInitializationForTests();
    }
  });
});

function filterRow(symbol, options = {}) {
  const numberMetric = (value = 1) => ({ value, source: "live", asOf: null });
  return {
    marketCode: `185:${symbol}`,
    exchange: options.exchange ?? "nasdaq",
    symbol,
    company: { value: symbol, source: "live", asOf: null },
    price: numberMetric(),
    changePercent: numberMetric(
      Object.hasOwn(options, "changePercent") ? options.changePercent : 1,
    ),
    marketCap: numberMetric(),
    fairValue: numberMetric(),
    mispricing: numberMetric(),
    pe: numberMetric(Object.hasOwn(options, "pe") ? options.pe : 1),
    revenueGrowth: numberMetric(),
    netIncome: numberMetric(),
    freeCashFlow: numberMetric(),
    debtToEquity: numberMetric(
      Object.hasOwn(options, "debtToEquity") ? options.debtToEquity : 1,
    ),
    evToEbitda: numberMetric(),
    returnOnInvestedCapital: numberMetric(),
    netDebt: numberMetric(),
    operatingMarginStable5Y: {
      value: options.stable ?? null,
      source: "derived",
      asOf: null,
    },
    operatingMarginTrend5Y: {
      value: options.trend ?? null,
      source: "derived",
      asOf: null,
    },
    operatingMarginsExpanding5Y: {
      value:
        options.expanding ??
        (options.trend == null ? null : options.trend > 0),
      source: "derived",
      asOf: null,
    },
    sector: { value: "Technology", source: "live", asOf: null },
    filterMask: 0,
    currency: "USD",
  };
}

test("enforces US-major scope and excludes missing operating-margin histories", () => {
  const rows = [
    filterRow("STABLE", { stable: true, trend: 0.01 }),
    filterRow("VOLATILE", { stable: false, trend: 0.02 }),
    filterRow("CONTRACT", { stable: true, trend: -0.01 }),
    filterRow("MISSING"),
    filterRow("OTC", { exchange: "otc", stable: true, trend: 0.01 }),
  ];

  assert.deepEqual(
    applyScreenerFilters(rows, {
      fairValueGtePrice: false,
      stableOperatingMargins5Y: true,
    }).map((row) => row.symbol),
    ["STABLE", "CONTRACT"],
  );
  assert.deepEqual(
    applyScreenerFilters(rows, {
      fairValueGtePrice: false,
      expandingOperatingMargins5Y: true,
    }).map((row) => row.symbol),
    ["STABLE", "VOLATILE"],
  );
  assert.deepEqual(
    applyScreenerFilters(rows, { fairValueGtePrice: false }).map(
      (row) => row.symbol,
    ),
    ["STABLE", "VOLATILE", "CONTRACT", "MISSING"],
  );
});

test("requires a finite positive P/E at or below the generic maximum", () => {
  const rows = [
    filterRow("BOUNDARY", { pe: 15 }),
    filterRow("POSITIVE", { pe: 0.01 }),
    filterRow("ABOVE", { pe: 15.000001 }),
    filterRow("ZERO", { pe: 0 }),
    filterRow("NEGATIVE", { pe: -1 }),
    filterRow("MISSING", { pe: null }),
    filterRow("NONFINITE", { pe: Number.NaN }),
  ];

  assert.deepEqual(
    applyScreenerFilters(rows, {
      fairValueGtePrice: false,
      maxPe: 15,
    }).map((row) => row.symbol),
    ["BOUNDARY", "POSITIVE"],
  );
});

test("keeps retired direct momentum and debt filters operational", () => {
  const rows = [
    filterRow("PASS", { changePercent: 0, debtToEquity: 50 }),
    filterRow("DOWN", { changePercent: -0.01, debtToEquity: 50 }),
    filterRow("LEVERED", { changePercent: 0, debtToEquity: 50.01 }),
  ];

  assert.deepEqual(
    applyScreenerFilters(rows, {
      fairValueGtePrice: false,
      minChangePercent: 0,
      maxDebtToEquity: 50,
    }).map((row) => row.symbol),
    ["PASS"],
  );
});

test("maps a reordered historical module into screener margin metrics", () => {
  const history = {
    data: [20, 22, 21, 23, 24].map((profit, index) => ({
      subject: {
        year: String(2021 + index),
        period: "FY",
        endDate: `${2021 + index}-12-31`,
      },
      operating_income_total: { value: "100" },
      operating_profit: { value: String(profit) },
    })),
  };
  const normalized = normalizeSnapshot({
    data: {
      indicator: [
        {
          id: "stockdiag_fundamental_past_revenuebreakdown",
          req_unique_id: "operatingMarginHistory",
        },
        {
          id: "capital_invested_return_ratio_ttm",
          req_unique_id: "returnOnInvestedCapital",
          attr: { value_type: "ratio2" },
        },
        { id: "55", req_unique_id: "company" },
      ],
      data: [
        {
          symbol_code: "185:MSFT",
          value: [{ v: history }, { v: 0.15 }, { v: "Microsoft" }],
        },
      ],
    },
  }).rows[0];
  const row = screenerRowFromSnapshot(normalized);

  assert.equal(row.company.value, "Microsoft");
  assert.equal(row.currency, "USD");
  assert.equal(row.price.unit, "USD");
  assert.equal(row.marketCap.unit, "USD");
  assert.equal(row.returnOnInvestedCapital.value, 15);
  assert.equal(row.returnOnInvestedCapital.unit, "%");
  assert.equal(row.operatingMarginStable5Y.value, true);
  assert.ok(Math.abs(row.operatingMarginTrend5Y.value - 0.009) < 1e-12);
  assert.equal(row.operatingMarginsExpanding5Y.value, true);
});

test("uses the latest positive AInvest DCF prediction for screener fair value", () => {
  const normalized = normalizeSnapshot({
    data: {
      indicator: [
        { id: "price", req_unique_id: "price" },
        { id: "stockdiag_fundamental_value_dcf", req_unique_id: "fairValueModule" },
      ],
      data: [{
        symbol_code: "185:MSFT",
        value: [
          { v: 100 },
          { v: { predicted_prices: [["20261231", 150], ["20271231", 162.5]] } },
        ],
      }],
    },
  }).rows[0];
  const row = screenerRowFromSnapshot(normalized);
  assert.equal(row.fairValue.value, 162.5);
  assert.equal(row.fairValue.unit, "USD");
  assert.ok(Math.abs(row.mispricing.value - 0.625) < 1e-12);
});
