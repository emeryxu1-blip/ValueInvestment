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
  SlidersHorizontal,
  Target,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
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
  calculateDcfFromMetrics,
  opportunityLabel,
  positiveNumber as positive,
  valuationScenarios,
  type DcfAssumptions,
  type DcfModel,
  type RelativeMeasure,
} from "@/lib/security/valuation";
import ResearchPanelHeader from "./ResearchPanelHeader";
import { useSecurityResearchShell } from "./SecurityResearchShell";

type AnalysisMode = "cash-flow-value" | "relative-value";

type Props = {
  exchange: string;
  symbol: string;
  mode: AnalysisMode;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
    : `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;

const multiple = (value: number | null) =>
  value === null || !Number.isFinite(value)
    ? "—"
    : `${value.toFixed(1)}×`;

const peerMetric = (peer: AnalysisPeer, key: string) =>
  metricNumber(peer.metrics, key);

const compactNumber = (value: number | null, currency = "USD") =>
  money(value, currency, true);

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
  const {
    dcfAssumptions: assumptions,
    setDcfAssumptions: setAssumptions,
  } = useSecurityResearchShell();
  const [data, setData] = useState<SecurityAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const view =
    mode === "cash-flow-value" ? "dcf-valuation" : "relative-valuation";
  const analysisPath = `/api/security/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}/analysis?view=${view}`;

  const load = useCallback(
    async (background = false) => {
      if (background) setRefreshing(true);
      else setLoading(true);
      try {
        const next = await fetch(analysisPath, { cache: "no-store" }).then(
          responseJson,
        );
        setData(next);
        setError(null);
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "The latest analysis is temporarily unavailable.",
        );
      } finally {
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

  const dcfModel = useMemo(
    () =>
      data && mode === "cash-flow-value"
        ? calculateDcfFromMetrics(data.metrics, assumptions)
        : null,
    [assumptions, data, mode],
  );
  const relativeValuation =
    data?.valuation?.kind === "relative" ? data.valuation : null;
  const relativeMeasures = relativeValuation?.measures ?? [];
  const relativeValue = relativeValuation?.relativeValue ?? null;
  const price =
    data?.valuation?.price ??
    (data ? positive(metricNumber(data.metrics, "price")) : null);
  const baseValue =
    mode === "cash-flow-value" ? dcfModel?.perShare ?? null : relativeValue;
  const gap =
    mode === "relative-value"
      ? relativeValuation?.gap ?? null
      : price !== null && baseValue !== null
        ? baseValue / price - 1
        : null;
  const scenarios =
    mode === "relative-value"
      ? relativeValuation?.scenarios ?? []
      : valuationScenarios(baseValue);
  const isCashFlowView = mode === "cash-flow-value";
  const panelHeader = isCashFlowView
    ? {
        view: "cash-flow" as const,
        eyebrow: "Cash-flow safety",
        title: "Cash-flow margin of safety",
        description:
          "Estimate future owner earnings with conservative growth and discount assumptions, then demand enough distance between value and price.",
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
                ? "cash-flow margin of safety"
                : "market expectation check"}{" "}
              for {canonicalSymbol}
            </p>
          </div>
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
            <h2 id="value-result">{opportunityLabel(gap)}</h2>
            <p>
              Estimated value{" "}
              <strong>
                {money(baseValue, data?.identity.currency ?? "USD")}
              </strong>{" "}
              compared with a market price of{" "}
              <strong>{money(price, data?.identity.currency ?? "USD")}</strong>.
            </p>
          </div>
          <div
            className={`analysis-gap ${gap !== null && gap >= 0 ? "is-positive" : "is-negative"}`}
          >
            {gap !== null && gap >= 0 ? (
              <ArrowUpRight aria-hidden="true" />
            ) : (
              <ArrowDownRight aria-hidden="true" />
            )}
            <strong>{percent(gap)}</strong>
            <span>value gap</span>
          </div>
        </section>

        <div className="analysis-scenarios" aria-label="Valuation scenarios">
          {scenarios.map((scenario) => (
            <div key={scenario.label}>
              <span>{scenario.label}</span>
              <strong>
                {money(
                  scenario.value,
                  data?.identity.currency ?? "USD",
                )}
              </strong>
            </div>
          ))}
          {!scenarios.length ? (
            <p>Scenario values will appear when the required inputs arrive.</p>
          ) : null}
        </div>

        {mode === "cash-flow-value" ? (
          <CashFlowSections
            data={data}
            model={dcfModel}
            assumptions={assumptions}
            onAssumptionsChange={setAssumptions}
          />
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
  model,
  assumptions,
  onAssumptionsChange,
}: {
  data: SecurityAnalysisResponse | null;
  model: DcfModel | null;
  assumptions: DcfAssumptions;
  onAssumptionsChange: (value: DcfAssumptions) => void;
}) {
  const currency = data?.identity.currency ?? "USD";
  const metrics = data?.metrics;
  const startingCashFlow = metricNumber(metrics, "freeCashFlow");
  const chartData =
    model?.projections.map((projection) => ({
      year: `Year ${projection.year}`,
      cashFlow: projection.cashFlow,
      presentValue: projection.presentValue,
    })) ?? [];
  const sensitivityDiscounts = [
    assumptions.discountRate - 2,
    assumptions.discountRate,
    assumptions.discountRate + 2,
  ];
  const sensitivityGrowthRates = [
    Math.max(0, assumptions.terminalGrowth - 1),
    assumptions.terminalGrowth,
    assumptions.terminalGrowth + 1,
  ];

  const setAssumption = (key: keyof DcfAssumptions, value: number) => {
    onAssumptionsChange({
      ...assumptions,
      [key]: value,
    });
  };

  return (
    <>
      <section className="analysis-section" aria-labelledby="cash-flow-model">
        <div className="analysis-section-heading">
          <div className="analysis-icon">
            <SlidersHorizontal aria-hidden="true" />
          </div>
          <div>
            <p className="analysis-label">Present value model</p>
            <h2 id="cash-flow-model">Stress-test the assumptions</h2>
            <p>
              The starting cash flow comes from the latest company figures.
              Change the forecast assumptions to see the effect immediately.
            </p>
          </div>
        </div>
        <div className="analysis-assumptions">
          <AssumptionControl
            label="Annual cash-flow growth"
            value={assumptions.cashFlowGrowth}
            min={-5}
            max={25}
            step={0.5}
            onChange={(value) => setAssumption("cashFlowGrowth", value)}
          />
          <AssumptionControl
            label="Discount rate"
            value={assumptions.discountRate}
            min={5}
            max={16}
            step={0.25}
            onChange={(value) => setAssumption("discountRate", value)}
          />
          <AssumptionControl
            label="Terminal growth"
            value={assumptions.terminalGrowth}
            min={0}
            max={5}
            step={0.25}
            onChange={(value) => setAssumption("terminalGrowth", value)}
          />
        </div>
        <div className="analysis-chart-card">
          <div className="analysis-chart-summary">
            <span>Starting free cash flow</span>
            <strong>{compactNumber(startingCashFlow, currency)}</strong>
          </div>
          {chartData.length ? (
            <div className="analysis-chart" aria-label="Projected cash flows">
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
                    dataKey="year"
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
                    dataKey="cashFlow"
                    name="Projected cash flow"
                    fill="#0071e3"
                    radius={[6, 6, 0, 0]}
                  />
                  <Bar
                    dataKey="presentValue"
                    name="Present value"
                    fill="#9cc9f6"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyAnalysis message="Cash-flow projections need current free cash flow, market price and market capitalization." />
          )}
        </div>
      </section>

      <section className="analysis-section" aria-labelledby="calculation-bridge">
        <div className="analysis-section-heading">
          <div className="analysis-icon">
            <Calculator aria-hidden="true" />
          </div>
          <div>
            <p className="analysis-label">Value bridge</p>
            <h2 id="calculation-bridge">From cash flows to value per share</h2>
            <p>
              The five-year forecast and terminal value build enterprise
              value. Cash and debt then bridge that figure to common equity.
            </p>
          </div>
        </div>
        {model ? (
          <div className="analysis-bridge">
            <BridgeRow
              label="Present value of five-year cash flows"
              value={model.presentValueOfForecast}
              currency={currency}
            />
            <BridgeRow
              label="Present value of terminal cash flows"
              value={model.presentValueOfTerminal}
              currency={currency}
            />
            <BridgeRow
              label="Enterprise value"
              value={model.enterpriseValue}
              currency={currency}
              emphasized
            />
            <BridgeRow
              label="Add cash and short-term investments"
              value={metricNumber(metrics, "cash")}
              currency={currency}
            />
            <BridgeRow
              label="Subtract debt"
              value={
                metricNumber(metrics, "debt") === null
                  ? null
                  : -metricNumber(metrics, "debt")!
              }
              currency={currency}
            />
            <BridgeRow
              label="Equity value"
              value={model.equityValue}
              currency={currency}
              emphasized
            />
            <BridgeRow
              label="Shares used"
              value={model.shares}
              currency={currency}
              shares
            />
            <BridgeRow
              label="Cash-flow value per share"
              value={model.perShare}
              currency={currency}
              result
            />
          </div>
        ) : (
          <EmptyAnalysis message="The value bridge will appear when the required inputs are available." />
        )}
      </section>

      <section className="analysis-section" aria-labelledby="sensitivity-heading">
        <div className="analysis-section-heading">
          <div className="analysis-icon">
            <Target aria-hidden="true" />
          </div>
          <div>
            <p className="analysis-label">Sensitivity</p>
            <h2 id="sensitivity-heading">See how quickly value can move</h2>
            <p>
              Compare value per share across nearby discount-rate and terminal
              growth assumptions. The center cell matches the base case above.
            </p>
          </div>
        </div>
        {data ? (
          <div className="analysis-table-wrap analysis-sensitivity">
            <table>
              <thead>
                <tr>
                  <th>Terminal growth</th>
                  {sensitivityDiscounts.map((discountRate) => (
                    <th key={discountRate}>
                      {discountRate.toFixed(1)}% discount rate
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sensitivityGrowthRates.map((terminalGrowth) => (
                  <tr key={terminalGrowth}>
                    <td>{terminalGrowth.toFixed(1)}%</td>
                    {sensitivityDiscounts.map((discountRate) => {
                      const value = calculateDcfFromMetrics(data.metrics, {
                        ...assumptions,
                        discountRate,
                        terminalGrowth,
                      })?.perShare ?? null;
                      const isBase =
                        discountRate === assumptions.discountRate &&
                        terminalGrowth === assumptions.terminalGrowth;
                      return (
                        <td
                          key={`${terminalGrowth}:${discountRate}`}
                          className={isBase ? "is-base-case" : undefined}
                        >
                          {money(value, currency)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyAnalysis message="Sensitivity values will appear with the base model." />
        )}
      </section>

      <details className="analysis-disclosure">
        <summary>
          <span>
            <BarChart3 aria-hidden="true" />
            View the five-year calculation
          </span>
          <ChevronRight aria-hidden="true" />
        </summary>
        {model ? (
          <div className="analysis-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Forecast year</th>
                  <th>Cash flow</th>
                  <th>Discount factor</th>
                  <th>Present value</th>
                </tr>
              </thead>
              <tbody>
                {model.projections.map((projection) => (
                  <tr key={projection.year}>
                    <td>Year {projection.year}</td>
                    <td>{compactNumber(projection.cashFlow, currency)}</td>
                    <td>{projection.discountFactor.toFixed(3)}</td>
                    <td>{compactNumber(projection.presentValue, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyAnalysis message="No calculation is available yet." />
        )}
      </details>

      <details className="analysis-disclosure">
        <summary>
          <span>
            <CircleDollarSign aria-hidden="true" />
            Conservative cash-flow questions
          </span>
          <ChevronRight aria-hidden="true" />
        </summary>
        <div className="analysis-method-copy">
          <p>
            <strong>Why start with conservative owner earnings?</strong>{" "}
            Reported free cash flow can be lifted by working-capital timing or
            delayed investment. Normalize it across a cycle, account for
            maintenance spending and dilution, and prefer a starting figure the
            business has repeatedly earned.
          </p>
          <p>
            <strong>How much margin of safety is enough?</strong> There is no
            universal percentage. A predictable, conservatively financed
            business may justify a narrower gap than a cyclical or highly
            uncertain one. Use the downside case and sensitivity range instead
            of relying on the base estimate alone.
          </p>
          <p>
            <strong>Which assumptions deserve the hardest stress test?</strong>{" "}
            Cash-flow growth, the discount rate and terminal growth drive most
            of the result. If value disappears under modestly tougher
            assumptions—or depends heavily on terminal value—the opportunity
            needs a wider margin before it is investable.
          </p>
          <p>
            <strong>When should the model reject the opportunity?</strong> Step
            back when only the optimistic case clears the price, normalized
            owner earnings are unreliable, net debt weakens the equity bridge,
            or dilution absorbs the per-share upside. The model is a decision
            aid, not proof of intrinsic value.
          </p>
        </div>
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
  const currency = data?.identity.currency ?? "USD";
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
              Each card applies the peer median to this company’s per-share
              fundamentals. The blended value uses only complete comparisons.
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
        ) : (
          <EmptyAnalysis
            message={
              data?.peerReason ??
              "Comparable-company figures are not available."
            }
          />
        )}
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
            peer medians for P/E, P/S and P/B, applies them to matching
            per-share fundamentals, and averages only complete comparisons.
            Validate the peer set and accounting periods, then compare the
            result with conservative cash-flow value and the required margin
            of safety.
          </p>
        </div>
      </details>
    </>
  );
}

function AssumptionControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="analysis-assumption">
      <span>
        {label}
        <strong>{value.toFixed(step < 0.5 ? 2 : 1)}%</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
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
  currency: string;
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
            ? money(value, currency)
            : compactNumber(value, currency)}
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
