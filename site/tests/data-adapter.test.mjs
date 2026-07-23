import assert from "node:assert/strict";
import test from "node:test";

import {
  AInvestError,
  fetchAInvest,
} from "../lib/ainvest/client.ts";
import {
  liveDataUnavailable,
  routeError,
} from "../lib/http.ts";
import {
  buildMultiKlineRequest,
  buildScreenerQuoteRequest,
  buildScreenerSnapshotRequest,
  buildSecuritySnapshotRequest,
  buildSeriesRequest,
} from "../lib/ainvest/requests.ts";

test("sends C-side authentication and program headers without serializing the cookie", async () => {
  const previous = process.env.AINVEST_C_COOKIE;
  process.env.AINVEST_C_COOKIE = "userid=private; sessionid=private";
  let captured;
  const fetcher = async (url, init) => {
    captured = { url, init };
    return Response.json({ status_code: 0, status_msg: "success", data: {} });
  };
  try {
    const body = { page: { begin: 0, count: 1 } };
    const result = await fetchAInvest("snapshot", body, { fetcher });
    assert.equal(result.status_code, 0);
    assert.equal(
      captured.url,
      "https://extquote.ainvest.com/index_api/indicator/v2/snapshot",
    );
    assert.equal(captured.init.headers["X-Auth-ProgId"], "7080");
    assert.equal(captured.init.headers.Cookie, process.env.AINVEST_C_COOKIE);
    assert.equal(captured.init.body, JSON.stringify(body));
    assert.doesNotMatch(JSON.stringify(result), /private/);
  } finally {
    if (previous == null) delete process.env.AINVEST_C_COOKIE;
    else process.env.AINVEST_C_COOKIE = previous;
  }
});

test("fails closed when the server-only cookie is missing", async () => {
  const previous = process.env.AINVEST_C_COOKIE;
  delete process.env.AINVEST_C_COOKIE;
  try {
    await assert.rejects(
      () => fetchAInvest("snapshot", {}),
      (error) => error instanceof AInvestError && error.kind === "auth",
    );
  } finally {
    if (previous != null) process.env.AINVEST_C_COOKIE = previous;
  }
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
  const screener = buildScreenerSnapshotRequest({ begin: 0, count: 5000 });
  assert.equal(screener.symbol[0].value[0], "C191");
  assert.equal(screener.page.count, 1000);
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
  const series = buildSeriesRequest("185:MSFT", "price", "max");
  assert.equal(series.time_range.count, 2000);
  assert.equal(series.time_range.time_period, "day_1");
  assert.equal(series.indicator[0].attr.time_period, "day_1");
  const kline = buildMultiKlineRequest("185:MSFT", "max");
  assert.deepEqual(kline.code_list, [{ market: "185", codes: ["MSFT"] }]);
  assert.equal(kline.time_range.count, 2000);
  assert.equal(kline.time_period, "day_1");
});
