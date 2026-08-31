import assert from "node:assert/strict";
import test, { after } from "node:test";

import { register } from "tsx/esm/api";

const typescript = register({ namespace: "screener-snapshot-data-tests" });
const {
  readScreenerClientSnapshot,
  readScreenerSnapshot,
  replaceScreenerSnapshot,
} = await typescript.import("../lib/screener/snapshot.ts", import.meta.url);
const {
  SCREENER_FILTER_MASK_RETIRED_BITS,
  SCREENER_FILTER_MASK_SCHEMA_VERSION,
  SCREENER_FILTER_MASK_V1_ALL_BITS,
  SCREENER_FILTER_MASK_V1_SCHEMA_VERSION,
  SCREENER_FILTER_MASK_V2_ALL_BITS,
  SCREENER_FILTER_MASK_V2_SCHEMA_VERSION,
  SCREENER_FILTER_MASK_V3_ALL_BITS,
  SCREENER_FILTER_MASK_V3_SCHEMA_VERSION,
  screenerFilterMask,
} = await typescript.import(
  "../lib/screener/filter-presets.ts",
  import.meta.url,
);
const { SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION } = await typescript.import(
  "../lib/screener/client-snapshot-contract.ts",
  import.meta.url,
);

after(async () => {
  await typescript.unregister();
});

const metric = (value, source = "live", asOf = "2026-08-10T00:00:00.000Z") => ({
  value,
  source,
  asOf,
});

function snapshotRow(symbol, options = {}) {
  return {
    marketCode: `185:${symbol}`,
    exchange: options.exchange ?? "nasdaq",
    symbol,
    company: metric(options.company ?? `Company ${symbol}`),
    price: metric(options.price ?? 10),
    changePercent: metric(options.changePercent ?? 1),
    marketCap: metric(options.marketCap ?? 1_000_000),
    fairValue: metric(options.fairValue ?? 20),
    mispricing: metric(options.mispricing ?? 1, "derived"),
    pe: metric(options.pe ?? 10),
    revenueGrowth: metric(options.revenueGrowth ?? 12),
    netIncome: metric(options.netIncome ?? 100),
    freeCashFlow: metric(options.freeCashFlow ?? 80),
    debtToEquity: metric(options.debtToEquity ?? 20),
    evToEbitda: metric(options.evToEbitda ?? 8),
    returnOnInvestedCapital: metric(
      options.returnOnInvestedCapital ?? 20,
    ),
    netDebt: metric(options.netDebt ?? 50),
    operatingMarginStable5Y: metric(
      options.operatingMarginStable5Y ?? true,
      "derived",
    ),
    operatingMarginTrend5Y: metric(
      options.operatingMarginTrend5Y ?? 0.01,
      "derived",
    ),
    operatingMarginsExpanding5Y: metric(
      options.operatingMarginsExpanding5Y ?? true,
      "derived",
    ),
    sector: metric(options.sector ?? "Technology"),
    filterMask: options.filterMask ?? 0,
    currency: options.currency ?? "USD",
  };
}

function storedPayload(row) {
  return JSON.stringify({
    company: row.company.value,
    companySource: row.company.source,
    price: row.price.value,
    changePercent: row.changePercent.value,
    marketCap: row.marketCap.value,
    fairValue: row.fairValue.value,
    mispricing: row.mispricing.value,
    pe: row.pe.value,
    revenueGrowth: row.revenueGrowth.value,
    netIncome: row.netIncome.value,
    freeCashFlow: row.freeCashFlow.value,
    debtToEquity: row.debtToEquity.value,
    evToEbitda: row.evToEbitda.value,
    returnOnInvestedCapital: row.returnOnInvestedCapital.value,
    netDebt: row.netDebt.value,
    operatingMarginStable5Y: row.operatingMarginStable5Y.value,
    operatingMarginTrend5Y: row.operatingMarginTrend5Y.value,
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
  });
}

function preparedStatement(sql) {
  return {
    sql,
    values: [],
    bind(...values) {
      this.values = values;
      return this;
    },
  };
}

test("persists every chunk and the generation switch in one atomic D1 batch", async () => {
  const batches = [];
  const db = {
    prepare(sql) {
      const statement = preparedStatement(sql);
      statement.first = async () => {
        if (!/SELECT active_generation_id, updated_at/.test(sql)) {
          throw new Error(`Unexpected first() statement: ${sql}`);
        }
        return {
          active_generation_id: "generation-205",
          updated_at: 1_800_000_000_123,
        };
      };
      return statement;
    },
    async batch(statements) {
      batches.push(statements);
      return statements.map(() => ({ success: true }));
    },
  };
  const rows = Array.from({ length: 205 }, (_, index) =>
    snapshotRow(`T${String(index).padStart(4, "0")}`, {
      filterMask: index & SCREENER_FILTER_MASK_V3_ALL_BITS,
    }),
  );

  const snapshot = await replaceScreenerSnapshot(db, rows, {
    generationId: "generation-205",
    universeRefreshedAt: 1_800_000_000_000,
    refreshedAt: 1_800_000_000_123,
  });

  assert.equal(snapshot.generationId, "generation-205");
  assert.equal(batches.length, 1, "all writes must share one transactional batch");
  const statements = batches[0];
  assert.equal(statements.length, 6);
  assert.match(statements[0].sql, /INSERT INTO screener_snapshot_generations/);
  assert.deepEqual(statements[0].values.slice(0, 4), [
    "generation-205",
    1_800_000_000_000,
    1_800_000_000_123,
    205,
  ]);
  assert.equal(
    statements[0].values[5],
    SCREENER_FILTER_MASK_V3_SCHEMA_VERSION,
  );
  const clientPayload = JSON.parse(statements[0].values[6]);
  assert.equal(
    clientPayload.schemaVersion,
    SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION,
  );
  assert.equal(clientPayload.generationId, "generation-205");
  assert.equal(clientPayload.total, 205);
  assert.equal(clientPayload.rows.length, 205);
  assert.match(statements[0].values[7], /^sha256-[a-f0-9]{64}$/);

  const rowStatements = statements.filter((statement) =>
    /INSERT INTO screener_snapshot_rows/.test(statement.sql),
  );
  assert.equal(rowStatements.length, 3);
  const serializedChunks = rowStatements.map((statement) => {
    assert.equal(statement.values[0], "generation-205");
    return JSON.parse(statement.values[1]);
  });
  assert.deepEqual(serializedChunks.map((chunk) => chunk.length), [100, 100, 5]);
  assert.equal(serializedChunks.flat().length, 205);
  assert.deepEqual(
    serializedChunks.flat().map((row) => row.marketCode),
    rows.map((row) => row.marketCode),
  );

  const stateIndex = statements.findIndex((statement) =>
    /INSERT INTO screener_snapshot_state/.test(statement.sql),
  );
  assert.equal(stateIndex, 4, "the active pointer must follow every row chunk");
  assert.deepEqual(statements[stateIndex].values, [
    "generation-205",
    1_800_000_000_123,
  ]);
  assert.match(
    statements[stateIndex].sql,
    /excluded\.updated_at > screener_snapshot_state\.updated_at/,
  );
  assert.match(statements.at(-1).sql, /DELETE FROM screener_snapshot_generations/);
});

test("atomically completes and retains a dated daily generation", async () => {
  let statements = null;
  const refreshedAt = 1_800_000_000_123;
  const db = {
    prepare(sql) {
      const statement = preparedStatement(sql);
      statement.first = async () => {
        if (!/SELECT active_generation_id, updated_at/.test(sql)) {
          throw new Error(`Unexpected first() statement: ${sql}`);
        }
        return {
          active_generation_id: "daily-2027-01-15",
          updated_at: refreshedAt,
        };
      };
      return statement;
    },
    async batch(batch) {
      statements = batch;
      return batch.map(() => ({ success: true }));
    },
  };

  await replaceScreenerSnapshot(db, [snapshotRow("DAILY")], {
    generationId: "daily-2027-01-15",
    universeRefreshedAt: refreshedAt - 1,
    refreshedAt,
    dailyRunCompletion: {
      tradingDate: "2027-01-15",
      leaseToken: "lease-daily",
    },
  });

  const completion = statements.find((statement) =>
    /UPDATE screener_snapshot_daily_runs/.test(statement.sql),
  );
  assert.ok(completion, "the run ledger update must share the snapshot batch");
  assert.deepEqual(completion.values.slice(1), [
    "daily-2027-01-15",
    "2027-01-15",
    "lease-daily",
  ]);
  const cleanup = statements.at(-1);
  assert.match(cleanup.sql, /FROM screener_snapshot_daily_runs/);
  assert.match(cleanup.sql, /generation_id IS NOT NULL/);
  assert.ok(
    statements.indexOf(completion) < statements.indexOf(cleanup),
    "daily completion must precede cleanup in the transaction",
  );
});

test("does not report a replacement when the atomic D1 batch fails", async () => {
  const db = {
    prepare: preparedStatement,
    async batch() {
      throw new Error("transaction aborted");
    },
  };

  await assert.rejects(
    replaceScreenerSnapshot(db, [snapshotRow("FAIL")], {
      generationId: "failed-generation",
      universeRefreshedAt: 1,
      refreshedAt: 2,
    }),
    /transaction aborted/,
  );
});

function readDatabase(metadata, rows) {
  return {
    prepare(sql) {
      if (/FROM screener_snapshot_state AS state/.test(sql)) {
        return {
          async first() {
            return metadata;
          },
        };
      }
      if (/FROM screener_snapshot_rows/.test(sql)) {
        return {
          bind(generationId) {
            assert.equal(generationId, metadata?.generation_id);
            return this;
          },
          async all() {
            return { results: rows };
          },
        };
      }
      throw new Error(`Unexpected snapshot read statement: ${sql}`);
    },
  };
}

test("rejects incomplete and corrupt active snapshot reads", async (context) => {
  const valid = snapshotRow("VALID", { filterMask: 3 });
  const metadata = {
    generation_id: "active-generation",
    universe_refreshed_at: 1_800_000_000_000,
    refreshed_at: 1_800_000_000_123,
    row_count: 1,
    filter_mask_schema_version: SCREENER_FILTER_MASK_SCHEMA_VERSION,
  };
  const validStored = {
    market_code: valid.marketCode,
    exchange: valid.exchange,
    symbol: valid.symbol,
    payload_json: storedPayload(valid),
  };

  await context.test("metadata count does not match stored rows", async () => {
    await assert.rejects(
      readScreenerSnapshot(
        readDatabase({ ...metadata, row_count: 2 }, [validStored]),
      ),
      /incomplete/i,
    );
  });

  await context.test("payload is not valid JSON", async () => {
    await assert.rejects(
      readScreenerSnapshot(
        readDatabase(metadata, [
          { ...validStored, payload_json: "{not-json" },
        ]),
      ),
    );
  });

  await context.test("payload violates the required filter-mask contract", async () => {
    const corrupt = JSON.parse(validStored.payload_json);
    corrupt.filterMask = -1;
    await assert.rejects(
      readScreenerSnapshot(
        readDatabase(metadata, [
          { ...validStored, payload_json: JSON.stringify(corrupt) },
        ]),
      ),
      /invalid row/i,
    );
  });

  for (const retiredBit of [1 << 4, 1 << 5, 1 << 8]) {
    await context.test(
      `schema three rejects retired filter bit ${retiredBit}`,
      async () => {
        const corrupt = JSON.parse(validStored.payload_json);
        corrupt.filterMask = retiredBit;
        await assert.rejects(
          readScreenerSnapshot(
            readDatabase(metadata, [
              { ...validStored, payload_json: JSON.stringify(corrupt) },
            ]),
          ),
          /invalid row/i,
        );
      },
    );
  }

  await context.test("schema two accepts its complete historical bit range", async () => {
    const historical = JSON.parse(validStored.payload_json);
    historical.filterMask = SCREENER_FILTER_MASK_V2_ALL_BITS;
    const snapshot = await readScreenerSnapshot(
      readDatabase(
        { ...metadata, filter_mask_schema_version: SCREENER_FILTER_MASK_V2_SCHEMA_VERSION },
        [{ ...validStored, payload_json: JSON.stringify(historical) }],
      ),
    );
    assert.equal(
      snapshot.rows[0].filterMask,
      screenerFilterMask(snapshotRow("VALID")),
    );
  });

  await context.test("schema two and newer require the new raw filter fields", async () => {
    const corrupt = JSON.parse(validStored.payload_json);
    delete corrupt.netDebt;
    await assert.rejects(
      readScreenerSnapshot(
        readDatabase(metadata, [
          { ...validStored, payload_json: JSON.stringify(corrupt) },
        ]),
      ),
      /invalid row/i,
    );
  });

  await context.test("schema one accepts rows written before the new fields", async () => {
    const legacy = JSON.parse(validStored.payload_json);
    delete legacy.evToEbitda;
    delete legacy.returnOnInvestedCapital;
    delete legacy.netDebt;
    delete legacy.asOf.evToEbitda;
    delete legacy.asOf.returnOnInvestedCapital;
    delete legacy.asOf.netDebt;
    legacy.filterMask &= SCREENER_FILTER_MASK_V1_ALL_BITS;
    const snapshot = await readScreenerSnapshot(
      readDatabase(
        {
          ...metadata,
          filter_mask_schema_version: SCREENER_FILTER_MASK_V1_SCHEMA_VERSION,
        },
        [{ ...validStored, payload_json: JSON.stringify(legacy) }],
      ),
    );
    assert.equal(snapshot.rows[0].evToEbitda.value, null);
    assert.equal(snapshot.rows[0].returnOnInvestedCapital.value, null);
    assert.equal(snapshot.rows[0].netDebt.value, null);
  });

  await context.test("generation uses the wrong filter-mask schema", async () => {
    await assert.rejects(
      readScreenerSnapshot(
        readDatabase(
          { ...metadata, filter_mask_schema_version: 999 },
          [validStored],
        ),
      ),
      /unsupported filter-mask schema version 999/i,
    );
  });

  await context.test("legacy rows fall back to the generation timestamp", async () => {
    const legacyPayload = JSON.parse(validStored.payload_json);
    delete legacyPayload.asOf;
    const snapshot = await readScreenerSnapshot(
      readDatabase(metadata, [
        { ...validStored, payload_json: JSON.stringify(legacyPayload) },
      ]),
    );
    const fallback = new Date(metadata.refreshed_at).toISOString();
    assert.equal(snapshot.rows[0].price.asOf, fallback);
    assert.equal(snapshot.rows[0].operatingMarginTrend5Y.asOf, fallback);
  });
});

function memorySnapshotDatabase() {
  let activeGenerationId = null;
  let activeUpdatedAt = null;
  let generations = new Map();
  let rowsByGeneration = new Map();

  const db = {
    prepare(sql) {
      const statement = preparedStatement(sql);
      statement.first = async () => {
        if (/SELECT active_generation_id, updated_at/.test(sql)) {
          return activeGenerationId
            ? {
                active_generation_id: activeGenerationId,
                updated_at: activeUpdatedAt,
              }
            : null;
        }
        if (!/FROM screener_snapshot_state AS state/.test(sql)) {
          throw new Error(`Unexpected first() statement: ${sql}`);
        }
        if (!activeGenerationId) return null;
        const generation = generations.get(activeGenerationId);
        return generation
          ? {
              generation_id: activeGenerationId,
              universe_refreshed_at: generation.universeRefreshedAt,
              refreshed_at: generation.refreshedAt,
              row_count: generation.rowCount,
              filter_mask_schema_version: generation.filterMaskSchemaVersion,
              ...(generation.clientPayloadJson
                ? {
                    client_payload_json: generation.clientPayloadJson,
                    client_payload_etag: generation.clientPayloadEtag,
                  }
                : {}),
            }
          : null;
      };
      statement.all = async () => {
        if (!/FROM screener_snapshot_rows/.test(sql)) {
          throw new Error(`Unexpected all() statement: ${sql}`);
        }
        return { results: rowsByGeneration.get(statement.values[0]) ?? [] };
      };
      return statement;
    },
    async batch(statements) {
      let nextActive = activeGenerationId;
      let nextActiveUpdatedAt = activeUpdatedAt;
      const nextGenerations = new Map(generations);
      const nextRows = new Map(
        [...rowsByGeneration].map(([key, value]) => [key, [...value]]),
      );

      for (const statement of statements) {
        if (/INSERT INTO screener_snapshot_generations/.test(statement.sql)) {
          const [
            id,
            universeRefreshedAt,
            refreshedAt,
            rowCount,
            createdAt,
            filterMaskSchemaVersion,
            clientPayloadJson,
            clientPayloadEtag,
          ] = statement.values;
          nextGenerations.set(id, {
            universeRefreshedAt,
            refreshedAt,
            rowCount,
            createdAt,
            filterMaskSchemaVersion,
            clientPayloadJson,
            clientPayloadEtag,
          });
          nextRows.set(id, []);
        } else if (/INSERT INTO screener_snapshot_rows/.test(statement.sql)) {
          const [generationId, serialized] = statement.values;
          const target = nextRows.get(generationId) ?? [];
          for (const row of JSON.parse(serialized)) {
            target.push({
              market_code: row.marketCode,
              exchange: row.exchange,
              symbol: row.symbol,
              payload_json: row.payloadJson,
            });
          }
          nextRows.set(generationId, target);
        } else if (/INSERT INTO screener_snapshot_state/.test(statement.sql)) {
          const [candidateGenerationId, candidateUpdatedAt] = statement.values;
          if (
            nextActiveUpdatedAt == null ||
            candidateUpdatedAt > nextActiveUpdatedAt
          ) {
            nextActive = candidateGenerationId;
            nextActiveUpdatedAt = candidateUpdatedAt;
          }
        } else if (/DELETE FROM screener_snapshot_generations/.test(statement.sql)) {
          const [cutoff] = statement.values;
          for (const [id, generation] of nextGenerations) {
            if (id !== nextActive && generation.createdAt < cutoff) {
              nextGenerations.delete(id);
              nextRows.delete(id);
            }
          }
        } else {
          throw new Error(`Unexpected snapshot write statement: ${statement.sql}`);
        }
      }

      activeGenerationId = nextActive;
      activeUpdatedAt = nextActiveUpdatedAt;
      generations = nextGenerations;
      rowsByGeneration = nextRows;
      return statements.map(() => ({ success: true }));
    },
  };
  return db;
}

test("a completed generation switch makes only the new snapshot active", async () => {
  const db = memorySnapshotDatabase();
  const oldRefreshedAt = 1_800_000_000_000;
  const newRefreshedAt = oldRefreshedAt + 1;

  await replaceScreenerSnapshot(db, [snapshotRow("OLD", { filterMask: 1 })], {
    generationId: "generation-old",
    universeRefreshedAt: oldRefreshedAt,
    refreshedAt: oldRefreshedAt,
  });
  const oldSnapshot = await readScreenerSnapshot(db);
  assert.equal(oldSnapshot.generationId, "generation-old");
  assert.deepEqual(oldSnapshot.rows.map((row) => row.symbol), ["OLD"]);

  await replaceScreenerSnapshot(db, [snapshotRow("NEW", { filterMask: 2 })], {
    generationId: "generation-new",
    universeRefreshedAt: newRefreshedAt,
    refreshedAt: newRefreshedAt,
  });
  const newSnapshot = await readScreenerSnapshot(db);
  assert.equal(newSnapshot.generationId, "generation-new");
  assert.equal(newSnapshot.universeRefreshedAt, newRefreshedAt);
  assert.deepEqual(newSnapshot.rows.map((row) => row.symbol), ["NEW"]);
  assert.equal(
    newSnapshot.rows[0].filterMask,
    screenerFilterMask(snapshotRow("NEW")),
  );
});

test("the schema-three writer rejects every retired filter bit", async () => {
  assert.equal(
    SCREENER_FILTER_MASK_RETIRED_BITS,
    (1 << 4) | (1 << 5) | (1 << 8),
  );
  for (const retiredBit of [1 << 4, 1 << 5, 1 << 8]) {
    await assert.rejects(
      replaceScreenerSnapshot(
        memorySnapshotDatabase(),
        [snapshotRow(`RETIRED-${retiredBit}`, { filterMask: retiredBit })],
        {
          generationId: `generation-retired-${retiredBit}`,
          universeRefreshedAt: 1_800_000_000_000,
          refreshedAt: 1_800_000_000_123,
        },
      ),
      /incomplete and was not stored/i,
    );
  }
});

test("a slower older refresh cannot reactivate stale data", async () => {
  const db = memorySnapshotDatabase();
  const newerTimestamp = 1_800_000_000_200;
  const olderTimestamp = 1_800_000_000_100;

  await replaceScreenerSnapshot(db, [snapshotRow("NEWER")], {
    generationId: "generation-newer",
    universeRefreshedAt: newerTimestamp,
    refreshedAt: newerTimestamp,
  });
  const staleCompletion = await replaceScreenerSnapshot(
    db,
    [snapshotRow("OLDER")],
    {
      generationId: "generation-older",
      universeRefreshedAt: olderTimestamp,
      refreshedAt: olderTimestamp,
    },
  );

  assert.equal(staleCompletion.generationId, "generation-newer");
  assert.deepEqual(staleCompletion.rows.map((row) => row.symbol), ["NEWER"]);
  const active = await readScreenerSnapshot(db);
  assert.equal(active.generationId, "generation-newer");
});

test("round-trips each metric's real as-of provenance", async () => {
  const db = memorySnapshotDatabase();
  const row = snapshotRow("PROVENANCE");
  const metricNames = [
    "company",
    "price",
    "changePercent",
    "marketCap",
    "fairValue",
    "mispricing",
    "pe",
    "revenueGrowth",
    "netIncome",
    "freeCashFlow",
    "debtToEquity",
    "evToEbitda",
    "returnOnInvestedCapital",
    "netDebt",
    "operatingMarginStable5Y",
    "operatingMarginTrend5Y",
    "operatingMarginsExpanding5Y",
    "sector",
  ];
  const expected = {};
  metricNames.forEach((name, index) => {
    const asOf = index === 0 ? null : `2026-07-${String(index).padStart(2, "0")}`;
    row[name] = { ...row[name], asOf };
    expected[name] = asOf;
  });

  await replaceScreenerSnapshot(db, [row], {
    generationId: "generation-provenance",
    universeRefreshedAt: 1_800_000_000_000,
    refreshedAt: 1_800_000_000_123,
  });
  const restored = await readScreenerSnapshot(db);
  for (const name of metricNames) {
    assert.equal(restored.rows[0][name].asOf, expected[name], name);
  }
});

test("reads the validated compact client payload with a raw stable ETag", async () => {
  const db = memorySnapshotDatabase();
  await replaceScreenerSnapshot(db, [snapshotRow("COMPACT")], {
    generationId: "generation-compact",
    universeRefreshedAt: 1_800_000_000_000,
    refreshedAt: 1_800_000_000_123,
  });

  const snapshot = await readScreenerClientSnapshot(db);
  assert.equal(snapshot.generationId, "generation-compact");
  assert.equal(snapshot.schemaVersion, SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION);
  assert.match(snapshot.etag, /^sha256-[a-f0-9]{64}$/);
  const payload = JSON.parse(snapshot.payloadJson);
  assert.equal(payload.schemaVersion, SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION);
  assert.equal(payload.total, 1);
  assert.equal(payload.rows[0].symbol, "COMPACT");
  assert.equal(payload.rows[0].price, 10);
});

test("serves an intact schema-one client snapshot during the rollout bridge", async () => {
  const payloadJson = JSON.stringify({
    schemaVersion: SCREENER_FILTER_MASK_V1_SCHEMA_VERSION,
    generationId: "generation-v1-bridge",
    asOf: "2026-08-09T03:17:00.000Z",
    total: 1,
    rows: [
      {
        marketCode: "185:BRIDGE",
        exchange: "nasdaq",
        symbol: "BRIDGE",
        company: "Bridge Company",
        filterMask: 3,
        currency: "USD",
        price: 10,
        changePercent: 1,
        marketCap: 1_000_000,
        fairValue: 20,
        mispricing: 1,
        pe: 10,
        revenueGrowth: 12,
      },
    ],
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payloadJson),
  );
  const etag = `sha256-${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
  let rowReads = 0;
  const db = {
    prepare(sql) {
      return {
        async first() {
          assert.match(sql, /FROM screener_snapshot_state AS state/);
          return {
            generation_id: "generation-v1-bridge",
            universe_refreshed_at: 1_800_000_000_000,
            refreshed_at: Date.parse("2026-08-09T03:17:00.000Z"),
            row_count: 1,
            filter_mask_schema_version: SCREENER_FILTER_MASK_V1_SCHEMA_VERSION,
            client_payload_json: payloadJson,
            client_payload_etag: etag,
          };
        },
        async all() {
          rowReads += 1;
          return { results: [] };
        },
      };
    },
  };

  const snapshot = await readScreenerClientSnapshot(db);
  assert.equal(snapshot.schemaVersion, SCREENER_FILTER_MASK_V1_SCHEMA_VERSION);
  assert.equal(snapshot.payloadJson, payloadJson);
  assert.equal(snapshot.etag, etag);
  assert.equal(rowReads, 0, "the bridge must not rewrite a valid v1 payload");
});

test("serves an intact schema-two generation during a rollback", async () => {
  const payloadJson = JSON.stringify({
    schemaVersion: SCREENER_FILTER_MASK_V2_SCHEMA_VERSION,
    generationId: "generation-v2-rollback",
    asOf: "2026-08-09T03:17:00.000Z",
    total: 1,
    rows: [
      {
        marketCode: "185:ROLLBACK",
        exchange: "nasdaq",
        symbol: "ROLLBACK",
        company: "Rollback Company",
        filterMask: SCREENER_FILTER_MASK_V2_ALL_BITS,
        currency: "USD",
        price: 10,
        changePercent: 1,
        marketCap: 1_000_000,
        fairValue: 20,
        mispricing: 1,
        pe: 10,
        revenueGrowth: 12,
      },
    ],
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payloadJson),
  );
  const etag = `sha256-${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
  let rowReads = 0;
  const db = {
    prepare(sql) {
      return {
        async first() {
          assert.match(sql, /FROM screener_snapshot_state AS state/);
          return {
            generation_id: "generation-v2-rollback",
            universe_refreshed_at: 1_800_000_000_000,
            refreshed_at: Date.parse("2026-08-09T03:17:00.000Z"),
            row_count: 1,
            filter_mask_schema_version: SCREENER_FILTER_MASK_V2_SCHEMA_VERSION,
            client_payload_json: payloadJson,
            client_payload_etag: etag,
          };
        },
        async all() {
          rowReads += 1;
          return { results: [] };
        },
      };
    },
  };

  const snapshot = await readScreenerClientSnapshot(db);
  assert.equal(snapshot.schemaVersion, SCREENER_FILTER_MASK_V2_SCHEMA_VERSION);
  assert.equal(snapshot.payloadJson, payloadJson);
  assert.equal(snapshot.etag, etag);
  assert.equal(rowReads, 0, "rollback must not rewrite a valid v2 payload");
});

test("backfills a legacy generation's compact payload from stored D1 rows", async () => {
  const row = snapshotRow("LEGACY", { filterMask: 3 });
  const payload = JSON.parse(storedPayload(row));
  delete payload.asOf;
  const metadata = {
    generation_id: "generation-legacy",
    universe_refreshed_at: 1_800_000_000_000,
    refreshed_at: 1_800_000_000_123,
    row_count: 1,
    filter_mask_schema_version: 0,
    client_payload_json: "{}",
    client_payload_etag: "",
  };
  let update = null;
  const db = {
    prepare(sql) {
      const statement = preparedStatement(sql);
      statement.first = async () => {
        if (!/FROM screener_snapshot_state AS state/.test(sql)) {
          throw new Error(`Unexpected first() statement: ${sql}`);
        }
        return { ...metadata };
      };
      statement.all = async () => {
        if (!/FROM screener_snapshot_rows/.test(sql)) {
          throw new Error(`Unexpected all() statement: ${sql}`);
        }
        return {
          results: [
            {
              market_code: row.marketCode,
              exchange: row.exchange,
              symbol: row.symbol,
              payload_json: JSON.stringify(payload),
            },
          ],
        };
      };
      statement.run = async () => {
        if (!/UPDATE screener_snapshot_generations/.test(sql)) {
          throw new Error(`Unexpected run() statement: ${sql}`);
        }
        update = statement.values;
        return { success: true };
      };
      return statement;
    },
  };

  const snapshot = await readScreenerClientSnapshot(db);
  assert.equal(snapshot.generationId, "generation-legacy");
  assert.equal(snapshot.schemaVersion, SCREENER_FILTER_MASK_V1_SCHEMA_VERSION);
  assert.match(snapshot.etag, /^sha256-[a-f0-9]{64}$/);
  assert.equal(update[0], SCREENER_FILTER_MASK_V1_SCHEMA_VERSION);
  assert.equal(update[2], snapshot.etag);
  assert.equal(update[3], "generation-legacy");
  const compact = JSON.parse(snapshot.payloadJson);
  assert.equal(compact.schemaVersion, SCREENER_FILTER_MASK_V1_SCHEMA_VERSION);
  assert.equal(compact.rows[0].symbol, "LEGACY");
  assert.equal(compact.rows[0].filterMask, row.filterMask);
});

test("keeps a 1,000-row compact client snapshot below 350 KiB", async () => {
  let generationInsert = null;
  const db = {
    prepare(sql) {
      const statement = preparedStatement(sql);
      statement.first = async () => ({
        active_generation_id: "generation-size",
        updated_at: 1_800_000_000_123,
      });
      return statement;
    },
    async batch(statements) {
      generationInsert = statements[0];
      return statements.map(() => ({ success: true }));
    },
  };
  const rows = Array.from({ length: 1000 }, (_, index) =>
    snapshotRow(`S${String(index).padStart(4, "0")}`, {
      filterMask: index & SCREENER_FILTER_MASK_V3_ALL_BITS,
      marketCap: 1_000_000_000_000 - index,
    }),
  );

  await replaceScreenerSnapshot(db, rows, {
    generationId: "generation-size",
    universeRefreshedAt: 1_800_000_000_000,
    refreshedAt: 1_800_000_000_123,
  });
  const bytes = Buffer.byteLength(generationInsert.values[6], "utf8");
  assert.ok(bytes < 350 * 1024, `compact payload was ${bytes} bytes`);
});
