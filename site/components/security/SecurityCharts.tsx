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
  type IChartApi,
  type Time,
} from "lightweight-charts";
import type { FinancialBridge } from "@/lib/contracts";
import type { FinancialPeriod, SeriesResponse } from "./types";

const moneyCompact = (value: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 1,
  }).format(value);

const axisCompact = (value: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

type TooltipValue = number | string | ReadonlyArray<number | string> | undefined;

const tooltipMoney = (value: TooltipValue) => {
  if (typeof value !== "number") return String(value ?? "—");
  return moneyCompact(value);
};

export function ValuationHistoryChart({
  data,
  kind = "valuation",
}: {
  data: SeriesResponse | null;
  kind?: "valuation" | "price";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isPriceOnly = kind === "price" || data?.group === "price";

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !data?.series.some((line) => line.points.length)) return;

    let chart: IChartApi | null = createChart(container, {
      width: container.clientWidth,
      height: 340,
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
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.16, bottom: 0.12 } },
      timeScale: { borderVisible: false, timeVisible: false, rightOffset: 2 },
      crosshair: {
        vertLine: { color: "rgba(0, 122, 255, .35)", labelBackgroundColor: "#007aff" },
        horzLine: { color: "rgba(0, 122, 255, .24)", labelBackgroundColor: "#007aff" },
      },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true },
    });

    const palette = ["#007aff", "#30b46d", "#af52de", "#ff9f0a"];
    data.series.forEach((line, index) => {
      const color = palette[index % palette.length];
      const sorted = [...line.points]
        .filter((point) => Number.isFinite(point.value) && /^\d{4}-\d{2}-\d{2}/.test(point.time))
        .sort((a, b) => a.time.localeCompare(b.time))
        .map((point) => ({ time: point.time.slice(0, 10) as Time, value: point.value }));
      if (!sorted.length) return;
      if (index === 0) {
        const series = chart!.addSeries(AreaSeries, {
          lineColor: color,
          topColor: "rgba(0, 122, 255, .20)",
          bottomColor: "rgba(0, 122, 255, 0)",
          lineWidth: 2,
          title: line.label,
          priceLineVisible: false,
          lastValueVisible: true,
        });
        series.setData(sorted);
      } else {
        const series = chart!.addSeries(LineSeries, {
          color,
          lineWidth: 2,
          title: line.label,
          priceLineVisible: false,
          lastValueVisible: true,
        });
        series.setData(sorted);
      }
    });
    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver(([entry]) => {
      chart?.applyOptions({ width: Math.floor(entry.contentRect.width) });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart?.remove();
      chart = null;
    };
  }, [data]);

  if (!data?.series.some((line) => line.points.length)) {
    return (
      <ChartEmpty
        message={
          isPriceOnly
            ? "Market price history is not available for this security."
            : "Provider price history and dated DCF values are unavailable for this security."
        }
      />
    );
  }

  return (
    <div>
      <div className="security-chart-legend" aria-label="Chart legend">
        {data.series.map((line, index) => (
          <span key={line.id}>
            <i style={{ background: ["#007aff", "#30b46d", "#af52de", "#ff9f0a"][index % 4] }} />
            {line.label}
          </span>
        ))}
      </div>
      <div
        ref={containerRef}
        className="security-lightweight-chart"
        aria-label={isPriceOnly ? "Historical market price chart" : "Provider market-price history and dated DCF value chart"}
      />
    </div>
  );
}

export function FinancialHistoryChart({ periods }: { periods: FinancialPeriod[] }) {
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
          <Tooltip formatter={tooltipMoney} cursor={{ fill: "rgba(0,122,255,.04)" }} contentStyle={{ borderRadius: 12, border: "1px solid rgba(0,0,0,.08)", boxShadow: "0 8px 28px rgba(0,0,0,.10)" }} />
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
}: {
  bridge: FinancialBridge | null;
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
                marginLeft: `${
                  ((Math.min(row.from, row.to) - domainMinimum) /
                    domainRange) *
                  100
                }%`,
                width: `${Math.max(
                  1.5,
                  (Math.abs(row.to - row.from) / domainRange) * 100,
                )}%`,
              }}
            />
          </div>
          <strong>{moneyCompact(row.value)}</strong>
        </div>
      ))}
      <p>The API groups costs, interest, and tax into one difference. The cash step is not a detailed cash-flow statement.</p>
    </div>
  );
}

function ChartEmpty({ message }: { message: string }) {
  return <div className="security-chart-empty"><span>{message}</span></div>;
}
