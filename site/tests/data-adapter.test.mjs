import assert from "node:assert/strict";
import test from "node:test";

import {
  AInvestError,
  fetchAInvest,
} from "../lib/ainvest/client.ts";
import {
  __resetAInvestAuthForTests,
  splitSetCookieHeader,
} from "../lib/ainvest/auth.ts";
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
  "AINVEST_C_COOKIE",
  "AINVEST_EMAIL",
  "AINVEST_PASSWORD",
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

function jsonWithCookies(payload, cookies, status = 200) {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(payload), { status, headers });
}

const visitorCookies = [
  "userid=1000000001; Domain=.ainvest.com; Path=/",
  "sessionid=visitor-session; Domain=.ainvest.com; Path=/",
  "u_name=mt_1000000001; Domain=.ainvest.com; Path=/",
  "ticket=visitor-ticket; Domain=.ainvest.com; Path=/",
];

const accountCookies = [
  "userid=2000000002; Domain=.ainvest.com; Path=/",
  "sessionid=account-session; Domain=.ainvest.com; Path=/",
  "u_name=member; Domain=.ainvest.com; Path=/",
  "ticket=account-ticket; Domain=.ainvest.com; Path=/",
];

test("sends C-side authentication and program headers without serializing the cookie", async () => {
  await withAuthEnvironment(
    { AINVEST_C_COOKIE: "userid=private; sessionid=private" },
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
      assert.equal(captured.init.headers.Cookie, process.env.AINVEST_C_COOKIE);
      assert.equal(captured.init.body, JSON.stringify(body));
      assert.doesNotMatch(JSON.stringify(result), /private/);
    },
  );
});

test("fails closed when the server-only cookie is missing", async () => {
  await withAuthEnvironment({}, async () => {
    await assert.rejects(
      () => fetchAInvest("snapshot", {}),
      (error) => error instanceof AInvestError && error.kind === "auth",
    );
  });
});

test("retrieves and caches an authenticated cookie from AInvest credentials", async () => {
  await withAuthEnvironment(
    {
      AINVEST_EMAIL: "member@example.com",
      AINVEST_PASSWORD: "test-password",
    },
    async () => {
      const calls = [];
      const fetcher = async (url, init = {}) => {
        calls.push({ url, init });
        if (url === "https://user.ainvest.com/auth/visitor/login") {
          assert.equal(init.method, "POST");
          assert.match(String(init.body), /clientType=WEB/);
          assert.match(String(init.body), /udid=[0-9a-f-]{36}/i);
          assert.match(init.headers.fingerprint, /^[0-9a-f-]{36}$/i);
          return jsonWithCookies({ i18nMsg: "success" }, visitorCookies);
        }
        if (url === "https://user.ainvest.com/auth/user/v3/login") {
          const loginBody = JSON.parse(init.body);
          assert.deepEqual(
            Object.keys(loginBody).sort(),
            ["email", "loginType", "signedPwd", "token", "type", "visitorId"],
          );
          assert.equal(loginBody.email, "member@example.com");
          assert.equal(loginBody.type, "EMAIL");
          assert.equal(loginBody.loginType, "ACCOUNT_PWD");
          assert.equal(loginBody.visitorId, "1000000001");
          assert.equal(loginBody.token, "visitor-session");
          assert.match(loginBody.signedPwd, /^\d{13}[A-Za-z0-9+/]+=*$/);
          assert.doesNotMatch(init.body, /test-password/);
          assert.match(init.headers.Cookie, /ticket=visitor-ticket/);
          assert.match(init.headers.fingerprint, /^[0-9a-f-]{36}$/i);
          return jsonWithCookies({ i18nMsg: "success" }, accountCookies);
        }
        assert.equal(
          init.headers.Cookie,
          "userid=2000000002; sessionid=account-session",
        );
        return Response.json({ status_code: 0, status_msg: "success", data: {} });
      };

      await fetchAInvest("snapshot", {}, { fetcher });
      await fetchAInvest("snapshot", {}, { fetcher });
      assert.equal(
        calls.filter(
          (call) =>
            call.url === "https://user.ainvest.com/auth/visitor/login",
        ).length,
        1,
      );
      assert.equal(
        calls.filter(
          (call) => call.url === "https://user.ainvest.com/auth/user/v3/login",
        ).length,
        1,
      );
    },
  );
});

test("prefers account login and renews an expired authenticated cookie", async () => {
  await withAuthEnvironment(
    {
      AINVEST_C_COOKIE: "userid=expired; sessionid=expired",
      AINVEST_EMAIL: "member@example.com",
      AINVEST_PASSWORD: "test-password",
    },
    async () => {
      let loginRequests = 0;
      let marketRequests = 0;
      const fetcher = async (url, init = {}) => {
        if (url === "https://user.ainvest.com/auth/visitor/login") {
          return jsonWithCookies({ i18nMsg: "success" }, visitorCookies);
        }
        if (url === "https://user.ainvest.com/auth/user/v3/login") {
          loginRequests += 1;
          return jsonWithCookies({ i18nMsg: "success" }, [
            "userid=2000000002; Domain=.ainvest.com; Path=/",
            `sessionid=account-session-${loginRequests}; Domain=.ainvest.com; Path=/`,
            "u_name=member; Domain=.ainvest.com; Path=/",
          ]);
        }
        marketRequests += 1;
        if (marketRequests === 1) {
          assert.equal(
            init.headers.Cookie,
            "userid=2000000002; sessionid=account-session-1",
          );
          return Response.json(
            { status_code: 106, status_msg: "session expired", data: {} },
          );
        }
        assert.equal(
          init.headers.Cookie,
          "userid=2000000002; sessionid=account-session-2",
        );
        return Response.json({ status_code: 0, status_msg: "success", data: {} });
      };

      const result = await fetchAInvest("snapshot", {}, { fetcher });
      assert.equal(result.status_code, 0);
      assert.equal(loginRequests, 2);
      assert.equal(marketRequests, 2);
    },
  );
});

test("deduplicates concurrent logins and cools down rejected credentials", async () => {
  await withAuthEnvironment(
    {
      AINVEST_EMAIL: "member@example.com",
      AINVEST_PASSWORD: "test-password",
    },
    async () => {
      let bootstrapRequests = 0;
      let loginRequests = 0;
      const fetcher = async (url) => {
        if (url === "https://user.ainvest.com/auth/visitor/login") {
          bootstrapRequests += 1;
          return jsonWithCookies({ i18nMsg: "success" }, visitorCookies);
        }
        if (url === "https://user.ainvest.com/auth/user/v3/login") {
          loginRequests += 1;
          return jsonWithCookies(
            { errorCode: "PWD_NOT_MATCH", i18nMsg: "rejected" },
            [],
            466,
          );
        }
        throw new Error("market request must not run after rejected login");
      };

      const first = await Promise.allSettled([
        fetchAInvest("snapshot", {}, { fetcher }),
        fetchAInvest("snapshot", {}, { fetcher }),
      ]);
      assert.ok(first.every((result) => result.status === "rejected"));
      await assert.rejects(() => fetchAInvest("snapshot", {}, { fetcher }));
      assert.equal(bootstrapRequests, 1);
      assert.equal(loginRequests, 1);
    },
  );
});

test("keeps a shared login alive when one caller times out", async () => {
  await withAuthEnvironment(
    {
      AINVEST_EMAIL: "member@example.com",
      AINVEST_PASSWORD: "test-password",
    },
    async () => {
      let bootstrapRequests = 0;
      let loginRequests = 0;
      const fetcher = async (url) => {
        if (url === "https://user.ainvest.com/auth/visitor/login") {
          bootstrapRequests += 1;
          await new Promise((resolve) => setTimeout(resolve, 25));
          return jsonWithCookies({ i18nMsg: "success" }, visitorCookies);
        }
        if (url === "https://user.ainvest.com/auth/user/v3/login") {
          loginRequests += 1;
          return jsonWithCookies({ i18nMsg: "success" }, accountCookies);
        }
        return Response.json({ status_code: 0, status_msg: "success", data: {} });
      };

      const timedOut = fetchAInvest("snapshot", {}, { fetcher, timeoutMs: 5 });
      await Promise.resolve();
      const healthy = fetchAInvest("snapshot", {}, { fetcher, timeoutMs: 200 });
      const [timedOutResult, healthyResult] = await Promise.allSettled([
        timedOut,
        healthy,
      ]);

      assert.equal(timedOutResult.status, "rejected");
      assert.equal(healthyResult.status, "fulfilled");
      assert.equal(bootstrapRequests, 1);
      assert.equal(loginRequests, 1);
    },
  );
});

test("retries authentication after a transient bootstrap failure", async () => {
  await withAuthEnvironment(
    {
      AINVEST_EMAIL: "member@example.com",
      AINVEST_PASSWORD: "test-password",
    },
    async () => {
      let bootstrapRequests = 0;
      const fetcher = async (url) => {
        if (url === "https://user.ainvest.com/auth/visitor/login") {
          bootstrapRequests += 1;
          if (bootstrapRequests === 1) throw new Error("temporary network error");
          return jsonWithCookies({ i18nMsg: "success" }, visitorCookies);
        }
        if (url === "https://user.ainvest.com/auth/user/v3/login") {
          return jsonWithCookies({ i18nMsg: "success" }, accountCookies);
        }
        return Response.json({ status_code: 0, status_msg: "success", data: {} });
      };

      await assert.rejects(() => fetchAInvest("snapshot", {}, { fetcher }));
      const result = await fetchAInvest("snapshot", {}, { fetcher });
      assert.equal(result.status_code, 0);
      assert.equal(bootstrapRequests, 2);
    },
  );
});

test("does not cache a renewed cookie that the market API also rejects", async () => {
  await withAuthEnvironment(
    {
      AINVEST_C_COOKIE: "userid=expired; sessionid=expired",
      AINVEST_EMAIL: "member@example.com",
      AINVEST_PASSWORD: "test-password",
    },
    async () => {
      let loginRequests = 0;
      let marketRequests = 0;
      const fetcher = async (url, init = {}) => {
        if (url === "https://user.ainvest.com/auth/visitor/login") {
          return jsonWithCookies({ i18nMsg: "success" }, visitorCookies);
        }
        if (url === "https://user.ainvest.com/auth/user/v3/login") {
          loginRequests += 1;
          return jsonWithCookies({ i18nMsg: "success" }, [
            "userid=2000000002; Domain=.ainvest.com; Path=/",
            `sessionid=account-session-${loginRequests}; Domain=.ainvest.com; Path=/`,
            "u_name=member; Domain=.ainvest.com; Path=/",
          ]);
        }
        marketRequests += 1;
        if (marketRequests <= 2) {
          return Response.json({
            status_code: 106,
            status_msg: "session expired",
            data: {},
          });
        }
        assert.equal(
          init.headers.Cookie,
          "userid=2000000002; sessionid=account-session-3",
        );
        return Response.json({ status_code: 0, status_msg: "success", data: {} });
      };

      await assert.rejects(
        () => fetchAInvest("snapshot", {}, { fetcher }),
        (error) => error instanceof AInvestError && error.kind === "auth",
      );
      const result = await fetchAInvest("snapshot", {}, { fetcher });
      assert.equal(result.status_code, 0);
      assert.equal(loginRequests, 3);
      assert.equal(marketRequests, 3);
    },
  );
});

test("splits combined Set-Cookie headers without breaking Expires dates", () => {
  assert.deepEqual(
    splitSetCookieHeader(
      "userid=1; Expires=Wed, 09 Sep 2026 03:14:32 GMT; Path=/, sessionid=2; Path=/",
    ),
    [
      "userid=1; Expires=Wed, 09 Sep 2026 03:14:32 GMT; Path=/",
      "sessionid=2; Path=/",
    ],
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
