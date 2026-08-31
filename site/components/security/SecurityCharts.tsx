"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AreaSeries,
  ColorType,
  createChart,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Logical,
  type LogicalRange,
  type Time,
} from "lightweight-charts";
import type { FinancialBridge } from "@/lib/contracts";
import {
  normalizeChartPoints,
  referencePriceFromLines,
  type ChartPoint,
} from "@/lib/security/chart-series";
import type { FinancialPeriod, SeriesLine, SeriesResponse } from "./types";

const moneyCompact = (value: number, currency: string | null) => {
  if (!currency) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      style: "currency",
      currency,
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return "—";
  }
};

const axisCompact = (value: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

type TooltipValue = number | string | ReadonlyArray<number | string> | undefined;

const tooltipMoney = (currency: string | null) => (value: TooltipValue) => {
  if (typeof value !== "number") return String(value ?? "—");
  return moneyCompact(value, currency);
};

type ChartLine = ISeriesApi<"Area"> | ISeriesApi<"Line">;

type ChartState = {
  lines: Map<string, ChartLine>;
  primary: ChartLine | null;
  primaryPoints: ChartPoint[];
  intrinsicPriceLine: { owner: ChartLine; line: IPriceLine } | null;
  initialized: boolean;
};

const emptyChartState = (): ChartState => ({
  lines: new Map(),
  primary: null,
  primaryPoints: [],
  intrinsicPriceLine: null,
  initialized: false,
});

const palette = ["#007aff", "#30b46d", "#af52de", "#ff9f0a"];

function chartColor(index: number): string {
  return palette[index % palette.length];
}

function chartData(points: ChartPoint[]) {
  return points.map((point) => ({
    time: point.time as Time,
    value: point.value,
  }));
}

function addChartLine(
  chart: IChartApi,
  line: SeriesLine,
  index: number,
): ChartLine {
  const color = chartColor(index);
  if (line.seriesKind === "model-period") {
    return chart.addSeries(LineSeries, {
      color,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      title: line.label,
      priceLineVisible: false,
      lastValueVisible: true,
      pointMarkersVisible: true,
      pointMarkersRadius: 4,
      crosshairMarkerVisible: true,
    });
  }
  if (line.seriesKind === "reference-overlay") {
    return chart.addSeries(LineSeries, {
      color,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      title: line.label,
      priceLineVisible: false,
      lastValueVisible: true,
      pointMarkersVisible: true,
      pointMarkersRadius: 4,
      crosshairMarkerVisible: true,
    });
  }
  if (index === 0) {
    return chart.addSeries(AreaSeries, {
      lineColor: color,
      topColor: "rgba(0, 122, 255, .20)",
      bottomColor: "rgba(0, 122, 255, 0)",
      lineWidth: 2,
      title: line.label,
      priceLineVisible: false,
      lastValueVisible: true,
    });
  }
  return chart.addSeries(LineSeries, {
    color,
    lineWidth: 2,
    title: line.label,
    priceLineVisible: false,
    lastValueVisible: true,
  });
}

function normalizedLines(data: SeriesResponse | null) {
  return (data?.series ?? [])
    .map((line) => ({ line, points: normalizeChartPoints(line.points) }))
    .filter((item) => item.points.length > 0);
}

function hasRenderablePrice(data: SeriesResponse | null): boolean {
  return normalizedLines(data).some(({ line }) => line.id === "price");
}

function applyChartData(
  chart: IChartApi,
  data: SeriesResponse,
  state: ChartState,
  preserveViewport: boolean,
  priceOnly: boolean,
) {
  const lines = normalizedLines(data);
  const previousPrimary = state.primaryPoints;
  const previousRange = preserveViewport
    ? chart.timeScale().getVisibleLogicalRange()
    : null;
  const previousTimeRange = preserveViewport
    ? chart.timeScale().getVisibleRange()
    : null;
  const nextIds = new Set(lines.map(({ line }) => line.id));

  for (const [id, existing] of state.lines) {
    if (!nextIds.has(id)) {
      if (state.intrinsicPriceLine?.owner === existing) {
        existing.removePriceLine(state.intrinsicPriceLine.line);
        state.intrinsicPriceLine = null;
      }
      chart.removeSeries(existing);
    }
  }

  const nextLines = new Map<string, ChartLine>();
  lines.forEach(({ line, points }, index) => {
    const chartLine = state.lines.get(line.id) ?? addChartLine(chart, line, index);
    chartLine.setData(chartData(points));
    nextLines.set(line.id, chartLine);
  });

  const primaryItem =
    lines.find(({ line }) => line.id === "price") ?? lines[0] ?? null;
  const primaryPoints = primaryItem?.points ?? [];
  const paginationItem = lines.find(({ line }) => line.id === "price") ?? null;
  const viewportPoints = paginationItem?.points ?? primaryPoints;
  const oldFirstTime = previousPrimary[0]?.time;
  let inserted = 0;
  if (oldFirstTime && viewportPoints.length > 0) {
    const oldFirstIndex = viewportPoints.findIndex(
      (point) => point.time === oldFirstTime,
    );
    inserted = oldFirstIndex >= 0
      ? oldFirstIndex
      : viewportPoints.filter((point) => point.time < oldFirstTime).length;
  }

  state.lines = nextLines;
  state.primary = paginationItem
    ? nextLines.get(paginationItem.line.id) ?? null
    : primaryItem
      ? nextLines.get(primaryItem.line.id) ?? null
      : null;
  state.primaryPoints = viewportPoints;

  const intrinsicValue = referencePriceFromLines(lines);
  const intrinsicItem = lines.find(({ line }) => line.seriesKind === "reference-overlay" && line.points.length === 1);
  const lineOwner = nextLines.get("price") ??
    (intrinsicItem ? nextLines.get(intrinsicItem.line.id) ?? null : null);
  const lineColor = "#30b46d";
  const existingReference = state.intrinsicPriceLine;
  // Keep the reference line on the market-price series so it shares the main
  // price scale and spans the entire chart pane.
  if (intrinsicValue == null || !lineOwner) {
    if (existingReference) {
      existingReference.owner.removePriceLine(existingReference.line);
      state.intrinsicPriceLine = null;
    }
  } else if (existingReference?.owner !== lineOwner) {
    if (existingReference) {
      existingReference.owner.removePriceLine(existingReference.line);
    }
    state.intrinsicPriceLine = {
      owner: lineOwner,
      line: lineOwner.createPriceLine({
        price: intrinsicValue,
        color: lineColor,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        lineVisible: true,
        axisLabelVisible: true,
        title: intrinsicItem?.line.label ?? "Valuation reference",
      }),
    };
  } else {
    existingReference.line.applyOptions({
      price: intrinsicValue,
      color: lineColor,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      lineVisible: true,
      axisLabelVisible: true,
      title: intrinsicItem?.line.label ?? "Valuation reference",
    });
  }

  if (!state.initialized) {
    chart.timeScale().fitContent();
    state.initialized = true;
    return;
  }

  if (!previousRange || viewportPoints.length === 0) return;

  let nextRange: LogicalRange = previousRange;
  if (priceOnly && inserted > 0) {
    // Prepending bars changes logical indexes, so shift the existing viewport
    // by exactly the number of inserted observations. This preserves zoom and
    // the user's anchored date even when the series has trading-day gaps.
    nextRange = {
      from: (previousRange.from + inserted) as Logical,
      to: (previousRange.to + inserted) as Logical,
    };
  } else if (previousTimeRange) {
    // For non-price updates (for example, an intrinsic-value refresh), restore by
    // time rather than assuming that every line has the same logical index.
    const fromIndex = chart.timeScale().timeToIndex(previousTimeRange.from, true);
    const toIndex = chart.timeScale().timeToIndex(previousTimeRange.to, true);
    if (fromIndex !== null && toIndex !== null) {
      const width = previousRange.to - previousRange.from;
      nextRange = {
        from: (fromIndex - (previousRange.from - Math.trunc(previousRange.from))) as Logical,
        to: (toIndex + (previousRange.to - Math.trunc(previousRange.to))) as Logical,
      };
      if (width > 0 && nextRange.to - nextRange.from < width) {
        nextRange = {
          from: (nextRange.to - width) as Logical,
          to: nextRange.to,
        };
      }
    }
  }

  if (priceOnly) {
    const lastIndex = viewportPoints.length - 1;
    const rangeWidth = Math.max(1, nextRange.to - nextRange.from);
    const clampedTo = Math.min(nextRange.to, lastIndex);
    const clampedFrom = Math.max(0, clampedTo - rangeWidth);
    nextRange = {
      from: clampedFrom as Logical,
      to: clampedTo as Logical,
    };
  }

  if (
    nextRange.from !== previousRange.from ||
    nextRange.to !== previousRange.to
  ) {
    chart.timeScale().setVisibleLogicalRange(nextRange);
  }
}

type Props = {
  data: SeriesResponse | null;
  kind?: "valuation" | "price";
  onRequestMoreHistory?: () => void;
  hasMoreHistory?: boolean;
  loadingMore?: boolean;
};

export function ValuationHistoryChart({
  data,
  kind = "valuation",
  onRequestMoreHistory,
  hasMoreHistory = false,
  loadingMore = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const stateRef = useRef<ChartState>(emptyChartState());
  const dataRef = useRef<SeriesResponse | null>(data);
  const requestMoreRef = useRef(onRequestMoreHistory);
  const hasMoreRef = useRef(hasMoreHistory);
  const loadingMoreRef = useRef(loadingMore);
  const priceOnlyRef = useRef(kind === "price" || data?.group === "price");
  const lastRequestAtRef = useRef(0);
  const clampingRef = useRef(false);
  const clampResetFrameRef = useRef<number | null>(null);
  const isPriceOnly = kind === "price" || data?.group === "price";
  const renderableLines = normalizedLines(data);
  const hasRenderableData = renderableLines.length > 0;
  const hasPriceData = hasRenderablePrice(data);
  const valuationCoverage = data?.valuationCoverage;

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    requestMoreRef.current = onRequestMoreHistory;
    hasMoreRef.current = hasMoreHistory;
  }, [hasMoreHistory, onRequestMoreHistory]);

  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);

  useEffect(() => {
    priceOnlyRef.current = isPriceOnly;
  }, [isPriceOnly]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasRenderableData || (isPriceOnly && !hasPriceData)) return;

    let disposed = false;
    let createFrame = 0;
    let resizeFrame = 0;
    let resizeObserver: ResizeObserver | null = null;

    const resizeChart = (width: number, height: number) => {
      if (disposed || !chartRef.current) return;
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        if (disposed || !chartRef.current) return;
        chartRef.current.resize(
          Math.max(1, Math.round(width)),
          Math.max(1, Math.round(height)),
        );
      });
    };

    const onVisibleRangeChanged = (range: LogicalRange | null) => {
      const chart = chartRef.current;
      const state = stateRef.current;
      if (!chart || !range || !state.primary) return;

      if (priceOnlyRef.current && state.primaryPoints.length > 0) {
        const lastIndex = state.primaryPoints.length - 1;
        const width = Math.max(1, range.to - range.from);
        const invalidRange = !Number.isFinite(range.from) ||
          !Number.isFinite(range.to) ||
          range.from > range.to;
        const exceedsFuture = range.to > lastIndex;
        const exceedsPast = range.from < 0;
        if ((invalidRange || exceedsFuture || exceedsPast) && !clampingRef.current) {
          const clampedTo = Math.min(lastIndex, Math.max(0, Number.isFinite(range.to) ? range.to : lastIndex));
          const clampedFrom = Math.max(0, clampedTo - width);
          clampingRef.current = true;
          chart.timeScale().setVisibleLogicalRange({
            from: clampedFrom as Logical,
            to: clampedTo as Logical,
          });
          if (clampResetFrameRef.current !== null) {
            window.cancelAnimationFrame(clampResetFrameRef.current);
          }
          clampResetFrameRef.current = window.requestAnimationFrame(() => {
            clampResetFrameRef.current = null;
            clampingRef.current = false;
          });
          return;
        }
      }

      if (
        !priceOnlyRef.current ||
        !hasMoreRef.current ||
        loadingMoreRef.current ||
        !requestMoreRef.current
      ) return;

      const bars = state.primary.barsInLogicalRange(range);
      if (!bars || bars.barsBefore > 35) return;
      const now = Date.now();
      if (now - lastRequestAtRef.current < 800) return;
      lastRequestAtRef.current = now;
      requestMoreRef.current();
    };

    const tryCreateChart = () => {
      if (disposed || chartRef.current || !dataRef.current) return;
      const bounds = container.getBoundingClientRect();
      if (bounds.width < 2 || bounds.height < 2) return;

      const chart = createChart(container, {
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height)),
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#6e6e73",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
          fontSize: 11,
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: "rgba(60, 60, 67, 0.06)" },
          horzLines: { color: "rgba(60, 60, 67, 0.07)" },
        },
        rightPriceScale: {
          borderVisible: false,
          scaleMargins: { top: 0.16, bottom: 0.12 },
        },
        timeScale: {
          borderVisible: false,
          timeVisible: false,
          rightOffset: 0,
          fixLeftEdge: false,
          fixRightEdge: isPriceOnly,
          rightBarStaysOnScroll: isPriceOnly,
          shiftVisibleRangeOnNewBar: false,
          lockVisibleTimeRangeOnResize: true,
          minBarSpacing: 3,
        },
        crosshair: {
          vertLine: { color: "rgba(0, 122, 255, .35)", labelBackgroundColor: "#007aff" },
          horzLine: { color: "rgba(0, 122, 255, .24)", labelBackgroundColor: "#007aff" },
        },
        handleScale: {
          mouseWheel: true,
          pinch: true,
          axisPressedMouseMove: true,
          axisDoubleClickReset: true,
        },
        handleScroll: {
          mouseWheel: false,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: false,
        },
      });
      chartRef.current = chart;
      stateRef.current = emptyChartState();
      applyChartData(
        chart,
        dataRef.current,
        stateRef.current,
        false,
        isPriceOnly,
      );
      chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRangeChanged);
    };

    resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      if (!chartRef.current) {
        window.cancelAnimationFrame(createFrame);
        createFrame = window.requestAnimationFrame(tryCreateChart);
        return;
      }
      resizeChart(entry.contentRect.width, entry.contentRect.height);
    });
    resizeObserver.observe(container);
    createFrame = window.requestAnimationFrame(tryCreateChart);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(createFrame);
      window.cancelAnimationFrame(resizeFrame);
      if (clampResetFrameRef.current !== null) {
        window.cancelAnimationFrame(clampResetFrameRef.current);
        clampResetFrameRef.current = null;
      }
      clampingRef.current = false;
      resizeObserver?.disconnect();
      if (chartRef.current) {
        chartRef.current.timeScale().unsubscribeVisibleLogicalRangeChange(
          onVisibleRangeChanged,
        );
        const currentState = stateRef.current;
        if (currentState.intrinsicPriceLine) {
          currentState.intrinsicPriceLine.owner.removePriceLine(
            currentState.intrinsicPriceLine.line,
          );
          currentState.intrinsicPriceLine = null;
        }
        chartRef.current.remove();
      }
      chartRef.current = null;
      stateRef.current = emptyChartState();
    };
  }, [hasPriceData, hasRenderableData, isPriceOnly]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !data) return;
    applyChartData(
      chart,
      data,
      stateRef.current,
      true,
      priceOnlyRef.current,
    );
  }, [data]);

  if (!hasRenderableData || (isPriceOnly && !hasPriceData)) {
    return (
      <ChartEmpty
        message={
          isPriceOnly
            ? "Market price history is not available for this security."
            : "Market-price history and intrinsic value are unavailable."
        }
      />
    );
  }

  return (
    <div>
      <div className="security-chart-legend" aria-label="Chart legend">
        {renderableLines.map(({ line }, index) => (
          <span key={line.id}>
            <i style={{ background: chartColor(index) }} />
            {line.label}
            {line.seriesKind === "reference-overlay" ? " · current reference" : ""}
            {line.seriesKind === "model-period" ? " · model periods" : ""}
          </span>
        ))}
      </div>
      <div
        ref={containerRef}
        className="security-lightweight-chart"
        aria-label={isPriceOnly ? "Historical market price chart" : "Market-price history and dated valuation-reference chart"}
      />
      {isPriceOnly && loadingMore ? (
        <p className="security-chart-loading" role="status">Loading older price history…</p>
      ) : null}
      {!isPriceOnly && valuationCoverage ? (
        <p className="security-chart-coverage" role="note">
          The DCF line uses model target periods from one current snapshot, not historical estimate-revision dates.
        </p>
      ) : null}
    </div>
  );
}

export function FinancialHistoryChart({
  periods,
  currency,
}: {
  periods: FinancialPeriod[];
  currency: string | null;
}) {
  const data = useMemo(
    () =>
      periods.slice(-6).map((period) => ({
        period: period.period,
        revenue: period.revenue,
        income: period.netIncome,
      })),
    [periods],
  );

  if (!data.length) return <ChartEmpty message="Historical financials are not available." />;

  return (
    <div className="security-rechart" aria-label="Revenue and net income history chart">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 12, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="rgba(60,60,67,.08)" />
          <XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fill: "#86868b", fontSize: 11 }} />
          <YAxis tickFormatter={axisCompact} tickLine={false} axisLine={false} width={50} tick={{ fill: "#86868b", fontSize: 11 }} />
          <Tooltip formatter={tooltipMoney(currency)} cursor={{ fill: "rgba(0,122,255,.04)" }} contentStyle={{ borderRadius: 12, border: "1px solid rgba(0,0,0,.08)", boxShadow: "0 8px 28px rgba(0,0,0,.10)" }} />
          <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
          <Bar dataKey="revenue" name="Revenue" fill="#007aff" radius={[5, 5, 0, 0]} />
          <Bar dataKey="income" name="Net income" fill="#5ac8fa" radius={[5, 5, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CashFlowWaterfall({
  bridge,
  currency,
}: {
  bridge: FinancialBridge | null;
  currency: string | null;
}) {
  if (!bridge) {
    return <ChartEmpty message="Cash flow decomposition is not available." />;
  }
  const endpoints = bridge.rows.flatMap((row) => [row.from, row.to, 0]);
  const domainMinimum = Math.min(...endpoints);
  const domainMaximum = Math.max(...endpoints);
  const domainRange = Math.max(domainMaximum - domainMinimum, 1);

  return (
    <div className="security-waterfall" aria-label={`${bridge.period} cash flow waterfall`}>
      {bridge.rows.map((row) => (
        <div className="security-waterfall-row" key={row.label}>
          <span>{row.label}</span>
          <div className="security-waterfall-track">
            <i
              className={`is-${row.kind}`}
              style={{
                marginLeft: `${((Math.min(row.from, row.to) - domainMinimum) / domainRange) * 100}%`,
                width: `${Math.max(1.5, (Math.abs(row.to - row.from) / domainRange) * 100)}%`,
              }}
            />
          </div>
          <strong>{moneyCompact(row.value, currency)}</strong>
        </div>
      ))}
      <p>The API groups costs, interest, and tax into one difference. The cash step is not a detailed cash-flow statement.</p>
    </div>
  );
}

function ChartEmpty({ message }: { message: string }) {
  return <div className="security-chart-empty"><span>{message}</span></div>;
}
