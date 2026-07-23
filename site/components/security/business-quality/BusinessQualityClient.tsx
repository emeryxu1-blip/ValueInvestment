"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Gauge,
  HelpCircle,
  Info,
  Landmark,
  LineChart,
  MinusCircle,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { BusinessQualityResponse } from "@/lib/contracts";
import type {
  DiligenceCheck,
  OpportunitySignal,
} from "@/lib/security/business-quality";
import { normalizeSummary } from "../data";
import ResearchPanelHeader from "../ResearchPanelHeader";
import {
  EarningsBridge,
  ProfitabilityTrendChart,
} from "./BusinessQualityCharts";

type Props = {
  exchange: string;
  symbol: string;
};

const qualityPanelHeader = {
  view: "quality" as const,
  eyebrow: "Quality check",
  title: "Can this business protect and grow owner earnings?",
  description:
    "Test whether durable margins, disciplined reinvestment, and cash-backed earnings can protect owners through a full business cycle.",
};

const money = (
  value: number | null,
  currency = "USD",
  compact = false,
) => {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 2 : 2,
  }).format(value);
};

const percent = (value: number | null, digits = 1) =>
  value === null || !Number.isFinite(value)
    ? "—"
    : `${(value * 100).toFixed(digits)}%`;

const multiple = (value: number | null, digits = 1) =>
  value === null || !Number.isFinite(value)
    ? "—"
    : `${value.toFixed(digits)}×`;

const signedPercent = (value: number | null) =>
  value === null || !Number.isFinite(value)
    ? "—"
    : `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;

const unwrapResponse = async (response: Response) => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "Business-quality data is temporarily unavailable.";
    throw new Error(message);
  }
  return payload;
};

export default function BusinessQualityClient({ exchange, symbol }: Props) {
  const canonicalSymbol = symbol.toUpperCase();
  const [quality, setQuality] = useState<BusinessQualityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qualityPath = `/api/security/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}/business-quality`;

  const loadData = useCallback(
    async (background = false) => {
      if (background) setRefreshing(true);
      else setLoading(true);
      try {
        const payload = (await fetch(qualityPath, {
          cache: "no-store",
        }).then(unwrapResponse)) as BusinessQualityResponse;
        setQuality(payload);
        setError(null);
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Business-quality data is temporarily unavailable.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [qualityPath],
  );

  useEffect(() => {
    const initial = window.setTimeout(() => void loadData(), 0);
    const interval = window.setInterval(() => void loadData(true), 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [loadData]);

  const panelRefreshAction = (
    <button
      type="button"
      className="security-research-panel-header__action"
      aria-label="Refresh business-quality data"
      disabled={loading || refreshing}
      onClick={() => void loadData(quality !== null)}
    >
      <RefreshCw
        aria-hidden="true"
        className={refreshing ? "is-spinning" : undefined}
        size={15}
      />
      Refresh quality
    </button>
  );

  if (loading && quality === null) {
    return (
      <BusinessQualitySkeleton
        symbol={canonicalSymbol}
        action={panelRefreshAction}
      />
    );
  }

  if (quality === null) {
    return (
      <div className="profitability-page">
        <div className="profitability-container">
          <ResearchPanelHeader
            {...qualityPanelHeader}
            action={panelRefreshAction}
          />
          <div className="profitability-notice" role="alert">
            <AlertTriangle aria-hidden="true" size={17} />
            <span>
              {error ?? "Business-quality data is temporarily unavailable."}
            </span>
            <button type="button" onClick={() => void loadData()}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const profitability = quality.profitability;
  const data = normalizeSummary(quality.summary, exchange, symbol);
  const analysis = quality.analysis;
  const peerEconomics = quality.peerEconomics;
  const peerMarginMedian = quality.peerMedians.netMargin;
  const peerRoeMedian = quality.peerMedians.returnOnEquity;
  const companyName =
    profitability?.identity.company ??
    data.identity.company.value ??
    canonicalSymbol;
  const currency =
    profitability?.identity.currency ?? data.identity.currency;
  const scoreStyle = {
    "--quality-score-angle": `${(analysis.score ?? 0) * 3.6}deg`,
  } as CSSProperties;

  return (
    <div className="profitability-page">
      <div className="profitability-container">
        {error ? (
          <div className="profitability-notice" role="status">
            <AlertTriangle aria-hidden="true" size={17} />
            <span>{error}</span>
            <button type="button" onClick={() => void loadData(true)}>
              Try again
            </button>
          </div>
        ) : null}

        <ResearchPanelHeader
          {...qualityPanelHeader}
          action={panelRefreshAction}
        />

        <div className="profitability-overview-grid">
          <section
            className="profitability-card profitability-score-card"
            aria-labelledby="quality-score-heading"
          >
            <SectionHeading
              icon={<Sparkles aria-hidden="true" />}
              eyebrow="Profitability score"
              title="Operating strength at a glance"
              id="quality-score-heading"
            />
            <div className="profitability-score-content">
              <div
                className="profitability-score-ring"
                role="meter"
                aria-label="Business-quality score"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={analysis.score ?? undefined}
                style={scoreStyle}
              >
                <div>
                  <strong>{analysis.score ?? "—"}</strong>
                  <span>{analysis.score === null ? "" : "/ 100"}</span>
                </div>
              </div>
              <div className="profitability-score-copy">
                <p className="profitability-score-label">
                  {analysis.scoreLabel}
                </p>
                <p>
                  The score reweights only the available checks. It needs at
                  least three inputs and measures operating economics, not
                  whether the shares are inexpensive.
                </p>
              </div>
            </div>
            <div className="profitability-score-breakdown">
              {analysis.scoreComponents.length ? (
                analysis.scoreComponents.map((component) => (
                  <div key={component.label}>
                    <p>
                      <span>{component.label}</span>
                      <strong>
                        {component.earned.toFixed(1)} / {component.maximum}
                      </strong>
                    </p>
                    <div
                      className="profitability-progress"
                      role="progressbar"
                      aria-label={`${component.label} score`}
                      aria-valuemin={0}
                      aria-valuemax={component.maximum}
                      aria-valuenow={Number(component.earned.toFixed(1))}
                    >
                      <i
                        style={{
                          width: `${Math.min(
                            100,
                            (component.earned / component.maximum) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <Unavailable>
                  At least three profitability inputs are needed to calculate a
                  score.
                </Unavailable>
              )}
            </div>
            <details className="profitability-inline-details">
              <summary>How the score works</summary>
              <ul>
                {analysis.scoreComponents.map((component) => (
                  <li key={component.label}>
                    <strong>{component.label}:</strong>{" "}
                    {component.explanation}
                  </li>
                ))}
                <li>
                  Missing inputs are excluded and the available weights are
                  rescaled to 100.
                </li>
              </ul>
            </details>
          </section>

          <section
            className="profitability-card profitability-diligence-card"
            aria-labelledby="diligence-heading"
          >
            <SectionHeading
              icon={<ShieldCheck aria-hidden="true" />}
              eyebrow="Diligence checks"
              title="What deserves attention"
              id="diligence-heading"
            />
            <div className="profitability-check-list">
              {analysis.diligence.map((item) => (
                <DiligenceRow key={item.label} item={item} />
              ))}
            </div>
          </section>
        </div>

        <section
          className="profitability-card profitability-section-card"
          aria-labelledby="margins-heading"
        >
          <SectionHeading
            icon={<Gauge aria-hidden="true" />}
            eyebrow="Margins"
            title="How much revenue becomes owner earnings?"
            description="Latest reported totals, paired with annual history when comparable periods are available."
            id="margins-heading"
          />
          <div className="profitability-metric-grid">
            <MetricTile
              label="Gross margin"
              value={percent(analysis.grossMargin)}
              detail="Gross profit ÷ revenue"
              tone={analysis.marginTones.gross}
            />
            <MetricTile
              label="Operating margin"
              value={percent(analysis.operatingMargin)}
              detail="Operating profit ÷ revenue"
              tone={analysis.marginTones.operating}
            />
            <MetricTile
              label="Net margin"
              value={percent(analysis.netMargin)}
              detail="Net income ÷ revenue"
              tone={analysis.marginTones.net}
            />
            <MetricTile
              label="Free cash flow margin"
              value={percent(analysis.freeCashFlowMargin)}
              detail="Free cash flow ÷ revenue"
              tone={analysis.marginTones.freeCashFlow}
            />
            <MetricTile
              label="EBITDA margin"
              value={percent(analysis.ebitdaMargin)}
              detail="EBITDA ÷ revenue"
            />
            <MetricTile
              label="Asset turnover"
              value={multiple(analysis.assetTurnover)}
              detail="Revenue generated per asset dollar"
            />
          </div>
          <div className="profitability-margin-context">
            <div>
              <span>Latest vs. preceding margin average</span>
              <strong>{signedPercent(analysis.marginTrend)}</strong>
            </div>
            <p>
              A rising margin can reflect pricing power or temporary cost
              timing. A falling margin can reflect reinvestment or erosion.
              Read the direction as a diligence prompt, not a conclusion.
            </p>
          </div>
          <div className="profitability-growth-strip">
            <div>
              <span>Revenue CAGR</span>
              <strong>{percent(analysis.revenueGrowth)}</strong>
            </div>
            <div>
              <span>Net income CAGR</span>
              <strong>{percent(analysis.netIncomeGrowth)}</strong>
            </div>
            <p>Positive annual endpoints only.</p>
          </div>
          <div className="profitability-chart-panel">
            <div className="profitability-chart-heading">
              <div>
                <h3>Profitability history</h3>
                <p>Revenue, net income, and net margin by annual period.</p>
              </div>
              <LineChart aria-hidden="true" size={20} />
            </div>
            <ProfitabilityTrendChart
              points={analysis.trend}
              currency={currency}
            />
          </div>
          {analysis.trend.length ? (
            <details className="profitability-table-disclosure">
              <summary>View historical figures</summary>
              <div className="profitability-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Period</th>
                      <th scope="col">Revenue</th>
                      <th scope="col">Net income</th>
                      <th scope="col">Net margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.trend.map((point) => (
                      <tr key={point.period}>
                        <th scope="row">{point.period}</th>
                        <td>
                          {money(
                            point.revenue,
                            currency,
                            true,
                          )}
                        </td>
                        <td>
                          {money(
                            point.netIncome,
                            currency,
                            true,
                          )}
                        </td>
                        <td>{percent(point.netMargin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </section>

        <section
          className="profitability-card profitability-section-card"
          aria-labelledby="bridge-heading"
        >
          <SectionHeading
            icon={<Landmark aria-hidden="true" />}
            eyebrow="Earnings bridge"
            title="From revenue to cash"
            description={`${analysis.currentPeriod}. Intermediate deductions are calculated from displayed totals.`}
            id="bridge-heading"
          />
          <EarningsBridge
            analysis={analysis}
            currency={currency}
          />
        </section>

        <section
          className="profitability-card profitability-section-card"
          aria-labelledby="peer-margin-heading"
        >
          <SectionHeading
            icon={<Scale aria-hidden="true" />}
            eyebrow="Peer economics"
            title="Margin and return comparison"
            description="A screening comparison using positive market multiples."
            id="peer-margin-heading"
          />
          {peerEconomics.length ? (
            <>
              <div className="profitability-peer-summary">
                <div>
                  <span>Peer median net margin</span>
                  <strong>{percent(peerMarginMedian)}</strong>
                </div>
                <div>
                  <span>Peer median return on equity</span>
                  <strong>{percent(peerRoeMedian)}</strong>
                </div>
                <p>{quality.peerComparison.narrative}</p>
              </div>
              <div className="profitability-table-wrap">
                <table aria-describedby="peer-method-note">
                  <thead>
                    <tr>
                      <th scope="col">Company</th>
                      <th scope="col">Net margin</th>
                      <th scope="col">Return on equity</th>
                      <th scope="col">Basis</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="is-current-company">
                      <th scope="row">
                        <strong>{canonicalSymbol}</strong>
                        <span>{companyName}</span>
                      </th>
                      <td>{percent(analysis.netMargin)}</td>
                      <td>{percent(analysis.returnOnEquity)}</td>
                      <td>Reported totals</td>
                    </tr>
                    {peerEconomics.slice(0, 6).map((peer) => (
                      <tr key={peer.symbol}>
                        <th scope="row">
                          <strong>{peer.symbol}</strong>
                          <span>{peer.company}</span>
                        </th>
                        <td>{percent(peer.netMargin)}</td>
                        <td>{percent(peer.returnOnEquity)}</td>
                        <td>Multiple-implied</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p
                className="profitability-method-note"
                id="peer-method-note"
              >
                Multiple-implied net margin equals P/S ÷ P/E; implied return on
                equity equals P/B ÷ P/E. Only positive multiples are used.
                Capital structures and accounting differences can distort the
                comparison.
              </p>
            </>
          ) : (
            <Unavailable>
              Comparable multiples were not returned, so peer economics remain
              blank.
            </Unavailable>
          )}
        </section>

        <section
          className="profitability-card profitability-section-card"
          aria-labelledby="returns-heading"
        >
          <SectionHeading
            icon={<TrendingUp aria-hidden="true" />}
            eyebrow="Returns on capital"
            title="Does the business earn more from each dollar employed?"
            description="Accounting returns require the right denominator. Missing balance-sheet inputs are never replaced with market value."
            id="returns-heading"
          />
          <div className="profitability-return-grid">
            <ReturnCard
              title="Return on equity"
              value={percent(analysis.returnOnEquity)}
              formula="Net income ÷ shareholders’ equity"
              interpretation={analysis.returnInterpretations.equity}
              icon={<TrendingUp aria-hidden="true" />}
            />
            <ReturnCard
              title="Return on invested capital"
              value={percent(analysis.returnOnInvestedCapital)}
              formula="NOPAT ÷ invested capital"
              interpretation={analysis.returnInterpretations.investedCapital}
              icon={<Landmark aria-hidden="true" />}
              unavailable={analysis.returnOnInvestedCapital === null}
            />
            <ReturnCard
              title="Return on assets"
              value={percent(analysis.returnOnAssets)}
              formula="Net income ÷ average total assets"
              interpretation={analysis.returnInterpretations.assets}
              icon={<Scale aria-hidden="true" />}
              unavailable={analysis.returnOnAssets === null}
            />
            <ReturnCard
              title="Cash return on enterprise value"
              value={percent(analysis.cashReturnOnEnterpriseValue)}
              formula="Free cash flow ÷ enterprise value"
              interpretation={
                analysis.returnInterpretations.cashEnterpriseValue
              }
              icon={<CircleDollarSign aria-hidden="true" />}
            />
          </div>
        </section>

        <section
          className="profitability-card profitability-section-card"
          aria-labelledby="cash-conversion-heading"
        >
          <SectionHeading
            icon={<WalletCards aria-hidden="true" />}
            eyebrow="Free cash flow"
            title="Do accounting earnings become spendable cash?"
            description="Current cash conversion and valuation yields based on the latest returned totals."
            id="cash-conversion-heading"
          />
          <div className="profitability-cash-grid">
            <div className="profitability-conversion-card">
              <div className="profitability-conversion-value">
                <span>Cash conversion</span>
                <strong>{percent(analysis.cashConversion)}</strong>
              </div>
              <div
                className="profitability-conversion-track"
                role="meter"
                aria-label="Free cash flow as a percentage of net income"
                aria-valuemin={0}
                aria-valuemax={150}
                aria-valuenow={
                  analysis.cashConversion === null
                    ? undefined
                    : Math.round(analysis.cashConversion * 100)
                }
              >
                <i
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(0, (analysis.cashConversion ?? 0) / 1.5) * 100,
                    )}%`,
                  }}
                />
                <b style={{ left: `${(1 / 1.5) * 100}%` }} />
              </div>
              <div className="profitability-conversion-scale">
                <span>0%</span>
                <span>100% earnings coverage</span>
                <span>150%+</span>
              </div>
              <p>
                One period above 100% can be healthy or temporary. Inspect
                working capital, stock compensation, and maintenance capital
                spending before normalizing it.
              </p>
            </div>
            <div className="profitability-cash-metrics">
              <MetricLine
                label="Free cash flow"
                value={money(
                  analysis.freeCashFlow,
                  currency,
                  true,
                )}
              />
              <MetricLine
                label="Free cash flow margin"
                value={percent(analysis.freeCashFlowMargin)}
              />
              <MetricLine
                label="Free cash flow yield"
                value={percent(analysis.freeCashFlowYield)}
              />
              <MetricLine
                label="Earnings yield"
                value={percent(analysis.earningsYield)}
              />
              <MetricLine
                label="Net debt / free cash flow"
                value={multiple(analysis.netDebtToFreeCashFlow)}
              />
            </div>
          </div>
        </section>

        <section
          className="profitability-card profitability-section-card"
          aria-labelledby="opportunity-heading"
        >
          <SectionHeading
            icon={<CircleDollarSign aria-hidden="true" />}
            eyebrow="Value investor lens"
            title="Where quality may meet opportunity"
            description="Signals to investigate, not recommendations."
            id="opportunity-heading"
          />
          <div className="profitability-opportunity-grid">
            {analysis.opportunities.map((signal) => (
              <OpportunityCard key={signal.title} signal={signal} />
            ))}
          </div>
          <div className="profitability-research-questions">
            <h3>Questions that can change the thesis</h3>
            <ul>
              <li>
                Is the latest margin representative, or did mix, taxes, or a
                one-off cost distort it?
              </li>
              <li>
                How much incremental capital can be reinvested at attractive
                returns before growth slows?
              </li>
              <li>
                What explains the gap between net income and free cash flow?
              </li>
              <li>
                Does leverage inflate return on equity or reduce downside
                resilience?
              </li>
            </ul>
          </div>
        </section>

        <section
          className="profitability-card profitability-section-card profitability-faq"
          aria-labelledby="quality-faq-heading"
        >
          <SectionHeading
            icon={<HelpCircle aria-hidden="true" />}
            eyebrow="Value-investing guide"
            title="How quality changes the opportunity"
            id="quality-faq-heading"
          />
          <div className="profitability-faq-list">
            <Faq
              question="Why does business quality matter to a value investor?"
              answer="Intrinsic value depends on the cash a business can distribute or reinvest over time. Durable margins, sensible leverage, strong cash conversion and disciplined capital allocation make those owner earnings more resilient and reduce the chance that an apparently cheap stock is deteriorating underneath the multiple."
            />
            <Faq
              question="When is high return on invested capital durable?"
              answer="High returns are more durable when they come from pricing power, switching costs, efficient scale or other repeatable advantages, and when the company can reinvest meaningful incremental capital without returns collapsing. A defensible calculation also needs operating profit after tax and invested capital; if those inputs are unavailable, the page leaves the figure blank."
            />
            <Faq
              question="Can strong margins hide a value trap?"
              answer="Yes. Peak-cycle pricing, underinvestment, working-capital releases, customer concentration or accounting choices can make current margins look stronger than normalized owner earnings. Compare several periods, reconcile net income to free cash flow, and identify what must be spent merely to maintain the franchise."
            />
            <Faq
              question="How should I connect business quality to price?"
              answer="Use quality to judge the reliability and duration of normalized owner earnings, not to excuse any valuation. Apply conservative cash-flow and market-comparison ranges, then require a margin of safety proportionate to business risk, balance-sheet risk and forecasting uncertainty."
            />
            <Faq
              question="What can disqualify the opportunity?"
              answer="Walk away or demand a much lower price when returns depend on leverage or temporary conditions, cash conversion repeatedly trails earnings, maintenance investment is understated, management destroys capital, the balance sheet cannot absorb a downturn, or only optimistic assumptions create upside."
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function SectionHeading({
  icon,
  eyebrow,
  title,
  description,
  id,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  description?: string;
  id: string;
}) {
  return (
    <div className="profitability-section-heading">
      <div className="profitability-section-icon">{icon}</div>
      <div>
        <p>{eyebrow}</p>
        <h2 id={id}>{title}</h2>
        {description ? <span>{description}</span> : null}
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  return (
    <div className={`profitability-metric-tile is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </div>
  );
}

function DiligenceRow({ item }: { item: DiligenceCheck }) {
  return (
    <div className={`profitability-check is-${item.tone}`}>
      <div aria-hidden="true">
        {item.tone === "positive" ? (
          <Check size={15} />
        ) : item.tone === "watch" ? (
          <AlertTriangle size={15} />
        ) : (
          <MinusCircle size={15} />
        )}
      </div>
      <p>
        <strong>{item.label}</strong>
        <span>{item.detail}</span>
      </p>
    </div>
  );
}

function ReturnCard({
  title,
  value,
  formula,
  interpretation,
  icon,
  unavailable = false,
}: {
  title: string;
  value: string;
  formula: string;
  interpretation: string;
  icon: ReactNode;
  unavailable?: boolean;
}) {
  return (
    <article
      className={`profitability-return-card${unavailable ? " is-unavailable" : ""}`}
    >
      <div className="profitability-return-top">
        <span>{icon}</span>
        {unavailable ? <em>Input needed</em> : null}
      </div>
      <h3>{title}</h3>
      <strong>{value}</strong>
      <p className="profitability-formula">{formula}</p>
      <p>{interpretation}</p>
    </article>
  );
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OpportunityCard({ signal }: { signal: OpportunitySignal }) {
  return (
    <article className={`profitability-opportunity is-${signal.tone}`}>
      <div aria-hidden="true">
        {signal.tone === "positive" ? (
          <CheckCircle2 />
        ) : signal.tone === "watch" ? (
          <AlertTriangle />
        ) : (
          <Info />
        )}
      </div>
      <h3>{signal.title}</h3>
      <p>{signal.detail}</p>
    </article>
  );
}

function Faq({ question, answer }: { question: string; answer: string }) {
  return (
    <details>
      <summary>
        <span>{question}</span>
        <ChevronRight aria-hidden="true" size={18} />
      </summary>
      <p>{answer}</p>
    </details>
  );
}

function Unavailable({ children }: { children: ReactNode }) {
  return (
    <div className="profitability-unavailable">
      <Info aria-hidden="true" size={17} />
      <span>{children}</span>
    </div>
  );
}

function BusinessQualitySkeleton({
  symbol,
  action,
}: {
  symbol: string;
  action: ReactNode;
}) {
  return (
    <div className="profitability-page">
      <div className="profitability-container profitability-skeleton">
        <p className="visually-hidden">Loading {symbol} business quality</p>
        <ResearchPanelHeader {...qualityPanelHeader} action={action} />
        <div className="profitability-skeleton-grid">
          <div />
          <div />
        </div>
        <div className="profitability-skeleton-block" />
      </div>
    </div>
  );
}
