"use client";

import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  Building2,
  ChevronRight,
  CircleDollarSign,
  Database,
  FileText,
  HeartPulse,
  Info,
  LineChart,
  MessageSquareText,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { normalizePeers, normalizeSeries, providerNeutralText } from "./data";
import {
  CashFlowWaterfall,
  FinancialHistoryChart,
  ValuationHistoryChart,
} from "./SecurityCharts";
import ResearchPanelHeader from "./ResearchPanelHeader";
import { useSecurityResearchShell } from "./SecurityResearchShell";
import type { Metric, PeersResponse, SecuritySummary, SeriesResponse } from "./types";
import CalculationDisclosure from "./CalculationDisclosure";

type Props = {
  exchange: string;
  symbol: string;
};

type DisplayMetric = Pick<Metric<number>, "value" | "unit">;

const overviewPanelHeader = {
  eyebrow: "Opportunity overview",
  title: "Is today's price worth the risk?",
  description:
    "Connect entry price, estimated value, cash generation, and financial resilience before judging the opportunity.",
} as const;

const money = (value: number | null, currency = "USD", compact = false) => {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 2 : 2,
  }).format(value);
};

const percentValue = (value: number | null, isRatio = false) => {
  if (value === null || !Number.isFinite(value)) return null;
  return isRatio ? value * 100 : value;
};

const percent = (value: number | null, digits = 1, isRatio = false) => {
  const normalized = percentValue(value, isRatio);
  return normalized === null ? "—" : `${normalized.toFixed(digits)}%`;
};

const multiple = (value: number | null) =>
  value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}×`;

const asOfDate = (value: string | null | undefined) =>
  value ? value.slice(0, 10) : "Not supplied";

const unwrapResponse = async (response: Response) => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Request failed (${response.status})`;
    const error = new Error(message) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return payload;
};

export default function SecuritySummaryClient({ exchange, symbol }: Props) {
  const canonicalSymbol = symbol.toUpperCase();
  const {
    summary,
    loading,
    refreshing,
    error,
    notFound,
    refreshSummary,
  } = useSecurityResearchShell();
  const [series, setSeries] = useState<SeriesResponse | null>(null);
  const [priceSeries, setPriceSeries] = useState<SeriesResponse | null>(null);
  const [peers, setPeers] = useState<PeersResponse | null>(null);
  const [overviewRefreshing, setOverviewRefreshing] = useState(false);

  const seriesPath = `/api/security/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}/series?group=valuation&range=max`;
  const priceSeriesPath = `/api/security/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}/series?group=price&range=3m`;
  const peersPath = `/api/security/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}/peers`;

  const loadOverviewData = useCallback(
    async (signal?: AbortSignal) => {
      const results = await Promise.allSettled([
        fetch(seriesPath, { signal, cache: "no-store" })
          .then(unwrapResponse)
          .then((payload) => setSeries(normalizeSeries(payload, symbol))),
        fetch(priceSeriesPath, { signal, cache: "no-store" })
          .then(unwrapResponse)
          .then((payload) => setPriceSeries(normalizeSeries(payload, symbol))),
        fetch(peersPath, { signal, cache: "no-store" })
          .then(unwrapResponse)
          .then((payload) => setPeers(normalizePeers(payload, symbol))),
      ]);
      if (signal?.aborted) return;
      if (results[0].status === "rejected") setSeries(null);
      if (results[1].status === "rejected") setPriceSeries(null);
      if (results[2].status === "rejected") setPeers(normalizePeers({}, symbol));
    },
    [peersPath, priceSeriesPath, seriesPath, symbol],
  );

  useEffect(() => {
    if (!summary || !summary.applicability.companyAnalysis) return;
    const controller = new AbortController();
    const initial = window.setTimeout(
      () => void loadOverviewData(controller.signal),
      0,
    );
    return () => {
      window.clearTimeout(initial);
      controller.abort();
    };
  }, [loadOverviewData, summary]);

  const refreshOverview = useCallback(async () => {
    setOverviewRefreshing(true);
    try {
      await refreshSummary(true);
      if (summary?.applicability.companyAnalysis) {
        await loadOverviewData();
      }
    } finally {
      setOverviewRefreshing(false);
    }
  }, [
    loadOverviewData,
    refreshSummary,
    summary?.applicability.companyAnalysis,
  ]);

  const panelRefreshAction = (
    <button
      type="button"
      className="security-research-panel-header__action"
      aria-label="Refresh opportunity overview"
      disabled={loading || refreshing || overviewRefreshing}
      onClick={() => void refreshOverview()}
    >
      <RefreshCw
        aria-hidden="true"
        className={refreshing || overviewRefreshing ? "is-spinning" : undefined}
        size={15}
      />
      Refresh overview
    </button>
  );

  if (loading && !summary) {
    return (
      <SecuritySkeleton
        symbol={canonicalSymbol}
        action={panelRefreshAction}
      />
    );
  }

  if (notFound) {
    return (
      <div className="security-page">
        <div className="security-container">
          <Link className="security-back" href="/value-opportunities"><ArrowLeft aria-hidden="true" size={16} />Back to opportunities</Link>
          <section className="security-card security-not-found">
            <div className="security-card-icon"><Search aria-hidden="true" /></div>
            <p className="security-eyebrow">Security not found</p>
            <h2>{canonicalSymbol} isn’t in the local catalog</h2>
            <p>Check the exchange and ticker, or return to the opportunity finder to choose a supported security.</p>
            <Link href="/value-opportunities">Open opportunity finder <ArrowRight aria-hidden="true" size={16} /></Link>
          </section>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="security-page">
        <div className="security-container">
          <ResearchPanelHeader
            view="overview"
            {...overviewPanelHeader}
            action={panelRefreshAction}
          />
          <section className="security-card security-not-found" role="status">
            <div className="security-card-icon"><Database aria-hidden="true" /></div>
            <p className="security-eyebrow">Company data unavailable</p>
            <h2>We could not load {canonicalSymbol}&apos;s current figures</h2>
            <p>{error ?? "The latest company figures are temporarily unavailable. No substitute values have been inserted."}</p>
            <button className="security-research-panel-header__action" type="button" onClick={() => void refreshOverview()}>
              <RefreshCw aria-hidden="true" size={16} />
              Try again
            </button>
          </section>
        </div>
      </div>
    );
  }

  const data = summary;
  if (!data.applicability.companyAnalysis) {
    return (
      <div className="security-page">
        <div className="security-container">
          <ResearchPanelHeader
            view="overview"
            {...overviewPanelHeader}
            action={panelRefreshAction}
          />
          <section className="security-card security-not-found" role="status">
            <div className="security-card-icon"><Info aria-hidden="true" /></div>
            <p className="security-eyebrow">Analysis not applicable</p>
            <h2>Company analysis is unavailable for {canonicalSymbol}</h2>
            <p>
              {data.applicability.reason ??
                "This security type does not support the company valuation and business-quality models."}
            </p>
          </section>
        </div>
      </div>
    );
  }
  const valuationSeries = series?.series.some((line) => line.points.length) ? series : null;
  const netMargin = data.derived.netMargin.value;
  const fcfMargin = data.derived.freeCashFlowMargin.value;
  const companyDescription = data.identity.description.value
    ? providerNeutralText(data.identity.description.value)
    : "";

  return (
    <div className="security-page">
      <div className="security-orb security-orb-one" aria-hidden="true" />
      <div className="security-orb security-orb-two" aria-hidden="true" />
      <div className="security-container">
        {error ? (
          <div className="security-data-notice" role="status">
            <Database aria-hidden="true" size={16} />
            <span><strong>Some data is unavailable.</strong> Available values remain visible; missing values are left blank.</span>
            <button type="button" onClick={() => void refreshSummary(true)}>Try again</button>
          </div>
        ) : null}
        <ResearchPanelHeader
          view="overview"
          {...overviewPanelHeader}
          action={panelRefreshAction}
        />

        {companyDescription ? (
          <div className="security-company-description">
            <p>{companyDescription}</p>
          </div>
        ) : null}

        <section className="security-card security-market-card" aria-labelledby="market-chart-heading">
          <SectionHeading
            id="market-chart-heading"
            eyebrow="Entry price"
            title="What is the market asking?"
            description={`Recent ${canonicalSymbol} price history frames the entry point and the risk of paying for expectations already reflected in the shares.`}
            icon={<LineChart aria-hidden="true" />}
          />
          <ValuationHistoryChart data={priceSeries} kind="price" />
        </section>

        <section className="security-card security-value-card" aria-labelledby="value-heading">
          <SectionHeading
            id="value-heading"
            eyebrow="Opportunity range"
            title="Is the discount wide enough?"
            description="Compare independently sourced and calculated valuation methods with price before judging the possible upside."
            icon={<Scale aria-hidden="true" />}
          />
          <div className="security-value-hero">
            <div>
              <span>Estimated value</span>
              <strong>{money(data.valuation.fairValue.value, data.identity.currency)}</strong>
            </div>
            <div className={`security-upside ${((data.valuation.mispricing.value ?? 0) >= 0) ? "is-positive" : "is-negative"}`}>
              <span>Implied value gap</span>
              <strong>{signedPercent(data.valuation.mispricing.value)}</strong>
              <small>versus current price</small>
            </div>
          </div>
          <ValuationRange data={data} />
          <div className="security-valuation-methods">
            <MetricBlock label="Provider DCF" metric={data.valuation.dcfValue} formatter={(value) => money(value, data.identity.currency)} />
            <MetricBlock label="Peer-based value" metric={data.valuation.peerValue} formatter={(value) => money(value, data.identity.currency)} />
          </div>
          <CalculationDisclosure
            title="How estimated value is selected"
            summary="Implied value gap = selected value ÷ current price − 1"
            badges={[
              data.valuation.dcfValue.value !== null ? "Provider DCF selected" : data.valuation.peerValue.value !== null ? "Peer estimate selected" : "No value selected",
              data.valuation.dcfValue.value !== null
                ? `DCF ${asOfDate(data.valuation.dcfValue.asOf)}`
                : data.valuation.peerValue.value !== null
                  ? `Peers ${asOfDate(data.valuation.peerValue.asOf)}`
                  : null,
              `Price ${asOfDate(data.quote.price.asOf)}`,
            ]}
            formulas={[
              { label: "Selected value", expression: "positive provider DCF; otherwise positive peer estimate" },
              { label: "Value gap", expression: "selected value / positive current price - 1" },
              { label: "Peer estimate", expression: "median of positive P/E, P/S and P/B implied values" },
              { label: "Method value", expression: "peer median multiple × (price / company multiple)" },
            ]}
            items={[
              { label: "Provider DCF", value: `Latest-dated positive value in the provider's DCF series. Its discount rate, terminal growth, forecast horizon, and per-share bridge are not included in the feed.` },
              { label: "Interpretation", value: "This is implied upside/downside relative to price, not the conventional discount-to-fair-value denominator." },
              { label: "Peer guard", value: "Each multiple needs at least three positive peer observations; the final estimate uses whichever valid methods remain." },
            ]}
          />
        </section>

        <section className="security-card" aria-labelledby="valuation-history-heading">
          <SectionHeading
            id="valuation-history-heading"
            eyebrow="Downside protection"
            title="How do provider price history and dated DCF values compare?"
            description="This chart compares returned market-price history with the provider’s dated DCF value series; it is not a history of analyst estimate revisions."
            icon={<Activity aria-hidden="true" />}
          />
          <ValuationHistoryChart data={valuationSeries} />
          <CalculationDisclosure
            title="What this chart contains"
            summary="Historical price points + provider-dated DCF value points"
            badges={[`Series ${asOfDate(valuationSeries?.asOf)}`]}
            items={[
              { label: "Price history", value: "Provider adjusted market-price observations." },
              { label: "DCF series", value: "Dated values returned in the provider DCF module; future dates are valuation forecast periods, not past estimate revisions." },
              { label: "No persistence score", value: "The app does not calculate a duration, confidence band, or probability from this chart." },
            ]}
          />
        </section>

        <section className="security-card" aria-labelledby="fundamentals-heading">
          <SectionHeading
            id="fundamentals-heading"
            eyebrow="Quality versus risk"
            title="Can the business support the opportunity?"
            description="Operating evidence, financial resilience, and expectations help distinguish a durable discount from a value trap."
            icon={<ShieldCheck aria-hidden="true" />}
          />
          <div className="security-score-grid">
            <ScoreCard label="Operating evidence" metric={data.scores.past} icon={<BarChart3 aria-hidden="true" />} color="blue" />
            <ScoreCard label="Financial resilience" metric={data.scores.health} icon={<HeartPulse aria-hidden="true" />} color="green" />
            <ScoreCard label="Growth expectations" metric={data.scores.future} icon={<TrendingUp aria-hidden="true" />} color="purple" />
          </div>
          <div className="security-metric-grid">
            <MetricTile label="P / E" metric={data.fundamentals.pe} formatter={multiple} />
            <MetricTile label="P / B" metric={data.fundamentals.pb} formatter={multiple} />
            <MetricTile label="P / S" metric={data.fundamentals.ps} formatter={multiple} />
            <MetricTile label="Return on equity" metric={data.fundamentals.roe} formatter={percent} />
            <MetricTile label="Revenue growth" metric={data.fundamentals.revenueGrowth} formatter={percent} />
            <MetricTile label="Earnings growth" metric={data.fundamentals.earningsGrowth} formatter={percent} />
            <MetricTile label="Dividend yield" metric={data.fundamentals.dividendYield} formatter={percent} />
            <MetricTile label="EPS" metric={data.fundamentals.eps} formatter={(value) => money(value, data.identity.currency)} />
          </div>
          <CalculationDisclosure
            title="Score and metric definitions"
            summary="Displayed score labels are local bands; provider score weights are not supplied"
            formulas={[
              { label: "Score label", expression: "≥8 Strong; ≥6.5 Healthy; ≥4.5 Balanced; otherwise Needs review" },
            ]}
            items={[
              { label: "Scores", value: "Past, health, and future scores are provider-supplied on a 0–10 scale. The feed does not expose their component weights, so the app does not recalculate them." },
              { label: "Multiples", value: "P/E and P/S use trailing-twelve-month provider figures; P/B uses the latest reported-quarter book value." },
              { label: "Growth & returns", value: "Revenue growth and earnings growth are provider TTM year-over-year values; ROE is the provider annualized return; dividend yield is trailing twelve months." },
            ]}
          />
        </section>

        <section className="security-card" aria-labelledby="financials-heading">
          <SectionHeading
            id="financials-heading"
            eyebrow="Owner earnings"
            title="Do profits become cash?"
            description="Fiscal-year totals are used when returned. If only the provider series is available, it is labelled as a year-end TTM observation rather than an annual sum."
            icon={<FileText aria-hidden="true" />}
          />
          <FinancialHistoryChart periods={data.financials.annual} />
          <div className="security-financial-snapshot">
            <MetricBlock label="Revenue" metric={data.fundamentals.revenue} formatter={(value) => money(value, data.identity.currency, true)} />
            <MetricBlock label="Net income" metric={data.fundamentals.netIncome} formatter={(value) => money(value, data.identity.currency, true)} />
            <MetricBlock label="Free-cash-flow proxy" metric={data.fundamentals.freeCashFlow} formatter={(value) => money(value, data.identity.currency, true)} />
            <MetricBlock label="Net margin" metric={{ value: netMargin, unit: "ratio" }} formatter={(value) => percent(value, 1, true)} />
          </div>
          <Disclosure title="View financial statement table" icon={<BookOpen aria-hidden="true" />}>
            {data.financials.annual.length ? (
              <div className="security-table-scroll">
                <table className="security-table">
                  <thead><tr><th>Period</th><th>Revenue</th><th>Net income</th></tr></thead>
                  <tbody>
                    {data.financials.annual.slice().reverse().map((row) => (
                      <tr key={row.period}>
                        <th>{row.period}</th>
                        <td>{money(row.revenue, data.identity.currency, true)}</td>
                        <td>{money(row.netIncome, data.identity.currency, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Unavailable message="No statement history was returned for this security." />}
          </Disclosure>
          <Disclosure title="Owner-earnings bridge and margins" icon={<CircleDollarSign aria-hidden="true" />}>
            <div className="security-detail-columns">
              <div>
                <h3>Cash conversion</h3>
                <CashFlowWaterfall bridge={data.derived.cashFlowBridge} />
              </div>
              <div>
                <h3>Margin snapshot</h3>
                <div className="security-margin-list">
                  <MarginRow label="Net income margin" value={netMargin} isRatio />
                  <MarginRow label="Free cash flow margin" value={fcfMargin} isRatio />
                  <MarginRow label="Return on equity" value={data.fundamentals.roe.value} />
                  <MarginRow label="Revenue growth" value={data.fundamentals.revenueGrowth.value} />
                </div>
              </div>
            </div>
          </Disclosure>
          <CalculationDisclosure
            title="Cash and margin calculations"
            summary="Net margin = net income ÷ revenue · FCF margin = free cash flow ÷ revenue"
            formulas={[
              { label: "Net margin", expression: "TTM net income / TTM revenue" },
              { label: "FCF margin", expression: "TTM free cash flow / TTM revenue" },
              { label: "Combined costs", expression: "net income - revenue" },
              { label: "Cash conversion bridge", expression: "free cash flow - net income" },
            ]}
            items={[
              { label: "Free-cash-flow proxy", value: "This is the provider's TTM free cash flow. It is not a locally adjusted owner-earnings figure and does not estimate maintenance capital expenditure." },
              { label: "Bridge scope", value: "The waterfall is a simplified reconciliation built from the three displayed totals; it is not a full cash-flow statement." },
            ]}
          />
        </section>

        <section className="security-card" aria-labelledby="research-heading">
          <SectionHeading
            id="research-heading"
            eyebrow="Thesis tests"
            title="What supports—or breaks—the opportunity?"
            description="Use the available evidence to identify the assumptions that matter most; this is a diligence starting point, not a recommendation."
            icon={<Search aria-hidden="true" />}
          />
          {data.narrative.length ? (
            <div className="security-insight-grid">
              {data.narrative.map((item, index) => (
                <article key={`${item}-${index}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{item}</p>
                </article>
              ))}
            </div>
          ) : <Unavailable message="There is not enough financial history to build a company-specific narrative." />}
          <Disclosure title="Open the thesis-test checklist" icon={<MessageSquareText aria-hidden="true" />}>
            {data.researchPrompts.length ? (
              <ul className="security-prompt-list">
                {data.researchPrompts.map((prompt) => <li key={prompt}><ChevronRight aria-hidden="true" />{prompt}</li>)}
              </ul>
            ) : <Unavailable message="Research prompts are unavailable for this security." />}
            <p className="security-helper">These are static research questions. No chatbot or background analysis is running.</p>
          </Disclosure>
        </section>

        <section className="security-card" aria-labelledby="returns-heading">
          <SectionHeading
            id="returns-heading"
            eyebrow="Downside protection"
            title="Capital allocation and balance-sheet risk"
            description="Owner returns must be weighed against leverage, liquidity needs, and reinvestment demands."
            icon={<WalletCards aria-hidden="true" />}
          />
          <div className="security-capital-list">
            <MetricBlock label={data.capitalReturns.dividends.unit?.includes("share") ? "Dividends / share" : "Dividends"} metric={data.capitalReturns.dividends} formatter={(value) => data.capitalReturns.dividends.unit === "%" ? percent(value) : money(value, data.identity.currency, true)} />
            <MetricBlock label="Debt / equity" metric={data.capitalReturns.debtToEquity} formatter={(value) => data.capitalReturns.debtToEquity.unit === "%" ? percent(value) : multiple(value)} />
          </div>
          <CalculationDisclosure
            title="Capital-return inputs"
            summary="Annual dividend per share and provider-defined debt-to-equity"
            items={[
              { label: "Dividend", value: "The first valid annual dividend amount returned by the provider module. Confirm the represented period in company filings." },
              { label: "Debt / equity", value: "A provider-supplied ratio. The page does not reconstruct it because the provider's debt and equity scope is not included." },
            ]}
          />
        </section>

        <section className="security-card" aria-labelledby="peers-heading">
          <SectionHeading
            id="peers-heading"
            eyebrow="Opportunity context"
            title="Is the discount company-specific?"
            description="Peer pricing helps test whether the apparent discount reflects a unique opportunity, a sector-wide concern, or company-specific risk."
            icon={<Building2 aria-hidden="true" />}
          />
          {peers?.peers.length ? (
            <>
              {peers.selectionReason ? (
                <p className="security-peer-note" role="status">
                  <Info aria-hidden="true" size={16} />
                  <span>{peers.selectionReason}</span>
                </p>
              ) : null}
              <div className="security-table-scroll">
                <table className="security-table security-peer-table">
                <thead><tr><th>Company</th><th>Price</th><th>Market cap</th><th>P / E</th><th>P / B</th><th>P / S</th></tr></thead>
                <tbody>
                  {peers.peers.map((peer) => (
                    <tr key={`${peer.marketCode ?? "peer"}-${peer.symbol}`}>
                      <th><span className="security-peer-symbol">{peer.symbol}</span>{peer.company}</th>
                      <td>{money(peer.price, data.identity.currency)}</td>
                      <td>{money(peer.marketCap, data.identity.currency, true)}</td>
                      <td>{multiple(peer.pe)}</td><td>{multiple(peer.pb)}</td><td>{multiple(peer.ps)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><th>Peer median</th><td>—</td><td>—</td><td>{multiple(peers.medians.pe)}</td><td>{multiple(peers.medians.pb)}</td><td>{multiple(peers.medians.ps)}</td></tr></tfoot>
                </table>
              </div>
            </>
          ) : <Unavailable message="Comparable-company data is not available for this security." />}
          <CalculationDisclosure
            title="How comparable companies are chosen"
            summary="Industry first · size-nearest issuers · positive-multiple medians"
            badges={[peers?.asOf ? `Peer snapshot ${asOfDate(peers.asOf)}` : null]}
            formulas={[
              { label: "Peer median", expression: "middle positive finite observation; average the two middle values when count is even" },
            ]}
            items={[
              { label: "Selection", value: "Start with the provider industry, exclude the target and duplicate issuers, require at least two usable P/E, P/S, or P/B values, then retain up to eight closest companies by log market-cap distance." },
              { label: "Fallback", value: "A broader sector peer group is used when any displayed multiple has fewer than three usable industry observations." },
              { label: "Refresh scope", value: "This table is fetched separately from the overview summary; its timestamp is shown above because a refresh can momentarily differ from the selected peer estimate." },
            ]}
          />
        </section>

        <section className="security-card" aria-labelledby="related-heading">
          <SectionHeading
            id="related-heading"
            eyebrow="Compare opportunities"
            title="Related opportunity overviews"
            description="Compare price, quality, and risk with another company before committing to a thesis."
            icon={<Search aria-hidden="true" />}
          />
          {data.related.length ? (
            <div className="security-related-grid">
              {data.related.map((relatedSecurity) => (
                <Link key={`${relatedSecurity.exchange}:${relatedSecurity.symbol}`} href={`/value-opportunities/${relatedSecurity.exchange.toLowerCase()}/${relatedSecurity.symbol.toLowerCase()}/overview`}>
                  <div><span>{relatedSecurity.exchange.toUpperCase()}</span><strong>{relatedSecurity.symbol.toUpperCase()}</strong></div>
                  <ArrowRight aria-hidden="true" />
                </Link>
              ))}
            </div>
          ) : <Unavailable message="No related securities were returned for this company." />}
        </section>

        <section className="security-faq" aria-labelledby="faq-heading">
          <div>
            <p className="security-eyebrow">Opportunity method</p>
            <h2 id="faq-heading">Questions before capital is at risk</h2>
          </div>
          <div>
            <details><summary>What makes the current price attractive?<ChevronRight aria-hidden="true" /></summary><p>Price becomes potentially attractive when it sits meaningfully below a conservative estimate of normalized owner earnings or value, while the business quality and balance sheet can protect the downside. A low multiple alone does not establish an opportunity.</p></details>
            <details><summary>How much margin of safety is enough?<ChevronRight aria-hidden="true" /></summary><p>The required discount should grow with uncertainty, cyclicality, leverage, customer concentration, and the risk of permanent capital loss. No single percentage is sufficient on its own.</p></details>
            <details><summary>What can invalidate the opportunity?<ChevronRight aria-hidden="true" /></summary><p>Persistent margin erosion, weaker cash conversion, balance-sheet stress, dilution, poor capital allocation, or evidence that normalized demand is lower than assumed can break the thesis even if the quoted price falls.</p></details>
            <details><summary>What should I verify before acting?<ChevronRight aria-hidden="true" /></summary><p>Read current company filings, reconcile reported earnings with cash flow, test valuation assumptions, inspect debt and dilution, compare credible alternatives, and decide whether the possible loss fits your objectives and risk tolerance.</p></details>
          </div>
        </section>

        <p className="security-page-note">
          For research only; this page is not investment advice or a recommendation. Data may be delayed or incomplete, and missing fields remain blank. Verify company filings and consider your own objectives and risk tolerance before acting.
        </p>
      </div>
    </div>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  icon,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="security-section-heading">
      <div className="security-card-icon">{icon}</div>
      <div className="security-section-copy">
        <p className="security-eyebrow">{eyebrow}</p>
        <h2 id={id}>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}

function MetricBlock({
  label,
  metric,
  formatter,
}: {
  label: string;
  metric: DisplayMetric;
  formatter: (value: number | null) => string;
}) {
  return (
    <div className="security-metric-block">
      <span>{label}</span>
      <strong>{formatter(metric.value)}</strong>
    </div>
  );
}

function MetricTile({
  label,
  metric,
  formatter,
}: {
  label: string;
  metric: DisplayMetric;
  formatter: (value: number | null) => string;
}) {
  return (
    <div className="security-metric-tile">
      <span>{label}</span>
      <strong>{formatter(metric.value)}</strong>
    </div>
  );
}

function ScoreCard({
  label,
  metric,
  icon,
  color,
}: {
  label: string;
  metric: DisplayMetric;
  icon: React.ReactNode;
  color: "blue" | "green" | "purple";
}) {
  const isTenPointScale = metric.unit === "/10" || (metric.value !== null && metric.value <= 10);
  const normalizedValue = metric.value === null ? null : isTenPointScale ? metric.value * 10 : metric.value;
  const displayValue = metric.value === null
    ? "—"
    : isTenPointScale
      ? metric.value.toFixed(metric.value % 1 === 0 ? 0 : 1)
      : String(Math.round(metric.value));
  return (
    <article className={`security-score-card is-${color}`}>
      <div>{icon}<span>{label}</span></div>
      <strong>{displayValue}{isTenPointScale && metric.value !== null ? <small>/10</small> : null}</strong>
      <div className="security-score-bar"><i style={{ width: `${Math.min(100, Math.max(0, normalizedValue ?? 0))}%` }} /></div>
      <div className="security-score-foot"><span>{normalizedValue === null ? "Unavailable" : scoreLabel(normalizedValue)}</span></div>
    </article>
  );
}

function ValuationRange({ data }: { data: SecuritySummary }) {
  const marks = [
    { label: "Provider DCF", value: data.valuation.dcfValue.value, className: "is-bear" },
    { label: "Selected value", value: data.valuation.fairValue.value, className: "is-base" },
    { label: "Peer estimate", value: data.valuation.peerValue.value, className: "is-bull" },
  ];
  const methodValues = marks
    .map((mark) => mark.value)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (!methodValues.length) return <Unavailable message="No current valuation method is available for this security." />;
  const values = [data.quote.price.value, ...methodValues]
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max((rawMax - rawMin) * 0.08, Math.abs(rawMax || rawMin) * 0.04, 1);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const position = (value: number | null) => value === null ? null : Math.max(0, Math.min(100, (value - min) / (max - min) * 100));
  return (
    <div className="security-range-wrap">
      <div className="security-range-track">
        <div className="security-range-gradient" />
        {marks.map((mark) => {
          const left = position(mark.value);
          return left === null ? null : <i key={mark.label} className={mark.className} style={{ left: `${left}%` }} />;
        })}
        {position(data.quote.price.value) !== null ? (
          <span className="security-price-marker" style={{ left: `${position(data.quote.price.value)}%` }}><i />Price</span>
        ) : null}
      </div>
      <div className="security-range-labels">
        {marks.map((mark) => (
          <div key={mark.label}><span>{mark.label}</span><strong>{money(mark.value, data.identity.currency)}</strong></div>
        ))}
      </div>
    </div>
  );
}

function Disclosure({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="security-disclosure">
      <summary>{icon}<span>{title}</span><ChevronRight aria-hidden="true" className="security-disclosure-arrow" /></summary>
      <div className="security-disclosure-content">{children}</div>
    </details>
  );
}

function MarginRow({ label, value, isRatio = false }: { label: string; value: number | null; isRatio?: boolean }) {
  const normalized = percentValue(value, isRatio);
  return (
    <div className="security-margin-row">
      <div><span>{label}</span><strong>{percent(value, 1, isRatio)}</strong></div>
      <div><i style={{ width: `${Math.max(0, Math.min(100, normalized ?? 0))}%` }} /></div>
    </div>
  );
}

function Unavailable({ message }: { message: string }) {
  return <div className="security-unavailable"><Info aria-hidden="true" size={17} /><span>{message}</span></div>;
}

function SecuritySkeleton({
  symbol,
  action,
}: {
  symbol: string;
  action: React.ReactNode;
}) {
  return (
    <div className="security-page">
      <div className="security-container security-skeleton" aria-busy="true" aria-label={`Loading ${symbol} summary`}>
        <ResearchPanelHeader
          view="overview"
          {...overviewPanelHeader}
          action={action}
        />
        <div className="security-skeleton-card" />
        <div className="security-skeleton-grid"><div /><div /></div>
      </div>
    </div>
  );
}

function scoreLabel(value: number) {
  if (value >= 80) return "Strong";
  if (value >= 65) return "Healthy";
  if (value >= 45) return "Balanced";
  return "Needs review";
}

function signedPercent(value: number | null) {
  const normalized = percentValue(value, true);
  if (normalized === null) return "—";
  return `${normalized > 0 ? "+" : ""}${normalized.toFixed(1)}%`;
}
