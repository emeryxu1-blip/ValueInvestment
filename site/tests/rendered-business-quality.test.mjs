import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { startCloudflareWorker } from "./helpers/cloudflare-worker.mjs";

let worker;

before(async () => {
  worker = await startCloudflareWorker();
});

after(async () => {
  await worker?.close();
});

const request = (pathname) => worker.request(pathname);

async function assertAppRedirect(response, pathname) {
  if (response.status === 307 || response.status === 308) {
    assert.equal(new URL(response.headers.get("location")).pathname, pathname);
    return;
  }

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /NEXT_REDIRECT/);
  assert.ok(html.includes(pathname));
}

test("renders the business-quality shell without copied site chrome", async () => {
  const response = await request(
    "/value-opportunities/nasdaq/msft/business-quality",
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /MSFT Business quality opportunity · Value Lens/);
  assert.match(html, /Loading[\s\S]*MSFT[\s\S]*business quality/);
  assert.match(html, /profitability-skeleton/);
  assert.doesNotMatch(
    html,
    /AlphaSpread|Start free trial|paywall|AInvest|TradingView/i,
  );
  assert.doesNotMatch(html, /<footer\b/i);
});

test("rejects unsupported business-quality routes", async () => {
  const response = await request(
    "/value-opportunities/nasdaq/notareal/business-quality",
  );
  assert.ok(response.status === 200 || response.status === 404);
  assert.match(await response.text(), /We couldn’t find that listing\./);
});

test("redirects the old business-quality route to the opportunity path", async () => {
  const response = await request("/security/nasdaq/msft/business-quality");
  await assertAppRedirect(
    response,
    "/value-opportunities/nasdaq/msft/business-quality",
  );
});
