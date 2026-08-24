import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

const request = (pathname, accept = "text/html") =>
  worker.request(pathname, accept);
const withoutCompanyLogoHost = (html) =>
  html.replaceAll("https://cdn.ainvest.com", "");

async function assertAppRedirect(response, pathname) {
  if (response.status === 307 || response.status === 308) {
    assert.equal(new URL(response.headers.get("location")).pathname, pathname);
    return;
  }

  // Next.js can flush the App Router shell before a Server Component calls
  // redirect(), in which case the redirect is encoded in the streamed payload.
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /NEXT_REDIRECT/);
  assert.ok(html.includes(pathname));
}

async function assertAppNotFound(response) {
  const html = await response.text();
  // A notFound() discovered after the shell starts streaming retains status
  // 200, but must still render the application's explicit not-found state.
  assert.ok(response.status === 200 || response.status === 404);
  assert.match(html, /We couldn’t find that listing\./);
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

test("overview source excludes unsupported and personal-workspace surfaces", async () => {
  const [overview, shell, charts, styles] = await Promise.all([
    readFile(
      new URL("../components/security/SecuritySummaryClient.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/security/SecurityResearchShell.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/security/SecurityCharts.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/security/security.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(
    overview,
    /What is the market expected to deliver|Who shares the outcome|Transactions that can test conviction|Record the thesis and its breakpoints|Set a watch level|Analyst mean|Buybacks|View cash and debt history|\/api\/workspace\/journal|localStorage/,
  );
  assert.match(overview, /Capital allocation and balance-sheet risk/);
  assert.doesNotMatch(
    shell,
    /noteSaved|sentiment|watchSaved|watchInput|workspaceError|journalLoaded/,
  );
  assert.doesNotMatch(charts, /OwnershipChart|CashAndDebtChart/);
  assert.doesNotMatch(
    styles,
    /security-(?:watch|target|ownership|donut|journal|segmented|save-button|input-combo|control-label)/,
  );
});

test("renders the complete screener content without copied site chrome or paywall", async () => {
  const response = await request("/value-opportunities");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Value opportunities · Value Lens<\/title>/i);
  assert.match(html, /Find value opportunities worth investigating\./);
  assert.match(html, /Start with a margin of safety/);
  assert.doesNotMatch(html, /Describe what you want to find|Try one of these/);
  assert.match(html, /Filter library/);
  assert.match(html, /Search filters/);
  assert.match(html, /Largest companies/);
  assert.match(html, /Market-cap rank ≤ 1,000/);
  assert.match(html, /Always applied/);
  assert.match(html, /Always on/);
  assert.match(html, />3(?:<!-- -->)? active</);
  assert.match(html, /Major U\.S\. exchanges/);
  assert.match(html, /Exchange ∈ \{NYSE, NASDAQ\}/);
  assert.match(
    html,
    /aria-label="Largest companies\. Market-cap rank ≤ 1,000\. Always applied"/,
  );
  assert.doesNotMatch(html, /Exclude companies below \$2B market cap/);
  assert.doesNotMatch(html, /Only companies worth at least \$10B/);
  assert.doesNotMatch(html, /Only companies worth at least \$200B/);
  assert.doesNotMatch(html, /Last price is below \$50/);
  assert.match(html, /Stable operating profitability/);
  assert.match(html, /5Y operating-margin range ≤ 5 pp/);
  assert.match(html, /Operating margins improving/);
  assert.match(html, /5Y margin slope &gt; 0; latest &gt; oldest/);
  assert.doesNotMatch(
    withoutCompanyLogoHost(html),
    /Historical margin consistency isn’t supported yet|Margin-trend filtering isn’t supported yet|availability-pill[^>]*>Unavailable/i,
  );
  assert.match(html, /Provider DCF at least matches price/);
  assert.match(html, /Positive provider DCF ÷ positive price ≥ 1\.0×/);
  assert.match(html, /class="filter-option__title"/);
  assert.match(html, /class="filter-option__terms"/);
  assert.doesNotMatch(
    html,
    /Meaningful provider value gap|Profitable at a low multiple|Strong cash-flow yield|Low enterprise-value multiple|Earnings convert into cash|High returns on capital|Debt covered by cash flow/,
  );
  assert.match(html, /Screen matches are research candidates, not recommendations/);
  assert.match(html, /Banks, insurers, REITs, utilities, and cyclicals/);
  assert.match(html, /sector-appropriate, normalized measures/);
  assert.doesNotMatch(
    html,
    /Momentum|up-today|down-today|Debt-to-equity|low-debt/i,
  );
  assert.match(html, /Valuation, quality, growth, and universe/);
  assert.doesNotMatch(html, /Valuation, quality, growth, momentum, and universe/);
  const chipMarkup = html.match(
    /<div class="filter-chips">([\s\S]*?)<\/div>/i,
  )?.[1];
  assert.ok(chipMarkup);
  const chipText = chipMarkup.replace(/<[^>]+>/g, "").replaceAll("<!-- -->", "");
  assert.match(chipText, /Largest companies/);
  assert.match(chipText, /Major U\.S\. exchanges/);
  assert.match(chipText, /Provider DCF at least matches price/);
  assert.doesNotMatch(
    chipText,
    /Market-cap rank ≤ 1,000|Exchange ∈ \{NYSE, NASDAQ\}|Positive provider DCF ÷ positive price ≥ 1\.0×/,
  );
  assert.equal(
    (chipMarkup.match(/class="active-filter__category"/g) ?? []).length,
    3,
  );
  assert.match(html, /From low price to real opportunity/);
  assert.match(html, /What makes a company a value opportunity\?/);
  assert.match(html, /Why begin with a margin of safety\?/);
  assert.match(html, /What should I test after a company appears\?/);
  assert.match(html, /class="filter-library-disclosure"/);
  assert.match(html, /Browse filters/);
  assert.match(html, /id="results-title">Results</);
  assert.doesNotMatch(html, /New on page|comparison baseline/i);
  assert.doesNotMatch(
    html,
    /<details class="filter-library-disclosure" open/i,
  );
  assert.match(html, /og-value-lens\.png/);
  assert.doesNotMatch(
    html,
    /AlphaSpread|Start free trial|Upgrade to premium|paywall|Live data|TradingView|AInvest/i,
  );
  assert.doesNotMatch(html, /<footer\b/i);

  const legacy = await request("/stock-screener/new");
  await assertAppRedirect(legacy, "/value-opportunities");
});

test("renders the dynamic security shell and rejects unsupported routes", async () => {
  const base = await request("/value-opportunities/nasdaq/msft");
  await assertAppRedirect(
    base,
    "/value-opportunities/nasdaq/msft/overview",
  );

  const response = await request(
    "/value-opportunities/nasdaq/msft/overview",
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assertResearchShell(
    html,
    "/value-opportunities/nasdaq/msft/overview",
  );
  assertResearchPanelHeader(html, {
    view: "overview",
    eyebrow: "Opportunity overview",
    title: "Is today's price worth the risk?",
    action: "Refresh overview",
  });
  assert.match(html, /Loading MSFT summary/);
  assert.match(html, /security-skeleton/);
  assert.doesNotMatch(html, /AlphaSpread|Start free trial|paywall/i);
  assert.doesNotMatch(html, /<footer\b/i);

  const missing = await request(
    "/value-opportunities/nasdaq/notareal/overview",
  );
  await assertAppNotFound(missing);

  const legacy = await request("/security/nasdaq/msft/summary");
  await assertAppRedirect(
    legacy,
    "/value-opportunities/nasdaq/msft/overview",
  );

  const alias = await request(
    "/value-opportunities/NASDAQGS/MSFT/overview",
  );
  await assertAppRedirect(
    alias,
    "/value-opportunities/nasdaq/msft/overview",
  );
});

test("renders renamed valuation routes without copied global chrome", async () => {
  const cashFlow = await request(
    "/value-opportunities/nasdaq/msft/cash-flow",
  );
  assert.equal(cashFlow.status, 200);
  const cashFlowHtml = await cashFlow.text();
  assertResearchShell(
    cashFlowHtml,
    "/value-opportunities/nasdaq/msft/cash-flow",
  );
  assertResearchPanelHeader(cashFlowHtml, {
    view: "cash-flow",
    eyebrow: "Cash-flow safety",
    title: "Cash-flow value check",
    action: "Refresh analysis",
  });
  assert.match(
    cashFlowHtml,
    /Preparing[\s\S]*cash-flow value evidence[\s\S]*for[\s\S]*MSFT/,
  );
  assert.doesNotMatch(
    withoutCompanyLogoHost(cashFlowHtml),
    /AlphaSpread|AInvest|TradingView|<footer\b/i,
  );

  const relative = await request(
    "/value-opportunities/nasdaq/msft/market-comparison",
  );
  assert.equal(relative.status, 200);
  const relativeHtml = await relative.text();
  assertResearchShell(
    relativeHtml,
    "/value-opportunities/nasdaq/msft/market-comparison",
  );
  assertResearchPanelHeader(relativeHtml, {
    view: "market-expectations",
    eyebrow: "Market expectations",
    title: "Market expectation check",
    action: "Refresh analysis",
  });
  assert.match(
    relativeHtml,
    /Preparing[\s\S]*market expectation check[\s\S]*for[\s\S]*MSFT/,
  );
  assert.doesNotMatch(
    withoutCompanyLogoHost(relativeHtml),
    /AlphaSpread|AInvest|TradingView|<footer\b/i,
  );

  const cashFlowAlias = await request(
    "/value-opportunities/NASDAQGS/MSFT/cash-flow",
  );
  await assertAppRedirect(
    cashFlowAlias,
    "/value-opportunities/nasdaq/msft/cash-flow",
  );

  const relativeAlias = await request(
    "/value-opportunities/NASDAQGS/MSFT/market-comparison",
  );
  await assertAppRedirect(
    relativeAlias,
    "/value-opportunities/nasdaq/msft/market-comparison",
  );

  const unsupported = await request(
    "/value-opportunities/nasdaq/notareal/cash-flow",
  );
  await assertAppNotFound(unsupported);

  const legacyCashFlow = await request(
    "/security/nasdaq/msft/cash-flow-value",
  );
  await assertAppRedirect(
    legacyCashFlow,
    "/value-opportunities/nasdaq/msft/cash-flow",
  );
});

test("fails closed without credentials and never serializes provider details", async () => {
  const previousCookie = process.env.AINVEST_C_COOKIE;
  delete process.env.AINVEST_C_COOKIE;
  try {
    const summaryResponse = await request(
      "/api/security/nasdaq/msft/summary",
      "application/json",
    );
    assert.equal(summaryResponse.status, 503);
    const summaryText = await summaryResponse.text();
    assert.doesNotMatch(
      summaryText,
      /userid=|sessionid=|AINVEST_C_COOKIE|AInvest|demo|illustrative/i,
    );

    const screenerResponse = await request(
      "/api/screener?page=1&pageSize=5&sort=marketCap&order=desc&filters=undervalued",
      "application/json",
    );
    assert.equal(screenerResponse.status, 503);
    const screenerText = await screenerResponse.text();
    assert.doesNotMatch(
      screenerText,
      /userid=|sessionid=|AINVEST_C_COOKIE|AInvest|demo|illustrative/i,
    );
  } finally {
    if (previousCookie == null) delete process.env.AINVEST_C_COOKIE;
    else process.env.AINVEST_C_COOKIE = previousCookie;
  }
});

test("accepts a complete snapshot page and rejects larger API pages", async () => {
  const maximum = await request(
    "/api/screener?page=1&pageSize=1000",
    "application/json",
  );
  assert.notEqual(maximum.status, 400);
  await maximum.text();

  const oversized = await request(
    "/api/screener?page=1&pageSize=1001",
    "application/json",
  );
  assert.equal(oversized.status, 400);
  assert.match(await oversized.text(), /Invalid request/);

  const missing = await request(
    "/api/security/nasdaq/notareal/summary",
    "application/json",
  );
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /not in the supported security catalog/);
});

test("validates analysis views and supported symbols before requesting data", async () => {
  const invalidView = await request(
    "/api/security/nasdaq/msft/analysis?view=summary",
    "application/json",
  );
  assert.equal(invalidView.status, 400);
  assert.match(await invalidView.text(), /Invalid request parameters/);

  const unsupportedSymbol = await request(
    "/api/security/nasdaq/notareal/analysis?view=profitability",
    "application/json",
  );
  assert.equal(unsupportedSymbol.status, 404);
  assert.match(
    await unsupportedSymbol.text(),
    /not in the supported security catalog/,
  );

  for (const pathname of [
    "/api/security/arca/spy/analysis?view=dcf-valuation",
    "/api/security/arca/spy/business-quality",
    "/api/security/arca/spy/peers",
  ]) {
    const unsupportedType = await request(pathname, "application/json");
    assert.equal(unsupportedType.status, 422);
    const payload = await unsupportedType.json();
    assert.equal(payload.code, "UNSUPPORTED_SECURITY_TYPE");
    assert.equal(payload.securityType, "CE");
    assert.match(payload.error, /common and depositary equities/i);
  }
});

test("analysis API fails closed without credentials or provider details", async () => {
  const previousCookie = process.env.AINVEST_C_COOKIE;
  delete process.env.AINVEST_C_COOKIE;
  try {
    const response = await request(
      "/api/security/nasdaq/msft/analysis?view=dcf-valuation",
      "application/json",
    );
    assert.equal(response.status, 503);
    const text = await response.text();
    assert.match(text, /Market data is temporarily unavailable/);
    assert.doesNotMatch(
      text,
      /userid=|sessionid=|AINVEST_C_COOKIE|AInvest|cookie|credential|demo|illustrative/i,
    );
  } finally {
    if (previousCookie == null) delete process.env.AINVEST_C_COOKIE;
    else process.env.AINVEST_C_COOKIE = previousCookie;
  }
});
