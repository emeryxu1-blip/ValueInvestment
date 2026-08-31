"use client";

import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Calculator,
  ChevronRight,
  CircleDollarSign,
  RefreshCw,
  Scale,
  Target,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  AnalysisPeer,
  SecurityAnalysisResponse,
} from "@/lib/contracts";
import {
  analysisMetricNumber as metricNumber,
  positiveNumber as positive,
  type RelativeMeasure,
} from "@/lib/security/valuation";
import ResearchPanelHeader from "./ResearchPanelHeader";
import CalculationDisclosure from "./CalculationDisclosure";

type AnalysisMode = "cash-flow-value" | "relative-value";

type Props = {
  exchange: string;
  symbol: string;
  mode: AnalysisMode;
};

type DcfAnalysis = Extract<
  NonNullable<SecurityAnalysisResponse["valuation"]>,
  { kind: "dcf" }
>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const money = (
  value: number | null,
  currency: string | null,
  compact = false,
) => {
  if (value === null || !Number.isFinite(value) || !currency) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 2 : 2,
    }).format(value);
  } catch {
    return "—";
  }
};

const percent = (value: number | null, digits = 1) =>
  value === null || !Number.isFinite(value)
    ? "—"
    : `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;

const multiple = (value: number | null) =>
  value === null || !Number.isFinite(value)
    ? "—"
    : `${value.toFixed(1)}×`;

const peerMetric = (peer: AnalysisPeer, key: string) =>
  metricNumber(peer.metrics, key);

const compactNumber = (value: number | null, currency: string | null) =>
  money(value, currency, true);

const asOfDate = (value: string | null | undefined) =>
  value ? value.slice(0, 10) : "Not supplied";

const responseJson = async (response: Response) => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : "The latest analysis is temporarily unavailable.";
    throw new Error(message);
  }
  return payload as SecurityAnalysisResponse;
};

export default function ValueAnalysisClient({
  exchange,
  symbol,
  mode,
}: Props) {
  const canonicalSymbol = symbol.toUpperCase();
  const [data, setData] = useState<SecurityAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const view =
    mode === "cash-flow-value" ? "dcf-valuation" : "relative-valuation";
  const analysisPath = `/api/security/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}/analysis?view=${view}`;

  const load = useCallback(
    async (background = false) => {
      const requestId = ++requestIdRef.current;
      if (background) setRefreshing(true);
      else setLoading(true);
      try {
        const next = await fetch(analysisPath, { cache: "no-store" }).then(
          responseJson,
        );
        if (requestId !== requestIdRef.current) return;
        setData(next);
        setError(null);
      } catch (reason) {
        if (requestId !== requestIdRef.current) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "The latest analysis is temporarily unavailable.",
        );
      } finally {
        if (requestId !== requestIdRef.current) return;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [analysisPath],
  );

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(true), 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [load]);

  const dcfValuation = data?.valuation?.kind === "dcf" ? data.valuation : null;
  const relativeValuation =
    data?.valuation?.kind === "relative" ? data.valuation : null;
  const relativeMeasures = relativeValuation?.measures ?? [];
  const price =
    data?.valuation?.price ??
    (data ? positive(metricNumber(data.metrics, "price")) : null);
  const baseValue = data?.valuation?.baseValue ?? null;
  const gap = data?.valuation?.gap ?? null;
  const opportunity = data?.valuation?.opportunity ?? "Valuation unavailable";
  const isCashFlowView = mode === "cash-flow-value";
  const panelHeader = isCashFlowView
    ? {
        view: "cash-flow" as const,
        eyebrow: "Cash-flow safety",
        title: "Cash-flow value check",
        description:
          "Review the DCF reference against reported and forecast free cash flow, then compare the resulting value with today's price.",
      }
    : {
        view: "market-expectations" as const,
        eyebrow: "Market expectations",
        title: "Market expectation check",
        description:
          "Compare the expectations embedded in today's price with similar businesses, then test whether any discount reflects weaker economics.",
      };
  const panelRefreshAction = (
    <button
      className="security-research-panel-header__action"
      type="button"
      onClick={() => void load(true)}
      aria-label="Refresh analysis"
      disabled={loading || refreshing}
    >
      <RefreshCw
        aria-hidden="true"
        className={refreshing ? "is-spinning" : ""}
        size={16}
      />
      Refresh analysis
    </button>
  );

  if (loading && data === null) {
    return (
      <div className="analysis-page">
        <div className="analysis-shell">
          <ResearchPanelHeader
            {...panelHeader}
            action={panelRefreshAction}
          />
          <div
            className="security-research-panel-loading"
            aria-busy="true"
          >
            <span aria-hidden="true" />
            <p>
              Preparing{" "}
              {isCashFlowView
                ? "cash-flow value evidence"
                : "market expectation check"}{" "}
              for {canonicalSymbol}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="analysis-page">
        <div className="analysis-shell">
          <ResearchPanelHeader
            {...panelHeader}
            action={panelRefreshAction}
          />
          <section className="analysis-section" role="status">
            <EmptyAnalysis
              message={
                error ??
                "The canonical valuation response is unavailable. No substitute values have been inserted."
              }
            />
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="analysis-page">
      <div className="analysis-shell">
        {error ? (
          <div className="analysis-notice" role="status">
            <span>{error} Missing figures remain blank.</span>
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : null}

        <ResearchPanelHeader
          {...panelHeader}
          action={panelRefreshAction}
        />

        <section className="analysis-value-card" aria-labelledby="value-result">
          <div>
            <p className="analysis-label">Value-investor reading</p>
            <h2 id="value-result">{opportunity}</h2>
            <p>
              Estimated value{" "}
              <strong>
                {money(baseValue, data?.identity.currency || null)}
              </strong>{" "}
              compared with a market price of{" "}
              <strong>{money(price, data?.identity.currency || null)}</strong>.
            </p>
          </div>
          <div className={`analysis-gap${gap === null ? "" : gap >= 0 ? " is-positive" : " is-negative"}`}>
            {gap !== null && gap >= 0 ? (
              <ArrowUpRight aria-hidden="true" />
            ) : gap !== null ? (
              <ArrowDownRight aria-hidden="true" />
            ) : null}
            <strong>{percent(gap)}</strong>
            <span>value gap</span>
          </div>
        </section>

        {isCashFlowView ? (
          <CalculationDisclosure
            title="How the headline is built"
            summary="Implied value gap = Intrinsic value per share ÷ positive analysis price − 1"
            badges={[
              dcfValuation?.providerValuePeriod
                ? `Selected ${dcfValuation.providerValuePeriod}`
                : "No positive DCF value",
              dcfValuation?.priceAsOf
                ? `Price ${asOfDate(dcfValuation.priceAsOf)}`
                : null,
              dcfValuation ? `Policy v${dcfValuation.modelVersion}` : null,
            ]}
            formulas={[
              {
                label: "DCF value",
                expression:
                  "latest positive dated DCF reference selected by the server",
              },
              {
                label: "Value gap",
                expression: "Intrinsic value per share / positive analysis price - 1",
              },
              {
                label: "Reading",
                expression:
                  "≥20% wide; 0–<20% positive; −10–<0% near indicated value; <−10% price above indicated value",
              },
            ]}
            items={[
              {
                label: "Calculation",
                value:
                  "The server selects and returns the latest positive dated DCF reference; its underlying forecast and assumptions are not reproduced here.",
              },
              {
                label: "Price snapshot",
                value: `The denominator is the analysis response price as of ${asOfDate(dcfValuation?.priceAsOf)}, which can briefly differ from the independently refreshed header quote.`,
              },
              {
                label: "Interpretation",
                value:
                  "The displayed percentage is implied upside/downside relative to price, not the conventional price discount divided by fair value.",
              },
            ]}
          />
        ) : (
          <CalculationDisclosure
            title="How the headline is built"
            summary="Relative value = median of valid P/E, P/S and P/B implied values"
            badges={[
              relativeValuation
                ? `${relativeMeasures.filter((measure) => measure.impliedValue !== null).length} of 3 methods`
                : null,
              relativeValuation?.peerAsOf
                ? `Peers ${asOfDate(relativeValuation.peerAsOf)}`
                : null,
              relativeValuation
                ? `Policy v${relativeValuation.modelVersion}`
                : null,
            ]}
            formulas={[
              {
                label: "Per-share base",
                expression: "analysis price / positive company multiple",
              },
              {
                label: "Method value",
                expression: "positive peer median × per-share base",
              },
              {
                label: "Relative value",
                expression: "median of available positive method values",
              },
              {
                label: "Value gap",
                expression: "relative value / positive analysis price - 1",
              },
            ]}
            items={[
              {
                label: "Periods",
                value:
                  "P/E and P/S use trailing-twelve-month multiples; P/B uses the latest reported-quarter multiple.",
              },
              {
                label: "Minimum evidence",
                value:
                  "Each method needs at least three positive peer multiples. The final value can still be produced from one valid method, so the contributing method count is shown above.",
              },
            ]}
          />
        )}

        {mode === "cash-flow-value" ? (
          <CashFlowSections data={data} valuation={dcfValuation} />
        ) : (
          <RelativeSections data={data} measures={relativeMeasures} />
        )}

        <section className="analysis-next">
          <div>
            <p className="analysis-label">Next diligence step</p>
            <h2>Turn the value gap into a testable thesis.</h2>
            <p>
              Check the business quality, balance-sheet resilience and the
              assumptions most likely to break before acting on the headline
              discount.
            </p>
          </div>
          <Link
            href={`/value-opportunities/${exchange.toLowerCase()}/${symbol.toLowerCase()}/business-quality`}
          >
            Review business quality
            <ChevronRight aria-hidden="true" size={16} />
          </Link>
        </section>
      </div>
    </div>
  );
}

function CashFlowSections({
  data,
  valuation,
}: {
  data: SecurityAnalysisResponse | null;
  valuation: DcfAnalysis | null;
}) {
  const currency = data?.identity.currency || null;
  const metrics = data?.metrics;
  const cashFlow = valuation?.cashFlow;
  const reported = cashFlow?.reported ?? [];
  const forecast = cashFlow?.forecast ?? [];
  const chartData = [
    ...reported.slice(-8).map((point) => ({
      period: point.period,
      reported: point.value,
      forecast: null,
    })),
    ...forecast.slice(0, 8).map((point) => ({
      period: point.period,
      reported: null,
      forecast: point.value,
    })),
  ];

  return (
    <>
      <section className="analysis-section" aria-labelledby="cash-flow-model">
        <div className="analysis-section-heading">
          <div className="analysis-icon">
            <BarChart3 aria-hidden="true" />
          </div>
          <div>
            <p className="analysis-label">Cash-flow evidence</p>
            <h2 id="cash-flow-model">Reported and forecast free cash flow</h2>
            <p>
              Reported periods and forward estimates come from a separate
              reported and forecast series. The totals below use the returned ordering;
              unavailable figures remain blank.
            </p>
          </div>
        </div>
        <div className="analysis-bridge">
          <BridgeRow
            label="Latest returned reported period"
            value={cashFlow?.latestReported ?? null}
            currency={currency}
          />
          <BridgeRow
            label="Sum of latest four returned periods"
            value={cashFlow?.trailingFourQuarter ?? null}
            currency={currency}
            emphasized
          />
          <BridgeRow
            label="Earliest returned forecast period"
            value={cashFlow?.nextForecast ?? null}
            currency={currency}
          />
          <BridgeRow
            label="Sum of earliest four forecast periods"
            value={cashFlow?.forwardFourQuarter ?? null}
            currency={currency}
            emphasized
          />
          <div className="analysis-bridge-row">
            <span>Forward-four versus trailing-four growth</span>
            <strong>{percent(cashFlow?.forwardGrowth ?? null)}</strong>
          </div>
        </div>
        <div className="analysis-chart-card">
          <div className="analysis-chart-summary">
            <span>Free cash flow by returned period</span>
            <strong>Reported and forecast</strong>
          </div>
          {chartData.length ? (
            <div className="analysis-chart" aria-label="Reported and forecast free cash flow">
              <ResponsiveContainer width="100%" height={290}>
                <BarChart
                  data={chartData}
                  margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="rgba(0,0,0,.07)"
                  />
                  <XAxis
                    dataKey="period"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#6e6e73", fontSize: 11 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    width={58}
                    tick={{ fill: "#6e6e73", fontSize: 11 }}
                    tickFormatter={(value) =>
                      new Intl.NumberFormat("en-US", {
                        notation: "compact",
                        maximumFractionDigits: 1,
                      }).format(Number(value))
                    }
                  />
                  <Tooltip
                    formatter={(value) =>
                      compactNumber(Number(value), currency)
                    }
                    contentStyle={{
                      border: "1px solid rgba(0,0,0,.08)",
                      borderRadius: 12,
                      boxShadow: "0 10px 30px rgba(0,0,0,.08)",
                    }}
                  />
                  <Bar
                    dataKey="reported"
                    name="Reported free cash flow"
                    fill="#0071e3"
                    radius={[6, 6, 0, 0]}
                  />
                  <Bar
                    dataKey="forecast"
                    name="Forecast free cash flow"
                    fill="#9cc9f6"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyAnalysis message="No reported or forecast free-cash-flow periods are available for this security." />
          )}
        </div>
        <CalculationDisclosure
          title="How period totals are calculated"
          summary="Latest 4 reported sum · earliest 4 forecast sum · forward growth = forward 4 ÷ trailing 4 − 1"
          badges={[
            valuation?.cashFlowAsOf
              ? `FCF series ${asOfDate(valuation.cashFlowAsOf)}`
              : null,
          ]}
          formulas={[
            {
              label: "Trailing four",
              expression: "sum of the four latest returned reported points",
            },
            {
              label: "Forward four",
              expression: "sum of the four earliest returned forecast points",
            },
            {
              label: "Forward growth",
              expression:
                "forward-four sum / trailing-four sum - 1; only when both sets have four points and trailing sum > 0",
            },
            {
              label: "Chart window",
              expression:
                "latest 8 reported points + earliest 8 forecast points",
            },
          ]}
          items={[
            {
              label: "Ordering guard",
              value:
                "The app sorts by returned period but does not currently prove quarter continuity or that every forecast date is in the future; labels therefore say returned periods.",
            },
            {
              label: "Supporting cash-flow evidence",
              value:
                "This FCF series supports diligence; it does not reconstruct the separately returned DCF reference.",
            },
          ]}
        />
      </section>

      <section className="analysis-section" aria-labelledby="calculation-bridge">
        <div className="analysis-section-heading">
          <div className="analysis-icon">
            <Calculator aria-hidden="true" />
          </div>
          <div>
            <p className="analysis-label">DCF value</p>
            <h2 id="calculation-bridge">DCF value versus the market</h2>
            <p>
              The server returns the selected DCF reference and compares it with
              the current price. Cash, debt, and shares are shown as context for
              diligence; they do not reconstruct the DCF reference in the browser.
            </p>
          </div>
        </div>
        {valuation?.providerValue !== null && valuation ? (
          <div className="analysis-bridge">
            <BridgeRow
              label="DCF value per share"
              value={valuation.providerValue}
              currency={currency}
              result
            />
            <BridgeRow
              label="Current market price"
              value={valuation.price}
              currency={currency}
              emphasized
            />
            <BridgeRow
              label="Cash and short-term investments"
              value={metricNumber(metrics, "cash")}
              currency={currency}
            />
            <BridgeRow
              label="Debt"
              value={metricNumber(metrics, "debt")}
              currency={currency}
            />
            <BridgeRow
              label="Reported shares outstanding"
              value={metricNumber(metrics, "sharesOutstanding")}
              currency={currency}
              shares
            />
            <div className="analysis-bridge-row is-result">
              <span>Implied DCF value gap</span>
              <strong>{percent(valuation.gap)}</strong>
            </div>
          </div>
        ) : (
          <EmptyAnalysis message="The DCF reference is unavailable for this security." />
        )}
        <CalculationDisclosure
          title="DCF reference and value-gap calculation"
          summary="DCF value per share ÷ analysis price − 1"
          badges={[
            valuation?.providerValuePeriod
              ? `Selected ${valuation.providerValuePeriod}`
              : null,
            valuation?.providerValueAsOf
              ? `Reference ${asOfDate(valuation.providerValueAsOf)}`
              : null,
          ]}
          items={[
            {
              label: "Selected period",
              value:
                valuation?.providerValuePeriod ??
                "The returned DCF reference has no dated model period.",
            },
            {
              label: "Context-only rows",
              value:
                "Cash, debt, and shares are shown for context and are not inputs to a browser-side DCF calculation.",
            },
            {
              label: "Reproducibility",
              value:
                "The app selects and displays the returned DCF reference; its underlying forecasts and assumptions are not reproduced here.",
            },
          ]}
        />
      </section>

      <section className="analysis-section" aria-labelledby="value-periods-heading">
        <div className="analysis-section-heading">
          <div className="analysis-icon">
            <Target aria-hidden="true" />
          </div>
          <div>
            <p className="analysis-label">DCF reference</p>
            <h2 id="value-periods-heading">Dated DCF values</h2>
            <p>
              The valuation dataset can include dated per-share periods. They are
              displayed without modification,
              without synthetic downside or upside cases.
            </p>
          </div>
        </div>
        {valuation?.providerValuePeriods.length ? (
          <div className="analysis-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>DCF value per share</th>
                </tr>
              </thead>
              <tbody>
                {valuation.providerValuePeriods.map((point) => (
                  <tr key={point.period}>
                    <td>
                      {point.period}
                      {point.period === valuation.providerValuePeriod ? (
                        <strong className="analysis-selected-period">
                          Selected
                        </strong>
                      ) : null}
                    </td>
                    <td>{money(point.value, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyAnalysis message="The DCF reference is unavailable for this security." />
        )}
      </section>

      <details className="analysis-disclosure">
        <summary>
          <span>
            <BarChart3 aria-hidden="true" />
            View the cash-flow periods
          </span>
          <ChevronRight aria-hidden="true" />
        </summary>
        {reported.length || forecast.length ? (
          <div className="analysis-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Status</th>
                  <th>Free cash flow</th>
                </tr>
              </thead>
              <tbody>
                {reported.map((point) => (
                  <tr key={`reported:${point.period}`}>
                    <td>{point.period}</td>
                    <td>Reported</td>
                    <td>{compactNumber(point.value, currency)}</td>
                  </tr>
                ))}
                {forecast.map((point) => (
                  <tr key={`forecast:${point.period}`}>
                    <td>{point.period}</td>
                    <td>Forecast</td>
                    <td>{compactNumber(point.value, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyAnalysis message="No reported or forecast cash-flow periods are available." />
        )}
      </details>

    </>
  );
}

function RelativeSections({
  data,
  measures,
}: {
  data: SecurityAnalysisResponse | null;
  measures: RelativeMeasure[];
}) {
  const currency = data?.identity.currency || null;
  const valuation = data?.valuation?.kind === "relative" ? data.valuation : null;
  const chartData = measures.map((measure) => ({
    metric: measure.id.toUpperCase(),
    company: measure.companyMultiple,
    median: measure.peerMedian,
  }));
  return (
    <>
      <section className="analysis-section" aria-labelledby="multiples-heading">
        <div className="analysis-section-heading">
          <div className="analysis-icon">
            <Scale aria-hidden="true" />
          </div>
          <div>
            <p className="analysis-label">Valuation multiples</p>
            <h2 id="multiples-heading">Where the market disagrees</h2>
            <p>
              Each card compares this company&apos;s current multiple with the
              peer median and shows the backend-calculated implied value. The
              final estimate is the median of complete, positive implied values.
            </p>
          </div>
        </div>
        {chartData.some(
          (item) => item.company !== null || item.median !== null,
        ) ? (
          <div
            className="analysis-chart-card analysis-relative-chart"
            aria-label="Company multiples compared with peer medians"
          >
            <ResponsiveContainer width="100%" height={270}>
              <BarChart
                data={chartData}
                margin={{ top: 10, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid vertical={false} stroke="rgba(0,0,0,.07)" />
                <XAxis
                  dataKey="metric"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#6e6e73", fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={42}
                  tick={{ fill: "#6e6e73", fontSize: 11 }}
                />
                <Tooltip
                  formatter={(value) => multiple(Number(value))}
                  contentStyle={{
                    border: "1px solid rgba(0,0,0,.08)",
                    borderRadius: 12,
                    boxShadow: "0 10px 30px rgba(0,0,0,.08)",
                  }}
                />
                <Bar
                  dataKey="company"
                  name="Company"
                  fill="#0071e3"
                  radius={[6, 6, 0, 0]}
                />
                <Bar
                  dataKey="median"
                  name="Peer median"
                  fill="#9cc9f6"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : null}
        <div className="analysis-multiple-grid">
          {measures.map((measure) => {
            return (
              <article key={measure.id}>
                <div className="analysis-multiple-top">
                  <span>{measure.label}</span>
                  <strong>{multiple(measure.companyMultiple)}</strong>
                </div>
                <dl>
                  <div>
                    <dt>Peer median</dt>
                    <dd>{multiple(measure.peerMedian)}</dd>
                  </div>
                  <div>
                    <dt>Usable peers</dt>
                    <dd>{measure.peerSampleSize}</dd>
                  </div>
                  <div>
                    <dt>Premium / discount</dt>
                    <dd
                      className={
                        measure.premiumDiscount !== null &&
                        measure.premiumDiscount <= 0
                          ? "is-positive"
                          : "is-negative"
                      }
                    >
                      {percent(measure.premiumDiscount)}
                    </dd>
                  </div>
                  <div>
                    <dt>Implied value</dt>
                    <dd>{money(measure.impliedValue, currency)}</dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
        <CalculationDisclosure
          title="Multiple-to-value calculation"
          summary="Peer median × (analysis price ÷ company multiple)"
          badges={[
            `${measures.filter((measure) => measure.impliedValue !== null).length} of 3 methods used`,
            valuation?.priceAsOf
              ? `Price ${asOfDate(valuation.priceAsOf)}`
              : null,
          ]}
          formulas={[
            {
              label: "P/E value",
              expression: "peer median P/E × (price / company P/E)",
            },
            {
              label: "P/S value",
              expression: "peer median P/S × (price / company P/S)",
            },
            {
              label: "P/B value",
              expression: "peer median P/B × (price / company P/B)",
            },
            {
              label: "Premium / discount",
              expression: "company multiple / peer median - 1",
            },
            {
              label: "Final value",
              expression: "median of positive available implied values",
            },
          ]}
          items={[
            {
              label: "Guards",
              value:
                "Price and the company multiple must be positive. Each peer median requires at least three positive finite observations. Missing methods are excluded rather than treated as zero.",
            },
            {
              label: "Even-count median",
              value:
                "For an even number of values, the median is the average of the two middle sorted observations.",
            },
          ]}
        />
      </section>

      <section className="analysis-section" aria-labelledby="peer-heading">
        <div className="analysis-section-heading">
          <div className="analysis-icon">
            <Target aria-hidden="true" />
          </div>
          <div>
            <p className="analysis-label">Comparable companies</p>
            <h2 id="peer-heading">Check the peer evidence</h2>
            <p>
              A median limits the influence of outliers, but it cannot explain
              differences in growth, margins, capital intensity or risk.
            </p>
          </div>
        </div>
        {data?.peers.length ? (
          <>
            {data.peerReason ? (
              <div className="analysis-notice" role="status">
                <span>{data.peerReason}</span>
              </div>
            ) : null}
            <div className="analysis-table-wrap">
              <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Price / earnings</th>
                  <th>Price / sales</th>
                  <th>Price / book</th>
                </tr>
              </thead>
              <tbody>
                {data.peers.map((peer) => (
                  <tr key={peer.marketCode}>
                    <td>
                      <strong>{peer.symbol}</strong>
                      <span>{peer.company ?? "Company name unavailable"}</span>
                    </td>
                    <td>{multiple(peerMetric(peer, "pe"))}</td>
                    <td>{multiple(peerMetric(peer, "ps"))}</td>
                    <td>{multiple(peerMetric(peer, "pb"))}</td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyAnalysis
            message={
              data?.peerReason ??
              "Comparable-company figures are not available."
            }
          />
        )}
        <CalculationDisclosure
          title="Peer-selection policy"
          summary="Industry first · closest by log market cap · up to 8 issuers"
          badges={[
            valuation?.peerAsOf
              ? `Peer inputs ${asOfDate(valuation.peerAsOf)}`
              : null,
          ]}
          items={[
            {
              label: "Candidate rules",
              value:
                "Use supported operating equities, exclude the target and duplicate issuers, require at least two positive P/E, P/S, or P/B observations, and reject known market caps outside 1%–100× the target.",
            },
            {
              label: "Ranking",
              value:
                "Choose up to eight candidates nearest to the target by absolute log market-cap distance from a capped candidate pool.",
            },
            {
              label: "Fallback",
              value:
                "Start with the reported industry classification. Expand to the broader sector group when any displayed multiple cannot reach the three-observation minimum.",
            },
          ]}
        />
      </section>

      <details className="analysis-disclosure">
        <summary>
          <span>
            <CircleDollarSign aria-hidden="true" />
            Peer-discount questions for value investors
          </span>
          <ChevronRight aria-hidden="true" />
        </summary>
        <div className="analysis-method-copy">
          <p>
            <strong>When is a peer discount an opportunity?</strong> A discount
            can be attractive when the businesses are genuinely comparable,
            normalized margins and returns are durable, the balance sheet is
            sound, and temporary expectations—not impaired economics—explain
            the lower multiple.
          </p>
          <p>
            <strong>When is the discount justified?</strong> A lower multiple
            may be warranted by slower growth, weaker margins, lower returns on
            capital, heavier reinvestment, customer concentration, cyclicality
            or financial risk. Peer data cannot remove those economic
            differences.
          </p>
          <p>
            <strong>How should I use implied value?</strong> Treat it as a
            screening range, not a price target. This page calculates positive
            peer medians for P/E, P/S and P/B, applies them to the matching
            company multiple base, and takes the median of complete implied
            values.
            Validate the peer set and accounting periods, then compare the
            result with conservative cash-flow value and the required margin
            of safety.
          </p>
        </div>
      </details>
    </>
  );
}

function BridgeRow({
  label,
  value,
  currency,
  emphasized = false,
  result = false,
  shares = false,
}: {
  label: string;
  value: number | null;
  currency?: string | null;
  emphasized?: boolean;
  result?: boolean;
  shares?: boolean;
}) {
  return (
    <div
      className={`analysis-bridge-row${emphasized ? " is-emphasized" : ""}${result ? " is-result" : ""}`}
    >
      <span>{label}</span>
      <strong>
        {shares
          ? value === null
            ? "—"
            : new Intl.NumberFormat("en-US", {
                notation: "compact",
                maximumFractionDigits: 2,
              }).format(value)
          : result
            ? money(value, currency ?? null)
            : compactNumber(value, currency ?? null)}
      </strong>
    </div>
  );
}

function EmptyAnalysis({ message }: { message: string }) {
  return (
    <div className="analysis-empty">
      <Calculator aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}
