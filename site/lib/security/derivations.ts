import type { FinancialPeriod } from "../contracts";

export function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function deriveMispricing(
  fairValue: number | null,
  price: number | null,
): number | null {
  if (fairValue == null || price == null || price <= 0) return null;
  return fairValue / price - 1;
}

export function medianPositive(values: Array<number | null | undefined>): number | null {
  const positive = values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  if (positive.length === 0) return null;
  const midpoint = Math.floor(positive.length / 2);
  return positive.length % 2 === 0
    ? (positive[midpoint - 1] + positive[midpoint]) / 2
    : positive[midpoint];
}

export function meanPositive(values: Array<number | null | undefined>): number | null {
  const positive = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value > 0,
  );
  return positive.length
    ? positive.reduce((sum, value) => sum + value, 0) / positive.length
    : null;
}

export function derivePeerValue(options: {
  price: number | null;
  pe: number | null;
  pb: number | null;
  ps: number | null;
  peerPes: Array<number | null>;
  peerPbs: Array<number | null>;
  peerPss: Array<number | null>;
}): number | null {
  if (options.price == null || options.price <= 0) return null;
  const medianPe = medianPositive(options.peerPes);
  const medianPb = medianPositive(options.peerPbs);
  const medianPs = medianPositive(options.peerPss);
  const implied = [
    options.pe && options.pe > 0 && medianPe
      ? (options.price / options.pe) * medianPe
      : null,
    options.pb && options.pb > 0 && medianPb
      ? (options.price / options.pb) * medianPb
      : null,
    options.ps && options.ps > 0 && medianPs
      ? (options.price / options.ps) * medianPs
      : null,
  ];
  return meanPositive(implied);
}

export function combineFairValues(
  dcfValue: number | null,
  peerValue: number | null,
): number | null {
  const values = [dcfValue, peerValue].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
  );
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function scenarioValues(baseValue: number | null): {
  bear: number | null;
  base: number | null;
  bull: number | null;
} {
  return baseValue == null
    ? { bear: null, base: null, bull: null }
    : { bear: baseValue * 0.8, base: baseValue, bull: baseValue * 1.2 };
}

type DcfModule = {
  predicted_prices?: unknown;
  history_prices?: unknown;
  latest_qfq_price?: unknown;
};

function datedNumberPoints(value: unknown): Array<[string, number]> {
  if (!Array.isArray(value)) return [];
  return value
    .map((point): [string, number] | null => {
      if (!Array.isArray(point) || point.length < 2) return null;
      const date = String(point[0]);
      const number = finiteNumber(point[1]);
      return number == null ? null : [date, number];
    })
    .filter((point): point is [string, number] => point !== null);
}

export function parseDcfModule(value: unknown): {
  fairValue: number | null;
  predicted: Array<[string, number]>;
  history: Array<[string, number]>;
  latestAdjustedPrice: number | null;
} {
  const dcfPayload = value && typeof value === "object" ? (value as DcfModule) : {};
  const predicted = datedNumberPoints(dcfPayload.predicted_prices).sort((left, right) =>
    right[0].localeCompare(left[0]),
  );
  return {
    fairValue: predicted[0]?.[1] ?? null,
    predicted,
    history: datedNumberPoints(dcfPayload.history_prices).sort((left, right) =>
      left[0].localeCompare(right[0]),
    ),
    latestAdjustedPrice: finiteNumber(dcfPayload.latest_qfq_price),
  };
}

export function yyyymmddToIso(value: string): string {
  const compact = value.replace(/[^0-9]/g, "");
  if (compact.length !== 8) return value;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

export function parseEarningsRevenueModule(value: unknown): {
  annual: FinancialPeriod[];
  quarterly: FinancialPeriod[];
} {
  const data =
    value &&
    typeof value === "object" &&
    Array.isArray((value as { data?: unknown }).data)
      ? (value as { data: unknown[] }).data
      : [];
  const quarterly = data
    .map((candidate): (FinancialPeriod & { fiscalYear: string; isYearEnd: boolean }) | null => {
      if (!candidate || typeof candidate !== "object") return null;
      const row = candidate as Record<string, unknown>;
      const period = typeof row.end_date === "string" ? row.end_date : "";
      if (!period) return null;
      return {
        period,
        revenue: finiteNumber(row.operating_income_total),
        netIncome: finiteNumber(row.net_profit),
        freeCashFlow: null,
        debt: null,
        cash: null,
        fiscalYear: String(row.year ?? period.slice(0, 4)),
        isYearEnd: String(row.period ?? "") === "596006",
      };
    })
    .filter(
      (period): period is FinancialPeriod & { fiscalYear: string; isYearEnd: boolean } =>
        period !== null,
    )
    .sort((left, right) => left.period.localeCompare(right.period));

  const byFiscalYear = new Map<
    string,
    Array<FinancialPeriod & { fiscalYear: string; isYearEnd: boolean }>
  >();
  for (const period of quarterly) {
    const group = byFiscalYear.get(period.fiscalYear) ?? [];
    group.push(period);
    byFiscalYear.set(period.fiscalYear, group);
  }
  const annual = [...byFiscalYear.entries()]
    .filter(([, periods]) => periods.length === 4 && periods.some((period) => period.isYearEnd))
    .map(([year, periods]): FinancialPeriod => ({
      period: `FY ${year}`,
      revenue: periods.every((period) => period.revenue != null)
        ? periods.reduce((sum, period) => sum + (period.revenue ?? 0), 0)
        : null,
      netIncome: periods.every((period) => period.netIncome != null)
        ? periods.reduce((sum, period) => sum + (period.netIncome ?? 0), 0)
        : null,
      freeCashFlow: null,
      debt: null,
      cash: null,
    }))
    .sort((left, right) => left.period.localeCompare(right.period))
    .slice(-5);

  return {
    annual,
    quarterly: quarterly
      .slice(-12)
      .map((period) => ({
        period: period.period,
        revenue: period.revenue,
        netIncome: period.netIncome,
        freeCashFlow: period.freeCashFlow,
        debt: period.debt,
        cash: period.cash,
      })),
  };
}
