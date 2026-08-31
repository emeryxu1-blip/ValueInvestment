import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { startCloudflareWorker } from "./helpers/cloudflare-worker.mjs";
import { assertResearchPanelHeader } from "./helpers/research-panel.mjs";

let worker;

before(async () => {
  worker = await startCloudflareWorker();
});

after(async () => {
  await worker?.close();
});

const request = (pathname) => worker.request(pathname);
const withoutCompanyLogoHost = (html) =>
  html.replaceAll("https://cdn.ainvest.com", "");

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

function assertResearchShell(html, activePathname) {
  assert.match(
    html,
    /<title>MSFT Value opportunity overview · Value Lens<\/title>/i,
  );
  assert.ok(
    html.includes(
      `<link rel="canonical" href="http://localhost:3001${activePathname}"/>`,
    ),
    `expected canonical metadata for ${activePathname}`,
  );
  assert.match(
    html,
    /<h1>Microsoft(?:<!-- -->)? opportunity overview<\/h1>/i,
  );
  assert.match(
    html,
    /<img[^>]*src="https:\/\/cdn\.ainvest\.com\/icon\/us\/MSFT\.png"/i,
  );

  const navigation = html.match(
    /<nav\b[^>]*class="security-research-nav"[^>]*>[\s\S]*?<\/nav>/i,
  );
  assert.ok(navigation, "expected the persistent company research navigation");
  assert.match(navigation[0], /role="tablist"/i);

  const tabs = navigation[0].match(/<a\b[^>]*role="tab"[^>]*>/gi) ?? [];
  assert.equal(tabs.length, 4);

  const selectedTabs = tabs.filter((tab) =>
    /aria-selected="true"/i.test(tab),
  );
  assert.equal(selectedTabs.length, 1);
  assert.ok(
    selectedTabs[0].includes(`href="${activePathname}"`),
    `expected ${activePathname} to be the selected research tab`,
  );
  assert.match(selectedTabs[0], /aria-current="page"/i);
}

test("renders the business-quality shell without copied site chrome", async () => {
  const response = await request(
    "/value-opportunities/nasdaq/msft/business-quality",
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assertResearchShell(
    html,
    "/value-opportunities/nasdaq/msft/business-quality",
  );
  assertResearchPanelHeader(html, {
    view: "quality",
    eyebrow: "Quality check",
    title: "Can this business protect and grow distributable cash?",
    action: "Refresh quality",
  });
  assert.match(html, /Loading[\s\S]*MSFT[\s\S]*business quality/);
  assert.match(html, /profitability-skeleton/);
  assert.doesNotMatch(
    withoutCompanyLogoHost(html),
    /AlphaSpread|Start free trial|paywall|AInvest|TradingView/i,
  );
  assert.doesNotMatch(html, /<footer\b/i);
});

test("canonicalizes business-quality exchange aliases and casing", async () => {
  const response = await request(
    "/value-opportunities/NASDAQGS/MSFT/business-quality",
  );
  await assertAppRedirect(
    response,
    "/value-opportunities/nasdaq/msft/business-quality",
  );
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
