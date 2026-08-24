type UnknownRecord = Record<string, unknown>;

export const OPERATING_MARGIN_STABILITY_RANGE = 0.05;

export type OperatingMarginHistorySummary = {
  margins: number[];
  asOf: string | null;
  stable5Y: boolean | null;
  trend5Y: number | null;
  expanding5Y: boolean | null;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function nestedValue(row: UnknownRecord, key: string): number | null {
  const candidate = row[key];
  if (isRecord(candidate)) return finiteNumber(candidate.value);
  return finiteNumber(candidate);
}

function linearTrend(values: number[]): number {
  const midpoint = (values.length - 1) / 2;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const denominator = values.reduce(
    (sum, _value, index) => sum + (index - midpoint) ** 2,
    0,
  );
  return values.reduce(
    (sum, value, index) => sum + (index - midpoint) * (value - mean),
    0,
  ) / denominator;
}

export function summarizeOperatingMarginHistory(
  moduleValue: unknown,
): OperatingMarginHistorySummary {
  const data = isRecord(moduleValue) && Array.isArray(moduleValue.data)
    ? moduleValue.data
    : [];
  const byYear = new Map<
    number,
    { margin: number | null; asOf: string | null }
  >();

  for (const candidate of data) {
    if (!isRecord(candidate) || !isRecord(candidate.subject)) continue;
    const period = String(candidate.subject.period ?? "").trim().toUpperCase();
    if (period !== "FY") continue;
    const year = Number(candidate.subject.year);
    if (!Number.isInteger(year)) continue;
    const revenue = nestedValue(candidate, "operating_income_total");
    const operatingProfit = nestedValue(candidate, "operating_profit");
    const calculated =
      revenue != null && revenue > 0 && operatingProfit != null
        ? operatingProfit / revenue
        : null;
    const margin = calculated != null && Number.isFinite(calculated)
      ? calculated
      : null;
    const endDate = candidate.subject.endDate;
    byYear.set(year, {
      margin: byYear.has(year) ? null : margin,
      asOf: typeof endDate === "string" && endDate ? endDate : null,
    });
  }

  const periods = [...byYear.entries()]
    .sort(([left], [right]) => left - right)
    .slice(-5);
  const margins = periods.flatMap(([, period]) =>
    period.margin == null ? [] : [period.margin],
  );
  const consecutive =
    periods.length === 5 &&
    periods.every(([year], index) => index === 0 || year === periods[index - 1][0] + 1);
  if (!consecutive || margins.length !== 5) {
    return {
      margins,
      asOf: periods.at(-1)?.[1].asOf ?? null,
      stable5Y: null,
      trend5Y: null,
      expanding5Y: null,
    };
  }

  const range = Math.max(...margins) - Math.min(...margins);
  const trend5Y = linearTrend(margins);
  return {
    margins,
    asOf: periods.at(-1)?.[1].asOf ?? null,
    stable5Y: range <= OPERATING_MARGIN_STABILITY_RANGE + Number.EPSILON,
    trend5Y,
    expanding5Y: trend5Y > 0 && margins.at(-1)! > margins[0],
  };
}
