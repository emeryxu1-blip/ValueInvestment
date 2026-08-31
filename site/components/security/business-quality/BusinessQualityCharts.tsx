"use client";

import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  BusinessQualityAnalysis,
  ProfitabilityPoint,
} from "@/lib/security/business-quality";

type TooltipValue =
  | number
  | string
  | ReadonlyArray<number | string>
  | undefined;

const compactMoney = (value: number, currency: string | null) => {
  if (!currency) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return "—";
  }
};

const axisMoney = (value: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

const tooltipMoney = (currency: string | null) => (value: TooltipValue) =>
  typeof value === "number" ? compactMoney(value, currency) : String(value ?? "—");

const tooltipPercent = (value: TooltipValue) =>
  typeof value === "number" ? `${value.toFixed(1)}%` : String(value ?? "—");

export function ProfitabilityTrendChart({
  points,
  currency,
}: {
  points: ProfitabilityPoint[];
  currency: string | null;
}) {
  const data = useMemo(
    () =>
      points.slice(-6).map((point) => ({
        period: point.period.replace(/^FY\s+/i, ""),
        revenue: point.revenue,
        netIncome: point.netIncome,
        netMargin:
          point.netMargin === null ? null : point.netMargin * 100,
      })),
    [points],
  );

  if (data.length < 2) {
    return (
      <ChartEmpty message="At least two annual periods are needed for a profitability trend." />
    );
  }

  return (
    <div
      className="quality-chart"
      role="img"
      aria-label="Annual revenue, net income and net margin trend"
    >
      <ResponsiveContainer width="100%" height={330}>
        <ComposedChart
          data={data}
          margin={{ top: 10, right: 6, bottom: 0, left: 0 }}
        >
          <CartesianGrid
            vertical={false}
            stroke="rgba(29, 29, 31, 0.08)"
          />
          <XAxis
            dataKey="period"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#7d7d82", fontSize: 11 }}
          />
          <YAxis
            yAxisId="money"
            axisLine={false}
            tickLine={false}
            tickFormatter={axisMoney}
            width={48}
            tick={{ fill: "#7d7d82", fontSize: 11 }}
          />
          <YAxis
            yAxisId="margin"
            orientation="right"
            axisLine={false}
            tickLine={false}
            tickFormatter={(value: number) => `${value.toFixed(0)}%`}
            width={42}
            tick={{ fill: "#7d7d82", fontSize: 11 }}
          />
          <Tooltip
            formatter={(value, name) =>
              name === "Net margin"
                ? tooltipPercent(value)
                : tooltipMoney(currency)(value as TooltipValue)
            }
            cursor={{ fill: "rgba(0, 113, 227, 0.035)" }}
            contentStyle={{
              border: "1px solid rgba(29, 29, 31, 0.1)",
              borderRadius: 14,
              boxShadow: "0 14px 34px rgba(0, 0, 0, 0.09)",
            }}
          />
          <Legend
            iconType="circle"
            iconSize={7}
            wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
          />
          <Bar
            yAxisId="money"
            dataKey="revenue"
            name="Revenue"
            fill="#b7d8ff"
            radius={[5, 5, 0, 0]}
          />
          <Bar
            yAxisId="money"
            dataKey="netIncome"
            name="Net income"
            fill="#0071e3"
            radius={[5, 5, 0, 0]}
          />
          <Line
            yAxisId="margin"
            type="monotone"
            dataKey="netMargin"
            name="Net margin"
            stroke="#248a3d"
            strokeWidth={2.5}
            dot={{ r: 3, fill: "#248a3d", strokeWidth: 0 }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EarningsBridge({
  analysis,
  currency,
}: {
  analysis: BusinessQualityAnalysis;
  currency: string | null;
}) {
  const bridge = analysis.earningsBridge;
  if (!bridge) {
    return (
      <ChartEmpty message="Revenue and net income are required for the earnings bridge." />
    );
  }

  const rows = bridge.rows;
  const endpoints = rows.flatMap((row) => [row.from, row.to, 0]);
  const domainMinimum = Math.min(...endpoints);
  const domainMaximum = Math.max(...endpoints);
  const domainRange = Math.max(domainMaximum - domainMinimum, 1);
  const zeroPosition = ((0 - domainMinimum) / domainRange) * 100;

  return (
    <div
      className="quality-bridge"
      role="img"
      aria-label={`${bridge.period} revenue to free cash flow bridge`}
    >
      {rows.map((row) => {
        const start = Math.min(row.from, row.to);
        const left = ((start - domainMinimum) / domainRange) * 100;
        const width = Math.max(
          (Math.abs(row.to - row.from) / domainRange) * 100,
          1.25,
        );
        return (
          <div className="quality-bridge-row" key={row.label}>
            <span>{row.label}</span>
            <div className="quality-bridge-track" aria-hidden="true">
              <i
                className="quality-bridge-zero"
                style={{ left: `${zeroPosition}%` }}
              />
              <b
                className={`is-${row.kind}`}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            </div>
            <strong>{compactMoney(row.value, currency)}</strong>
          </div>
        );
      })}
      <p>
        The API groups all costs, interest, and tax into one calculated
        difference. The cash step is not a detailed cash-flow statement.
      </p>
    </div>
  );
}

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="quality-chart-empty">
      <span>{message}</span>
    </div>
  );
}
