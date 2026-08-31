import assert from "node:assert/strict";
import test from "node:test";

import {
  etagMatches,
  screenerClientSnapshotResponse,
} from "../lib/screener/client-snapshot-response.ts";
import {
  cachedScreenerSnapshotResponse,
  isScreenerApiPath,
  screenerSnapshotCacheKey,
} from "../lib/screener/client-snapshot-cache.ts";
import {
  SCREENER_CLIENT_SNAPSHOT_LEGACY_SCHEMA_VERSION,
  SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION,
  SCREENER_CLIENT_SNAPSHOT_V2_SCHEMA_VERSION,
  SCREENER_CLIENT_SNAPSHOT_V3_SCHEMA_VERSION,
} from "../lib/screener/client-snapshot-contract.ts";

const payloadJson = JSON.stringify({
  schemaVersion: SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION,
  generationId: "generation-1",
  asOf: "2026-08-10T03:17:00.000Z",
  total: 1,
  rows: [],
});

test("includes the compact endpoint in the screener API rate-limit scope", () => {
  assert.equal(isScreenerApiPath("/api/screener"), true);
  assert.equal(isScreenerApiPath("/api/screener/snapshot"), true);
  assert.equal(isScreenerApiPath("/api/screener/snapshot/"), true);
  assert.equal(isScreenerApiPath("/api/screeners"), false);
  assert.equal(isScreenerApiPath("/api/screener-export"), false);
});

test("serves schema-three snapshot bytes without replay caching", async () => {
  const response = screenerClientSnapshotResponse(
    new Request("https://example.test/api/screener/snapshot"),
    { payloadJson, etag: "generation-1" },
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), payloadJson);
  assert.equal(response.headers.get("etag"), '"generation-1"');
  assert.equal(
    response.headers.get("cache-control"),
    "no-store",
  );
  assert.equal(
    response.headers.get("content-type"),
    "application/json; charset=utf-8",
  );
  assert.equal(
    response.headers.get("x-screener-schema-version"),
    String(SCREENER_CLIENT_SNAPSHOT_V3_SCHEMA_VERSION),
  );
});

test("supports strong and weak conditional snapshot requests", () => {
  assert.equal(etagMatches('W/"generation-1"', '"generation-1"'), true);
  assert.equal(
    etagMatches('"another", W/"generation-1"', '"generation-1"'),
    true,
  );

  const response = screenerClientSnapshotResponse(
    new Request("https://example.test/api/screener/snapshot", {
      headers: { "If-None-Match": 'W/"generation-1"' },
    }),
    { payloadJson, etag: '"generation-1"' },
  );
  assert.equal(response.status, 304);
  assert.equal(response.body, null);
  assert.equal(response.headers.get("etag"), '"generation-1"');
});

test("keeps unavailable snapshots out of shared caches", async () => {
  const response = screenerClientSnapshotResponse(
    new Request("https://example.test/api/screener/snapshot"),
    null,
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).code, "SNAPSHOT_UNAVAILABLE");
});

test("revalidates every snapshot load against the current origin generation", async () => {
  const cache = {
    async match() {
      assert.fail("the numeric snapshot must not be served from an edge body cache");
    },
    async put() {
      assert.fail("the numeric snapshot must not be written to an edge body cache");
    },
  };
  let originReads = 0;
  const load = (request) =>
    cachedScreenerSnapshotResponse(request, {
      cache,
      async fetchOrigin() {
        originReads += 1;
        return screenerClientSnapshotResponse(request, {
          payloadJson,
          etag: "generation-1",
        });
      },
      waitUntil() {
        assert.fail("the numeric snapshot must not schedule an edge cache write");
      },
    });

  const firstRequest = new Request(
    "https://example.test/api/screener/snapshot?ignored=first",
  );
  const first = await load(firstRequest);
  assert.equal(first.status, 200);
  const secondRequest = new Request(
    "https://example.test/api/screener/snapshot?ignored=second",
  );
  const second = await load(secondRequest);
  assert.equal(second.status, 200);
  assert.equal(await second.text(), payloadJson);
  assert.equal(originReads, 2);
  assert.equal(
    screenerSnapshotCacheKey(firstRequest).url,
    screenerSnapshotCacheKey(secondRequest).url,
  );

  const conditional = await load(
    new Request("https://example.test/api/screener/snapshot", {
      headers: { "If-None-Match": '"generation-1"' },
    }),
  );
  assert.equal(conditional.status, 304);
  assert.equal(originReads, 3);
});

test("does not edge-cache an unavailable snapshot response", async () => {
  const cache = {
    async match() {
      return undefined;
    },
    async put() {
      assert.fail("an error response must not be cached");
    },
  };
  let originReads = 0;
  const request = new Request("https://example.test/api/screener/snapshot");
  const load = () =>
    cachedScreenerSnapshotResponse(request, {
      cache,
      async fetchOrigin() {
        originReads += 1;
        return screenerClientSnapshotResponse(request, null);
      },
      waitUntil() {
        assert.fail("an error response must not schedule a cache write");
      },
    });

  assert.equal((await load()).status, 503);
  assert.equal((await load()).status, 503);
  assert.equal(originReads, 2);
});

test("serves a legacy bridge snapshot without browser or edge caching", async () => {
  const legacyPayloadJson = JSON.stringify({
    schemaVersion: SCREENER_CLIENT_SNAPSHOT_LEGACY_SCHEMA_VERSION,
    generationId: "legacy-generation",
    asOf: "2026-08-09T03:17:00.000Z",
    total: 1,
    rows: [],
  });
  const request = new Request(
    `https://example.test/api/screener/snapshot?schema=${SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION}`,
  );
  const response = screenerClientSnapshotResponse(request, {
    payloadJson: legacyPayloadJson,
    etag: "legacy-generation",
    schemaVersion: SCREENER_CLIENT_SNAPSHOT_LEGACY_SCHEMA_VERSION,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    response.headers.get("x-screener-schema-version"),
    String(SCREENER_CLIENT_SNAPSHOT_LEGACY_SCHEMA_VERSION),
  );

  const cache = {
    async match() {
      return undefined;
    },
    async put() {
      assert.fail("a legacy bridge response must not enter the edge cache");
    },
  };
  const pending = [];
  const bridged = await cachedScreenerSnapshotResponse(request, {
    cache,
    async fetchOrigin() {
      return response.clone();
    },
    waitUntil(promise) {
      pending.push(promise);
    },
  });
  assert.equal(bridged.status, 200);
  assert.equal(pending.length, 0);
  assert.match(
    screenerSnapshotCacheKey(request).url,
    new RegExp(`schema=${SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION}$`),
  );
});

test("serves an active schema-two rollback without browser or edge caching", async () => {
  const rollbackPayloadJson = JSON.stringify({
    schemaVersion: SCREENER_CLIENT_SNAPSHOT_V2_SCHEMA_VERSION,
    generationId: "rollback-generation",
    asOf: "2026-08-09T03:17:00.000Z",
    total: 1,
    rows: [],
  });
  const request = new Request(
    `https://example.test/api/screener/snapshot?schema=${SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION}`,
  );
  const response = screenerClientSnapshotResponse(request, {
    payloadJson: rollbackPayloadJson,
    etag: "rollback-generation",
    schemaVersion: SCREENER_CLIENT_SNAPSHOT_V2_SCHEMA_VERSION,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    response.headers.get("x-screener-schema-version"),
    String(SCREENER_CLIENT_SNAPSHOT_V2_SCHEMA_VERSION),
  );

  let cacheWrites = 0;
  const bridged = await cachedScreenerSnapshotResponse(request, {
    cache: {
      async match() {
        return undefined;
      },
      async put() {
        cacheWrites += 1;
      },
    },
    async fetchOrigin() {
      return response.clone();
    },
    waitUntil() {
      assert.fail("a schema-two bridge must not schedule an edge-cache write");
    },
  });
  assert.equal(bridged.status, 200);
  assert.equal(cacheWrites, 0);
});
