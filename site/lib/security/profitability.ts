type UnknownRecord = Record<string, unknown>;

export type ProfitabilityHistoryPeriod = {
  period: string;
  revenue: number | null;
  netIncome: number | null;
};

export type ProfitabilitySnapshot = {
  identity: {
    exchange: string;
    symbol: string;
    company: string | null;
    currency: string;
  };
  quote: {
    price: number | null;
    changePercent: number | null;
    marketCap: number | null;
  };
  metrics: {
    pastScore: number | null;
    grossMargin: number | null;
    operatingMargin: number | null;
    netMargin: number | null;
    ebitMargin: number | null;
    ebitdaMargin: number | null;
    freeCashFlowMargin: number | null;
    returnOnEquity: number | null;
    returnOnAssets: number | null;
    returnOnInvestedCapital: number | null;
    assetTurnover: number | null;
    revenue: number | null;
    grossProfit: number | null;
    ebit: number | null;
    ebitda: number | null;
    netIncome: number | null;
    freeCashFlow: number | null;
    operatingCashFlow: number | null;
  };
  history: ProfitabilityHistoryPeriod[];
  asOf: string | null;
};

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finiteNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const metric = (payload: UnknownRecord, key: string): UnknownRecord | null => {
  if (!isRecord(payload.metrics)) return null;
  const candidate = payload.metrics[key];
  return isRecord(candidate) ? candidate : null;
};

const metricNumber = (payload: UnknownRecord, key: string): number | null =>
  finiteNumber(metric(payload, key)?.value);

const metricRatio = (payload: UnknownRecord, key: string): number | null => {
  const candidate = metric(payload, key);
  const raw = finiteNumber(candidate?.value);
  if (raw === null) return null;
  const valueType =
    typeof candidate?.valueType === "string" ? candidate.valueType : null;
  const rawUnit =
    typeof candidate?.rawUnit === "string" ? candidate.rawUnit : null;

  if (valueType === "ratio2") {
    if (rawUnit === "x100") return raw / 100;
    if (rawUnit === "x1000") return raw / 1000;
    return raw;
  }
  if (valueType === "ratio") {
    return key === "changePercent" ? raw / 100 : raw;
  }
  if (candidate?.unit === "%") return raw / 100;
  return Math.abs(raw) > 2 ? raw / 100 : raw;
};

const parseAnnualHistory = (
  payload: UnknownRecord,
): ProfitabilityHistoryPeriod[] => {
  const historyMetric = metric(payload, "earningsRevenueModule");
  const history = isRecord(historyMetric?.value)
    ? historyMetric.value
    : null;
  const data = history && Array.isArray(history.data) ? history.data : [];
  const quarterly = data
    .map(
      (
        candidate,
      ):
        | (ProfitabilityHistoryPeriod & {
            fiscalYear: string;
            isYearEnd: boolean;
          })
        | null => {
        if (!isRecord(candidate)) return null;
        const period =
          typeof candidate.end_date === "string"
            ? candidate.end_date
            : "";
        if (!period) return null;
        return {
          period,
          revenue: finiteNumber(candidate.operating_income_total),
          netIncome: finiteNumber(candidate.net_profit),
          fiscalYear: String(candidate.year ?? period.slice(0, 4)),
          isYearEnd: String(candidate.period ?? "") === "596006",
        };
      },
    )
    .filter(
      (
        period,
      ): period is ProfitabilityHistoryPeriod & {
        fiscalYear: string;
        isYearEnd: boolean;
      } => period !== null,
    )
    .sort((left, right) => left.period.localeCompare(right.period));

  const grouped = new Map<
    string,
    Array<
      ProfitabilityHistoryPeriod & {
        fiscalYear: string;
        isYearEnd: boolean;
      }
    >
  >();
  for (const period of quarterly) {
    const group = grouped.get(period.fiscalYear) ?? [];
    group.push(period);
    grouped.set(period.fiscalYear, group);
  }

  return [...grouped.entries()]
    .filter(
      ([, periods]) =>
        periods.length === 4 && periods.some((period) => period.isYearEnd),
    )
    .map(([year, periods]): ProfitabilityHistoryPeriod => ({
      period: `FY ${year}`,
      revenue: periods.every((period) => period.revenue !== null)
        ? periods.reduce(
            (total, period) => total + (period.revenue ?? 0),
            0,
          )
        : null,
      netIncome: periods.every((period) => period.netIncome !== null)
        ? periods.reduce(
            (total, period) => total + (period.netIncome ?? 0),
            0,
          )
        : null,
    }))
    .sort((left, right) => left.period.localeCompare(right.period))
    .slice(-6);
};

export function normalizeProfitabilitySnapshot(
  payload: unknown,
  exchange: string,
  symbol: string,
): ProfitabilitySnapshot {
  const raw = isRecord(payload) ? payload : {};
  const identity = isRecord(raw.identity) ? raw.identity : {};
  return {
    identity: {
      exchange: String(identity.exchange ?? exchange).toUpperCase(),
      symbol: String(identity.symbol ?? symbol).toUpperCase(),
      company:
        typeof identity.company === "string" && identity.company.trim()
          ? identity.company.trim()
          : null,
      currency:
        typeof identity.currency === "string" && identity.currency
          ? identity.currency
          : "USD",
    },
    quote: {
      price: metricNumber(raw, "price"),
      changePercent: metricRatio(raw, "changePercent"),
      marketCap: metricNumber(raw, "marketCap"),
    },
    metrics: {
      pastScore: metricNumber(raw, "pastScore"),
      grossMargin: metricRatio(raw, "grossMargin"),
      operatingMargin: metricRatio(raw, "operatingMargin"),
      netMargin: metricRatio(raw, "netMargin"),
      ebitMargin: metricRatio(raw, "ebitMargin"),
      ebitdaMargin: metricRatio(raw, "ebitdaMargin"),
      freeCashFlowMargin: metricRatio(raw, "freeCashFlowMargin"),
      returnOnEquity: metricRatio(raw, "roe"),
      returnOnAssets: metricRatio(raw, "roa"),
      returnOnInvestedCapital: metricRatio(raw, "roic"),
      assetTurnover: metricNumber(raw, "assetTurnover"),
      revenue: metricNumber(raw, "revenue"),
      grossProfit: metricNumber(raw, "grossProfit"),
      ebit: metricNumber(raw, "ebit"),
      ebitda: metricNumber(raw, "ebitda"),
      netIncome: metricNumber(raw, "netIncome"),
      freeCashFlow: metricNumber(raw, "freeCashFlow"),
      operatingCashFlow: metricNumber(raw, "operatingCashFlow"),
    },
    history: parseAnnualHistory(raw),
    asOf: typeof raw.asOf === "string" ? raw.asOf : null,
  };
}
