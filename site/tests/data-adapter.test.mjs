import assert from "node:assert/strict";
import test from "node:test";

import {
  AInvestError,
  fetchAInvest,
} from "../lib/ainvest/client.ts";
import { __resetAInvestAuthForTests } from "../lib/ainvest/auth.ts";
import {
  liveDataUnavailable,
  routeError,
} from "../lib/http.ts";
import {
  buildMultiKlineRequest,
  buildAnalysisPeerSnapshotRequest,
  buildPeerSnapshotRequest,
  buildScreenerQuoteRequest,
  buildScreenerUniverseSnapshotRequest,
  buildSecuritySnapshotRequest,
  buildSeriesRequest,
  buildTopMarketCapUniverseRequest,
} from "../lib/ainvest/requests.ts";

const AUTH_ENV_KEYS = [
  "AINVEST_USERID",
  "AINVEST_SESSIONID",
];

async function withAuthEnvironment(values, callback) {
  const previous = Object.fromEntries(
    AUTH_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  for (const key of AUTH_ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  __resetAInvestAuthForTests();
  try {
    return await callback();
  } finally {
    for (const key of AUTH_ENV_KEYS) {
      if (previous[key] == null) delete process.env[key];
      else process.env[key] = previous[key];
    }
    __resetAInvestAuthForTests();
  }
}

test("sends C-side authentication and program headers without serializing the cookie", async () => {
  await withAuthEnvironment(
    { AINVEST_USERID: "private", AINVEST_SESSIONID: "private" },
    async () => {
      let captured;
      const fetcher = async (url, init) => {
        captured = { url, init };
        return Response.json({ status_code: 0, status_msg: "success", data: {} });
      };
      const body = { page: { begin: 0, count: 1 } };
      const result = await fetchAInvest("snapshot", body, { fetcher });
      assert.equal(result.status_code, 0);
      assert.equal(
        captured.url,
        "https://extquote.ainvest.com/index_api/indicator/v2/snapshot",
      );
      assert.equal(captured.init.headers["X-Auth-ProgId"], "7080");
      assert.equal(captured.init.headers.Cookie, "userid=private; sessionid=private");
      assert.equal(captured.init.body, JSON.stringify(body));
      assert.doesNotMatch(JSON.stringify(result), /private/);
    },
  );
});

test("rejects visitor-style and injected manual session identifiers", async () => {
  for (const values of [
    { AINVEST_USERID: "mt_visitor", AINVEST_SESSIONID: "account-session" },
    { AINVEST_USERID: "account-user", AINVEST_SESSIONID: "mt_visitor" },
    { AINVEST_USERID: "account-user;bad", AINVEST_SESSIONID: "account-session" },
    { AINVEST_USERID: "account-user", AINVEST_SESSIONID: "account-session\\nInjected" },
  ]) {
    await withAuthEnvironment(values, async () => {
      await assert.rejects(
        () => fetchAInvest("snapshot", {}),
        (error) => error instanceof AInvestError && error.kind === "auth",
      );
    });
  }
});

test("fails closed when the server-only cookie is missing", async () => {
  await withAuthEnvironment({}, async () => {
    await assert.rejects(
      () => fetchAInvest("snapshot", {}),
      (error) => error instanceof AInvestError && error.kind === "auth",
    );
  });
});

test("constructs the C-side cookie from manual session identifiers", async () => {
  await withAuthEnvironment(
    {
      AINVEST_USERID: "2000000002",
      AINVEST_SESSIONID: "account-session",
    },
    async () => {
      let captured;
      const fetcher = async (url, init = {}) => {
        captured = { url, init };
        return Response.json({ status_code: 0, status_msg: "success", data: {} });
      };
      await fetchAInvest("snapshot", {}, { fetcher });
      assert.equal(captured.url, "https://extquote.ainvest.com/index_api/indicator/v2/snapshot");
      assert.equal(captured.init.headers.Cookie, "userid=2000000002; sessionid=account-session");
    },
  );
});

test("does not retry a rejected manual session without rotation", async () => {
  await withAuthEnvironment(
    {
      AINVEST_USERID: "2000000002",
      AINVEST_SESSIONID: "expired",
    },
    async () => {
      let marketRequests = 0;
      const fetcher = async (_url, init = {}) => {
        marketRequests += 1;
        assert.equal(init.headers.Cookie, "userid=2000000002; sessionid=expired");
        return Response.json({ status_code: 106, status_msg: "session expired", data: {} });
      };
      await assert.rejects(() => fetchAInvest("snapshot", {}, { fetcher }), (error) =>
        error instanceof AInvestError && error.kind === "auth",
      );
      assert.equal(marketRequests, 1);
    },
  );
});

test("maps live-feed failures to a provider-neutral 503 without fallback data", async () => {
  const response = routeError(
    new AInvestError("AInvest: upstream detail must not be serialized", {
      kind: "upstream",
    }),
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.deepEqual(body, {
    code: "DATA_UNAVAILABLE",
    error: "Market data is temporarily unavailable.",
    retryable: true,
  });
  assert.doesNotMatch(JSON.stringify(body), /ainvest|demo|upstream detail/i);
});

test("returns the same fail-closed response for unclassified live-data errors", async () => {
  const response = liveDataUnavailable();
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /demo|fixture|sample/i);
});

test("builds approved indicator mappings and respects endpoint limits", () => {
  const universe = buildTopMarketCapUniverseRequest();
  assert.deepEqual(universe.symbol, [{ type: "block_id", value: ["C191"] }]);
  assert.deepEqual(universe.sort, [{ pos: 1, order: "desc" }]);
  assert.deepEqual(universe.page, { begin: 0, count: 1000 });
  assert.equal(universe.full_symbols, true);

  const marketCodes = Array.from(
    { length: 1001 },
    (_, index) => `185:T${String(index).padStart(4, "0")}`,
  );
  const screener = buildScreenerUniverseSnapshotRequest(marketCodes);
  assert.equal(screener.symbol[0].type, "market_code");
  assert.equal(screener.symbol[0].value.length, 200);
  assert.equal(screener.page.count, 200);
  assert.deepEqual(
    screener.indicator.slice(0, 5).map((item) => item.id),
    [
      "55",
      "10",
      "inr-price_change_ratio_pct-sum",
      "total_market_value",
      "stockdiag_fundamental_value_dcf",
    ],
  );
  assert.ok(screener.indicator.some((item) => item.req_unique_id === "pe"));
  assert.ok(screener.indicator.some((item) => item.req_unique_id === "revenueGrowth"));
  assert.ok(
    screener.indicator.some(
      (item) =>
        item.id === "ev_ebitda_ratio_ttm" &&
        item.req_unique_id === "evToEbitda",
    ),
  );
  assert.ok(
    screener.indicator.some(
      (item) =>
        item.id === "capital_invested_return_ratio_ttm" &&
        item.req_unique_id === "returnOnInvestedCapital",
    ),
  );
  assert.ok(
    screener.indicator.some(
      (item) => item.id === "net_debt" && item.req_unique_id === "netDebt",
    ),
  );
  assert.ok(
    screener.indicator.some(
      (item) =>
        item.id === "stockdiag_fundamental_past_revenuebreakdown" &&
        item.req_unique_id === "operatingMarginHistory",
    ),
  );
  const quoteRefresh = buildScreenerQuoteRequest(["185:MSFT", "185:AAPL"]);
  assert.deepEqual(quoteRefresh.symbol, [
    { type: "market_code", value: ["185:MSFT", "185:AAPL"] },
  ]);
  assert.deepEqual(
    quoteRefresh.indicator.map((item) => item.req_unique_id),
    ["price", "changePercent", "marketCap"],
  );
  assert.equal(quoteRefresh.page.count, 2);
  const security = buildSecuritySnapshotRequest("185:MSFT");
  assert.ok(security.indicator.some((item) => item.req_unique_id === "pastScore"));
  assert.ok(security.indicator.some((item) => item.req_unique_id === "healthScore"));
  assert.ok(security.indicator.some((item) => item.req_unique_id === "futureScore"));
  const peers = buildPeerSnapshotRequest(["185:AAPL", "185:MSFT"]);
  assert.ok(
    peers.indicator.some(
      (item) =>
        item.id === "sale_net_interest_ratio_ttm" &&
        item.req_unique_id === "netMargin",
    ),
  );
  const analysisPeers = buildAnalysisPeerSnapshotRequest([
    "185:AAPL",
    "185:MSFT",
  ]);
  for (const request of [peers, analysisPeers]) {
    const requestIds = request.indicator.map((item) => item.req_unique_id);
    assert.equal(new Set(requestIds).size, requestIds.length);
    assert.ok(request.indicator.some((item) => item.req_unique_id === "employeeCount"));
  }
  assert.ok(
    peers.indicator.some(
      (item) =>
        item.id === "index_weighted_avg_roe_ttm" &&
        item.req_unique_id === "returnOnEquity",
    ),
  );
  const series = buildSeriesRequest("185:MSFT", "price", "max");
  assert.equal(series.time_range.count, 2000);
  assert.equal(series.time_range.time_period, "day_1");
  assert.equal(series.indicator[0].attr.time_period, "day_1");
  const kline = buildMultiKlineRequest("185:MSFT", "max");
  assert.deepEqual(kline.code_list, [{ market: "185", codes: ["MSFT"] }]);
  assert.equal(kline.time_range.count, 2000);
  assert.equal(kline.time_period, "day_1");
});
