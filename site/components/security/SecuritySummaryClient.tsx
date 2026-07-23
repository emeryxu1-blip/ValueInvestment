"use client";

import Link from "next/link";
import {
  Activity,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Building2,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Database,
  FileText,
  Gauge,
  HeartPulse,
  Info,
  Landmark,
  LineChart,
  MessageSquareText,
  PieChart as PieChartIcon,
  RefreshCw,
  Save,
  Scale,
  Search,
  ShieldCheck,
  Target,
  TrendingUp,
  Users,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { normalizePeers, normalizeSeries, normalizeSummary, providerNeutralText } from "./data";
import {
  CashAndDebtChart,
  CashFlowWaterfall,
  FinancialHistoryChart,
  OwnershipChart,
  ValuationHistoryChart,
} from "./SecurityCharts";
import { SecurityResearchNav } from "./SecurityResearchNav";
import type { Metric, PeersResponse, SecuritySummary, SeriesResponse } from "./types";

type Props = {
  exchange: string;
  symbol: string;
};

type Sentiment = "bear" | "neutral" | "bull";
type DisplayMetric = Pick<Metric<number>, "value" | "unit">;
type WorkspaceJournal = {
  note: string;
  sentiment: Sentiment;
  watchPrice: number | null;
};

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

const storageKey = (exchange: string, symbol: string, field: string) =>
  `value-lens:${exchange.toLowerCase()}:${symbol.toLowerCase()}:${field}`;

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
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  const [series, setSeries] = useState<SeriesResponse | null>(null);
  const [priceSeries, setPriceSeries] = useState<SeriesResponse | null>(null);
  const [peers, setPeers] = useState<PeersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [sentiment, setSentiment] = useState<Sentiment>("neutral");
  const [watchSaved, setWatchSaved] = useState<number | null>(null);
  const [watchInput, setWatchInput] = useState("");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const summaryPath = `/api/security/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}/summary`;
  const seriesPath = `/api/security/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}/series?group=valuation&range=max`;
  const priceSeriesPath = `/api/security/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}/series?group=price&range=3m`;
  const peersPath = `/api/security/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}/peers`;
  const journalPath = `/api/workspace/journal/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}`;

  const applyJournal = useCallback((journal: WorkspaceJournal) => {
    setNote(journal.note);
    setSentiment(journal.sentiment);
    setWatchSaved(journal.watchPrice);
    setWatchInput(
      journal.watchPrice === null ? "" : journal.watchPrice.toFixed(2),
    );
  }, [setNote, setSentiment, setWatchInput, setWatchSaved]);

  const persistJournal = useCallback(
    async (journal: WorkspaceJournal) => {
      const response = await fetch(journalPath, {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(journal),
      });
      const payload = (await unwrapResponse(response)) as {
        journal: WorkspaceJournal;
      };
      applyJournal(payload.journal);
      setWorkspaceError(null);
      return payload.journal;
    },
    [applyJournal, journalPath],
  );

  const loadSummary = useCallback(
    async (background = false) => {
      if (background) setRefreshing(true);
      else setLoading(true);
      try {
        const payload = await unwrapResponse(await fetch(summaryPath, { cache: "no-store" }));
        setSummary(normalizeSummary(payload, exchange, symbol));
        setNotFound(false);
        setError(null);
      } catch (reason) {
        if (reason instanceof Error && "status" in reason && reason.status === 404) {
          setNotFound(true);
          setError(null);
          return;
        }
        setSummary((current) => current ?? normalizeSummary({}, exchange, symbol));
        setError(reason instanceof Error ? reason.message : "Data is temporarily unavailable");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [exchange, summaryPath, symbol],
  );

  useEffect(() => {
    const initial = window.setTimeout(() => void loadSummary(), 0);
    const interval = window.setInterval(() => void loadSummary(true), 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [loadSummary]);

  useEffect(() => {
    let cancelled = false;

    async function loadJournal() {
      try {
        const response = await fetch(journalPath, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        const payload = (await unwrapResponse(response)) as {
          journal: WorkspaceJournal | null;
        };
        let journal = payload.journal;

        if (journal === null) {
          const localNote =
            window.localStorage.getItem(
              storageKey(exchange, symbol, "note"),
            ) ?? "";
          const localSentiment = window.localStorage.getItem(
            storageKey(exchange, symbol, "sentiment"),
          );
          const localWatch = Number(
            window.localStorage.getItem(
              storageKey(exchange, symbol, "watch"),
            ),
          );
          const migrated: WorkspaceJournal = {
            note: localNote,
            sentiment:
              localSentiment === "bear" ||
              localSentiment === "bull" ||
              localSentiment === "neutral"
                ? localSentiment
                : "neutral",
            watchPrice:
              Number.isFinite(localWatch) && localWatch > 0
                ? localWatch
                : null,
          };
          if (
            migrated.note ||
            migrated.sentiment !== "neutral" ||
            migrated.watchPrice !== null
          ) {
            journal = await persistJournal(migrated);
            for (const field of ["note", "sentiment", "watch"]) {
              window.localStorage.removeItem(
                storageKey(exchange, symbol, field),
              );
            }
          }
        }

        if (!cancelled && journal) applyJournal(journal);
        if (!cancelled) setWorkspaceError(null);
      } catch {
        if (!cancelled) {
          setWorkspaceError(
            "Your private research workspace is temporarily unavailable.",
          );
        }
      }
    }

    void loadJournal();
    return () => {
      cancelled = true;
    };
  }, [applyJournal, exchange, journalPath, persistJournal, symbol]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      fetch(seriesPath, { signal: controller.signal, cache: "no-store" })
        .then(unwrapResponse)
        .then((payload) => setSeries(normalizeSeries(payload, symbol))),
      fetch(priceSeriesPath, { signal: controller.signal, cache: "no-store" })
        .then(unwrapResponse)
        .then((payload) => setPriceSeries(normalizeSeries(payload, symbol))),
      fetch(peersPath, { signal: controller.signal, cache: "no-store" })
        .then(unwrapResponse)
        .then((payload) => setPeers(normalizePeers(payload, symbol))),
    ]).then((results) => {
      if (results[0].status === "rejected") setSeries(null);
      if (results[1].status === "rejected") setPriceSeries(null);
      if (results[2].status === "rejected") setPeers(normalizePeers({}, symbol));
    });
    return () => controller.abort();
  }, [peersPath, priceSeriesPath, seriesPath, symbol]);

  const saveNote = async () => {
    try {
      await persistJournal({ note, sentiment, watchPrice: watchSaved });
      setNoteSaved(true);
      window.setTimeout(() => setNoteSaved(false), 1800);
    } catch {
      setWorkspaceError(
        "Your private research workspace is temporarily unavailable.",
      );
    }
  };

  const changeSentiment = (value: Sentiment) => {
    setSentiment(value);
    void persistJournal({ note, sentiment: value, watchPrice: watchSaved }).catch(
      () =>
        setWorkspaceError(
          "Your private research workspace is temporarily unavailable.",
        ),
    );
  };

  const saveWatch = () => {
    const parsed = Number(watchInput);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setWatchSaved(parsed);
    void persistJournal({ note, sentiment, watchPrice: parsed }).catch(() =>
      setWorkspaceError(
        "Your private research workspace is temporarily unavailable.",
      ),
    );
  };

  if (loading && !summary) return <SecuritySkeleton symbol={canonicalSymbol} />;

  if (notFound) {
    return (
      <main className="security-page">
        <div className="security-container">
          <Link className="security-back" href="/value-opportunities"><ArrowLeft aria-hidden="true" size={16} />Back to opportunities</Link>
          <section className="security-card security-not-found">
            <div className="security-card-icon"><Search aria-hidden="true" /></div>
            <p className="security-eyebrow">Security not found</p>
            <h1>{canonicalSymbol} isn’t in the local catalog</h1>
            <p>Check the exchange and ticker, or return to the opportunity finder to choose a supported security.</p>
            <Link href="/value-opportunities">Open opportunity finder <ArrowRight aria-hidden="true" size={16} /></Link>
          </section>
        </div>
      </main>
    );
  }

  const data = summary ?? normalizeSummary({}, exchange, symbol);
  const isPositive = (data.quote.changePercent.value ?? 0) >= 0;
  const changeClass = isPositive ? "is-positive" : "is-negative";
  const valuationSeries = series?.series.some((line) => line.points.length) ? series : null;
  const netMargin = data.derived.netMargin.value;
  const fcfMargin = data.derived.freeCashFlowMargin.value;
  const companyDescription = data.identity.description.value
    ? providerNeutralText(data.identity.description.value)
    : "";

  return (
    <main className="security-page">
      <div className="security-orb security-orb-one" aria-hidden="true" />
      <div className="security-orb security-orb-two" aria-hidden="true" />
      <div className="security-container">
        <Link className="security-back" href="/value-opportunities">
          <ArrowLeft aria-hidden="true" size={16} />
          Back to opportunities
        </Link>

        {error ? (
          <div className="security-data-notice" role="status">
            <Database aria-hidden="true" size={16} />
            <span><strong>Some data is unavailable.</strong> Available values remain visible; missing values are left blank.</span>
            <button type="button" onClick={() => void loadSummary(true)}>Try again</button>
          </div>
        ) : null}
        {workspaceError ? (
          <div className="security-data-notice" role="status">
            <Database aria-hidden="true" size={16} />
            <span>{workspaceError}</span>
          </div>
        ) : null}

        <header className="security-hero">
          <div className="security-identity">
            <div className="security-monogram" aria-hidden="true">{canonicalSymbol.slice(0, 2)}</div>
            <div>
              <div className="security-eyebrow-row">
                <span className="security-ticker">{data.identity.exchange}:{data.identity.symbol}</span>
              </div>
              <h1>{data.identity.company.value ?? canonicalSymbol} opportunity overview</h1>
              <p className="security-meta-line">
                Does today&apos;s price offer enough margin of safety for this
                business&apos;s quality and risks?
              </p>
            </div>
          </div>
          <div className="security-quote">
            <div className="security-quote-top">
              <span>{money(data.quote.price.value, data.identity.currency)}</span>
              <span className={`security-change ${changeClass}`}>
                {isPositive ? <ArrowUpRight aria-hidden="true" /> : <ArrowDownRight aria-hidden="true" />}
                {percent(data.quote.changePercent.value, 2)}
              </span>
            </div>
            <div className="security-quote-meta">
              <span>Market cap {money(data.quote.marketCap.value, data.identity.currency, true)}</span>
              <span className="security-freshness">
                <Clock3 aria-hidden="true" size={13} />
                {freshness(data.asOf)}
              </span>
              <button
                type="button"
                className="security-icon-button"
                onClick={() => void loadSummary(true)}
                aria-label="Refresh quote"
                disabled={refreshing}
              >
                <RefreshCw aria-hidden="true" className={refreshing ? "is-spinning" : ""} size={16} />
              </button>
            </div>
          </div>
        </header>

        <SecurityResearchNav exchange={exchange} symbol={symbol} active="summary" />

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

        <section className="security-value-grid" aria-labelledby="value-heading">
          <div className="security-card security-value-card">
            <SectionHeading
              id="value-heading"
              eyebrow="Opportunity range"
              title="Is the discount wide enough?"
              description="Compare estimated value with price to judge whether the possible upside adequately protects against uncertainty."
              icon={<Scale aria-hidden="true" />}
            />
            <div className="security-value-hero">
              <div>
                <span>Estimated value</span>
                <strong>{money(data.valuation.fairValue.value, data.identity.currency)}</strong>
              </div>
              <div className={`security-upside ${((data.valuation.mispricing.value ?? 0) >= 0) ? "is-positive" : "is-negative"}`}>
                <span>Implied margin of safety</span>
                <strong>{signedPercent(data.valuation.mispricing.value)}</strong>
                <small>versus current price</small>
              </div>
            </div>
            <ValuationRange data={data} />
            <div className="security-valuation-methods">
              <MetricBlock label="Cash-flow value" metric={data.valuation.dcfValue} formatter={(value) => money(value, data.identity.currency)} />
              <MetricBlock label="Peer-based value" metric={data.valuation.peerValue} formatter={(value) => money(value, data.identity.currency)} />
              <MetricBlock label="Analyst mean" metric={data.targets.mean} formatter={(value) => money(value, data.identity.currency)} />
            </div>
          </div>

          <aside className="security-card security-watch-card">
            <div className="security-card-icon is-blue"><Target aria-hidden="true" /></div>
            <p className="security-eyebrow">My margin of safety</p>
            <h2>Set a watch level</h2>
            <p>Keep a private price marker in your workspace. It does not send an alert.</p>
            <label htmlFor="watch-level">Watch at or below</label>
            <div className="security-input-combo">
              <span>{currencySymbol(data.identity.currency)}</span>
              <input
                id="watch-level"
                inputMode="decimal"
                value={watchInput}
                onChange={(event) => setWatchInput(event.target.value)}
                placeholder={data.valuation.fairValue.value ? (data.valuation.fairValue.value * 0.85).toFixed(2) : "0.00"}
                aria-describedby="watch-help"
              />
              <button type="button" onClick={saveWatch}>Save</button>
            </div>
            <p id="watch-help" className="security-helper">
              {watchSaved === null
                ? "A 15% discount to fair value is a common starting point, not a recommendation."
                : `Saved at ${money(watchSaved, data.identity.currency)} in your workspace.`}
            </p>
            {watchSaved !== null && data.quote.price.value !== null ? (
              <div className={`security-watch-state ${data.quote.price.value <= watchSaved ? "is-reached" : ""}`}>
                <Gauge aria-hidden="true" size={17} />
                {data.quote.price.value <= watchSaved
                  ? "The current price is at or below your marker."
                  : `${percent(data.quote.price.value / watchSaved - 1, 1, true)} above your marker.`}
              </div>
            ) : null}
          </aside>
        </section>

        <section className="security-card" aria-labelledby="valuation-history-heading">
          <SectionHeading
            id="valuation-history-heading"
            eyebrow="Downside protection"
            title="Has a margin of safety persisted?"
            description="Use the price-to-value relationship and its persistence—not a single point estimate—to test whether the opportunity is durable."
            icon={<Activity aria-hidden="true" />}
          />
          <ValuationHistoryChart data={valuationSeries} />
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
        </section>

        <section className="security-card" aria-labelledby="financials-heading">
          <SectionHeading
            id="financials-heading"
            eyebrow="Owner earnings"
            title="Do profits become cash?"
            description="Annual revenue, accounting earnings, and free cash flow reveal whether reported growth can accrue to owners."
            icon={<FileText aria-hidden="true" />}
          />
          <FinancialHistoryChart periods={data.financials.annual} />
          <div className="security-financial-snapshot">
            <MetricBlock label="Revenue" metric={data.fundamentals.revenue} formatter={(value) => money(value, data.identity.currency, true)} />
            <MetricBlock label="Net income" metric={data.fundamentals.netIncome} formatter={(value) => money(value, data.identity.currency, true)} />
            <MetricBlock label="Owner-earnings proxy" metric={data.fundamentals.freeCashFlow} formatter={(value) => money(value, data.identity.currency, true)} />
            <MetricBlock label="Net margin" metric={{ value: netMargin, unit: "ratio" }} formatter={(value) => percent(value, 1, true)} />
          </div>
          <Disclosure title="View financial statement table" icon={<BookOpen aria-hidden="true" />}>
            {data.financials.annual.length ? (
              <div className="security-table-scroll">
                <table className="security-table">
                  <thead><tr><th>Period</th><th>Revenue</th><th>Net income</th><th>Free cash flow</th><th>Cash</th><th>Debt</th></tr></thead>
                  <tbody>
                    {data.financials.annual.slice().reverse().map((row) => (
                      <tr key={row.period}>
                        <th>{row.period}</th>
                        <td>{money(row.revenue, data.identity.currency, true)}</td>
                        <td>{money(row.netIncome, data.identity.currency, true)}</td>
                        <td>{money(row.freeCashFlow, data.identity.currency, true)}</td>
                        <td>{money(row.cash, data.identity.currency, true)}</td>
                        <td>{money(row.debt, data.identity.currency, true)}</td>
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

        <section className="security-two-column">
          <div className="security-card" aria-labelledby="targets-heading">
            <SectionHeading
              id="targets-heading"
              eyebrow="Expectations check"
              title="What is the market expected to deliver?"
              description={data.targets.analystCount.value === null ? "Coverage count is unavailable; treat targets as expectations, not evidence." : `${Math.round(data.targets.analystCount.value)} tracked analysts frame expectations, not certainty.`}
              icon={<Target aria-hidden="true" />}
            />
            <TargetRange summary={data} />
          </div>
          <div className="security-card" aria-labelledby="returns-heading">
            <SectionHeading
              id="returns-heading"
              eyebrow="Downside protection"
              title="Capital allocation and balance-sheet risk"
              description="Owner returns must be weighed against leverage, liquidity needs, and reinvestment demands."
              icon={<WalletCards aria-hidden="true" />}
            />
            <div className="security-capital-list">
              <MetricBlock label={data.capitalReturns.dividends.unit?.includes("share") ? "Dividends / share" : "Dividends"} metric={data.capitalReturns.dividends} formatter={(value) => data.capitalReturns.dividends.unit === "%" ? percent(value) : money(value, data.identity.currency, true)} />
              <MetricBlock label="Buybacks" metric={data.capitalReturns.buybacks} formatter={(value) => money(value, data.identity.currency, true)} />
              <MetricBlock label="Debt / equity" metric={data.capitalReturns.debtToEquity} formatter={(value) => data.capitalReturns.debtToEquity.unit === "%" ? percent(value) : multiple(value)} />
            </div>
            <Disclosure title="View cash and debt history" icon={<Landmark aria-hidden="true" />}>
              <CashAndDebtChart periods={data.financials.annual} />
            </Disclosure>
          </div>
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
          ) : <Unavailable message="Comparable-company data is not available for this security." />}
        </section>

        <section className="security-two-column">
          <div className="security-card" aria-labelledby="ownership-heading">
            <SectionHeading
              id="ownership-heading"
              eyebrow="Incentives"
              title="Who shares the outcome?"
              description="Ownership context can sharpen questions about alignment, influence, and the durability of the thesis."
              icon={<PieChartIcon aria-hidden="true" />}
            />
            <OwnershipChart institutional={data.ownership.institutional} insider={data.ownership.insider} publicValue={data.ownership.public} />
          </div>
          <div className="security-card" aria-labelledby="insiders-heading">
            <SectionHeading
              id="insiders-heading"
              eyebrow="Governance checks"
              title="Transactions that can test conviction"
              description="Verify insider activity against company filings before treating it as evidence for or against the opportunity."
              icon={<Users aria-hidden="true" />}
            />
            <Unavailable message="Insider transaction history is not available for this security." />
          </div>
        </section>

        <section className="security-card" aria-labelledby="journal-heading">
          <SectionHeading
            id="journal-heading"
            eyebrow="Opportunity journal"
            title="Record the thesis and its breakpoints"
            description="Capture the price, margin-of-safety requirement, and invalidation tests in your private workspace."
            icon={<FileText aria-hidden="true" />}
          />
          <div className="security-journal-grid">
            <div>
              <span className="security-control-label">Current stance</span>
              <div className="security-segmented" role="radiogroup" aria-label="Investment sentiment">
                {(["bear", "neutral", "bull"] as Sentiment[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={sentiment === value}
                    className={sentiment === value ? "is-selected" : ""}
                    onClick={() => changeSentiment(value)}
                  >
                    {value[0].toUpperCase() + value.slice(1)}
                  </button>
                ))}
              </div>
              <p className="security-helper">This marker is for your own thesis tracking and is not a rating.</p>
            </div>
            <div>
              <label className="security-control-label" htmlFor="research-note">Research note</label>
              <textarea
                id="research-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={`What would invalidate the ${canonicalSymbol} opportunity?`}
                rows={5}
              />
              <button className="security-save-button" type="button" onClick={saveNote}>
                {noteSaved ? <Check aria-hidden="true" /> : <Save aria-hidden="true" />}
                {noteSaved ? "Saved to workspace" : "Save note"}
              </button>
            </div>
          </div>
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
              {data.related.map((relatedSymbol) => (
                <Link key={relatedSymbol} href={`/value-opportunities/${data.identity.exchange.toLowerCase()}/${relatedSymbol.toLowerCase()}/overview`}>
                  <div><span>{data.identity.exchange}</span><strong>{relatedSymbol.toUpperCase()}</strong></div>
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
            <details><summary>How much margin of safety is enough?<ChevronRight aria-hidden="true" /></summary><p>The required discount should grow with uncertainty, cyclicality, leverage, customer concentration, and the risk of permanent capital loss. The saved watch level is a private research marker, not a recommendation or alert.</p></details>
            <details><summary>What can invalidate the opportunity?<ChevronRight aria-hidden="true" /></summary><p>Persistent margin erosion, weaker cash conversion, balance-sheet stress, dilution, poor capital allocation, or evidence that normalized demand is lower than assumed can break the thesis even if the quoted price falls.</p></details>
            <details><summary>What should I verify before acting?<ChevronRight aria-hidden="true" /></summary><p>Read current company filings, reconcile reported earnings with cash flow, test valuation assumptions, inspect debt and dilution, compare credible alternatives, and decide whether the possible loss fits your objectives and risk tolerance.</p></details>
          </div>
        </section>

        <p className="security-page-note">
          For research only; this page is not investment advice or a recommendation. Data may be delayed or incomplete, and missing fields remain blank. Verify company filings and consider your own objectives and risk tolerance before acting.
        </p>
      </div>
    </main>
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
  const values = [
    data.valuation.bearValue.value,
    data.valuation.baseValue.value,
    data.valuation.bullValue.value,
    data.quote.price.value,
  ].filter((value): value is number => value !== null && Number.isFinite(value));
  if (!values.length) return <Unavailable message="A valuation range cannot be calculated from the available data." />;
  const min = Math.min(...values) * 0.92;
  const max = Math.max(...values) * 1.08;
  const position = (value: number | null) => value === null ? null : Math.max(0, Math.min(100, (value - min) / (max - min) * 100));
  const marks = [
    { label: "Bear", value: data.valuation.bearValue.value, className: "is-bear" },
    { label: "Base", value: data.valuation.baseValue.value, className: "is-base" },
    { label: "Bull", value: data.valuation.bullValue.value, className: "is-bull" },
  ];
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

function TargetRange({ summary }: { summary: SecuritySummary }) {
  const low = summary.targets.low.value;
  const mean = summary.targets.mean.value;
  const high = summary.targets.high.value;
  const current = summary.quote.price.value;
  const values = [low, mean, high, current].filter((value): value is number => value !== null);
  if (values.length < 2) return <Unavailable message="Analyst targets are not available for this security." />;
  const min = Math.min(...values) * 0.94;
  const max = Math.max(...values) * 1.06;
  const pos = (value: number | null) => value === null ? null : (value - min) / (max - min) * 100;
  return (
    <div className="security-target-range">
      <div className="security-target-summary">
        <div><span>Low</span><strong>{money(low, summary.identity.currency)}</strong></div>
        <div className="is-mean"><span>Mean</span><strong>{money(mean, summary.identity.currency)}</strong></div>
        <div><span>High</span><strong>{money(high, summary.identity.currency)}</strong></div>
      </div>
      <div className="security-target-track">
        <div />
        {pos(mean) !== null ? <i className="is-mean" style={{ left: `${pos(mean)}%` }} /> : null}
        {pos(current) !== null ? <span style={{ left: `${pos(current)}%` }}>Price</span> : null}
      </div>
      <p>Targets express analyst expectations, not certainty.</p>
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

function SecuritySkeleton({ symbol }: { symbol: string }) {
  return (
    <main className="security-page">
      <div className="security-container security-skeleton" aria-busy="true" aria-label={`Loading ${symbol} summary`}>
        <div className="security-skeleton-line is-short" />
        <div className="security-skeleton-hero"><div /><div /></div>
        <div className="security-skeleton-card" />
        <div className="security-skeleton-grid"><div /><div /></div>
      </div>
    </main>
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

function currencySymbol(currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? "$";
  } catch {
    return "$";
  }
}

function freshness(asOf: string | null) {
  if (!asOf) return "Latest available";
  const timestamp = new Date(asOf).getTime();
  if (!Number.isFinite(timestamp)) return asOf;
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  if (minutes < 24 * 60) return `Updated ${Math.floor(minutes / 60)}h ago`;
  return `As of ${new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}
