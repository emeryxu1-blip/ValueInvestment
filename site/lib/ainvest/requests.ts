import type {
  ScreenerSort,
  SecurityAnalysisView,
  SortOrder,
} from "../contracts";

export type IndicatorRequest = {
  id: string;
  req_unique_id: string;
  attr?: Record<string, unknown>;
};

export const SCREENER_INDICATORS: IndicatorRequest[] = [
  { id: "55", req_unique_id: "company" },
  {
    id: "10",
    req_unique_id: "price",
    attr: { trade_class: "intraday" },
  },
  {
    id: "inr-price_change_ratio_pct-sum",
    req_unique_id: "changePercent",
    attr: { trade_class: "intraday", time_period: "day_1" },
  },
  { id: "total_market_value", req_unique_id: "marketCap" },
  {
    id: "stockdiag_fundamental_value_dcf",
    req_unique_id: "fairValueModule",
  },
  { id: "pe_ttm", req_unique_id: "pe" },
  {
    id: "operating_income_total_ttm_yoy",
    req_unique_id: "revenueGrowth",
  },
  { id: "parent_holder_net_profit_ttm", req_unique_id: "netIncome" },
  { id: "free_cash_flow_ttm", req_unique_id: "freeCashFlow" },
  { id: "debt_equity_ratio", req_unique_id: "debtToEquity" },
  { id: "ext_metric_sector_1_name", req_unique_id: "sector" },
];

const SCREENER_SORT_POSITION: Partial<Record<ScreenerSort, number>> = {
  company: 0,
  price: 1,
  changePercent: 2,
  marketCap: 3,
  fairValue: 4,
  pe: 5,
  revenueGrowth: 6,
};

export function buildScreenerSnapshotRequest(options: {
  begin: number;
  count: number;
  sort?: ScreenerSort;
  order?: SortOrder;
  fullSymbols?: boolean;
}) {
  const position = SCREENER_SORT_POSITION[options.sort ?? "marketCap"] ?? 3;
  return {
    symbol: [{ type: "block_id", value: ["C191"] }],
    indicator: SCREENER_INDICATORS,
    sort: [{ pos: position, order: options.order ?? "desc" }],
    page: { begin: options.begin, count: Math.min(1000, options.count) },
    ...(options.fullSymbols ? { full_symbols: true } : {}),
    res_symbol_type: "market_code",
  };
}

export function buildScreenerQuoteRequest(marketCodes: string[]) {
  const values = marketCodes.slice(0, 1000);
  return {
    symbol: [{ type: "market_code", value: values }],
    indicator: [
      {
        id: "10",
        req_unique_id: "price",
        attr: { trade_class: "intraday" },
      },
      {
        id: "inr-price_change_ratio_pct-sum",
        req_unique_id: "changePercent",
        attr: { trade_class: "intraday", time_period: "day_1" },
      },
      { id: "total_market_value", req_unique_id: "marketCap" },
    ],
    page: { begin: 0, count: values.length },
    res_symbol_type: "market_code",
  };
}

export const SECURITY_INDICATORS: IndicatorRequest[] = [
  { id: "55", req_unique_id: "company" },
  { id: "10", req_unique_id: "price", attr: { trade_class: "intraday" } },
  {
    id: "inr-price_change_ratio_pct-sum",
    req_unique_id: "changePercent",
    attr: { trade_class: "intraday", time_period: "day_1" },
  },
  { id: "total_market_value", req_unique_id: "marketCap" },
  { id: "6", req_unique_id: "previousClose", attr: { trade_class: "intraday" } },
  { id: "8", req_unique_id: "dayHigh", attr: { trade_class: "intraday" } },
  { id: "9", req_unique_id: "dayLow", attr: { trade_class: "intraday" } },
  {
    id: "stockdiag_fundamental_value_dcf",
    req_unique_id: "fairValueModule",
  },
  { id: "stockdiag_fundamental_past_score", req_unique_id: "pastScore" },
  { id: "stockdiag_fundamental_health_score", req_unique_id: "healthScore" },
  { id: "stockdiag_fundamental_future_score", req_unique_id: "futureScore" },
  { id: "pe_ttm", req_unique_id: "pe" },
  { id: "pb_mrq", req_unique_id: "pb" },
  { id: "ps_ttm", req_unique_id: "ps" },
  { id: "eps_ttm", req_unique_id: "eps" },
  { id: "operating_income_total_ttm", req_unique_id: "revenue" },
  { id: "parent_holder_net_profit_ttm", req_unique_id: "netIncome" },
  { id: "free_cash_flow_ttm", req_unique_id: "freeCashFlow" },
  { id: "debt", req_unique_id: "debt" },
  {
    id: "cash_equivalents_short_term_investments",
    req_unique_id: "cash",
  },
  { id: "annualized_roe", req_unique_id: "roe" },
  {
    id: "operating_income_total_ttm_yoy",
    req_unique_id: "revenueGrowth",
  },
  { id: "balanced_eps_ttm_yoy", req_unique_id: "earningsGrowth" },
  { id: "dividend_ratio_pct_ttm", req_unique_id: "dividendYield" },
  { id: "debt_equity_ratio", req_unique_id: "debtToEquity" },
  { id: "ext_metric_sector_1_name", req_unique_id: "sector" },
  { id: "ext_metric_sector_4_name", req_unique_id: "industry" },
  { id: "ext_metric_sector_4_code", req_unique_id: "sectorCode" },
  { id: "fundAnalystBuyNum", req_unique_id: "analystBuy" },
  { id: "fundAnalystHoldNum", req_unique_id: "analystHold" },
  { id: "fundAnalystSellNum", req_unique_id: "analystSell" },
  { id: "analyst_rating_newest", req_unique_id: "analystRating" },
  {
    id: "stockdiag_fundamental_past_earningsrevenue",
    req_unique_id: "earningsRevenueModule",
  },
  {
    id: "stockdiag_fundamental_dividend_stability",
    req_unique_id: "dividendStabilityModule",
  },
  {
    id: "stockdiag_fundamental_future_growthforecast",
    req_unique_id: "growthForecastModule",
  },
];

export function buildSecuritySnapshotRequest(marketCode: string) {
  return {
    symbol: [{ type: "market_code", value: [marketCode] }],
    indicator: SECURITY_INDICATORS,
    page: { begin: 0, count: 1 },
    res_symbol_type: "market_code",
  };
}

const ANALYSIS_COMMON_INDICATORS: IndicatorRequest[] = [
  { id: "55", req_unique_id: "company" },
  { id: "10", req_unique_id: "price", attr: { trade_class: "intraday" } },
  {
    id: "inr-price_change_ratio_pct-sum",
    req_unique_id: "changePercent",
    attr: { trade_class: "intraday", time_period: "day_1" },
  },
  { id: "total_market_value", req_unique_id: "marketCap" },
  { id: "ext_metric_sector_1_name", req_unique_id: "sector" },
  { id: "ext_metric_sector_4_name", req_unique_id: "industry" },
  { id: "ext_metric_sector_4_code", req_unique_id: "sectorCode" },
];

const DCF_ANALYSIS_INDICATORS: IndicatorRequest[] = [
  {
    id: "stockdiag_fundamental_value_dcf",
    req_unique_id: "fairValueModule",
  },
  { id: "operating_income_total_ttm", req_unique_id: "revenue" },
  { id: "parent_holder_net_profit_ttm", req_unique_id: "netIncome" },
  { id: "free_cash_flow_ttm", req_unique_id: "freeCashFlow" },
  { id: "act_cash_flow_net_ttm", req_unique_id: "operatingCashFlow" },
  { id: "debt", req_unique_id: "debt" },
  {
    id: "cash_equivalents_short_term_investments",
    req_unique_id: "cash",
  },
  { id: "total_capital", req_unique_id: "sharesOutstanding" },
  { id: "eps_ttm", req_unique_id: "eps" },
  {
    id: "stockdiag_fundamental_past_earningsrevenue",
    req_unique_id: "earningsRevenueModule",
  },
];

const RELATIVE_ANALYSIS_INDICATORS: IndicatorRequest[] = [
  { id: "pe_ttm", req_unique_id: "pe" },
  { id: "pb_mrq", req_unique_id: "pb" },
  { id: "ps_ttm", req_unique_id: "ps" },
  { id: "pcf_ttm", req_unique_id: "pcf" },
  { id: "pfcf_ttm", req_unique_id: "pfcf" },
  { id: "peg_ttm", req_unique_id: "peg" },
  { id: "ev", req_unique_id: "enterpriseValue" },
  { id: "ev_ebitda_ratio_ttm", req_unique_id: "evEbitda" },
  { id: "ev_ebit_ratio_ttm", req_unique_id: "evEbit" },
  { id: "ev_revenue_ratio_ttm", req_unique_id: "evRevenue" },
  { id: "ev_fcf_ratio_ttm", req_unique_id: "evFcf" },
  { id: "eps_ttm", req_unique_id: "eps" },
  { id: "per_net_assets_latest", req_unique_id: "bookValuePerShare" },
  { id: "operating_income_total_ttm", req_unique_id: "revenue" },
  { id: "ebitda_ttm", req_unique_id: "ebitda" },
  { id: "ebit_ttm", req_unique_id: "ebit" },
  { id: "free_cash_flow_ttm", req_unique_id: "freeCashFlow" },
  { id: "total_capital", req_unique_id: "sharesOutstanding" },
];

const PROFITABILITY_ANALYSIS_INDICATORS: IndicatorRequest[] = [
  { id: "stockdiag_fundamental_past_score", req_unique_id: "pastScore" },
  { id: "sale_gross_margin_ttm", req_unique_id: "grossMargin" },
  {
    id: "operating_profit_divide_income_total_ttm",
    req_unique_id: "operatingMargin",
  },
  { id: "sale_net_interest_ratio_ttm", req_unique_id: "netMargin" },
  { id: "ebit_margin_ttm", req_unique_id: "ebitMargin" },
  { id: "ebitda_margin_ttm", req_unique_id: "ebitdaMargin" },
  { id: "free_cash_flow_margin_ttm", req_unique_id: "freeCashFlowMargin" },
  { id: "index_weighted_avg_roe_ttm", req_unique_id: "roe" },
  { id: "total_assets_return_ratio_ttm", req_unique_id: "roa" },
  {
    id: "capital_invested_return_ratio_ttm",
    req_unique_id: "roic",
  },
  {
    id: "total_assets_turnover_ratio_ttm",
    req_unique_id: "assetTurnover",
  },
  { id: "operating_income_total_ttm", req_unique_id: "revenue" },
  { id: "gross_profit_ttm", req_unique_id: "grossProfit" },
  { id: "ebit_ttm", req_unique_id: "ebit" },
  { id: "ebitda_ttm", req_unique_id: "ebitda" },
  { id: "parent_holder_net_profit_ttm", req_unique_id: "netIncome" },
  { id: "free_cash_flow_ttm", req_unique_id: "freeCashFlow" },
  { id: "act_cash_flow_net_ttm", req_unique_id: "operatingCashFlow" },
  {
    id: "stockdiag_fundamental_past_earningsrevenue",
    req_unique_id: "earningsRevenueModule",
  },
  {
    id: "stockdiag_fundamental_past_revenuebreakdown",
    req_unique_id: "revenueBreakdownModule",
  },
];

const ANALYSIS_INDICATORS: Record<
  SecurityAnalysisView,
  IndicatorRequest[]
> = {
  "dcf-valuation": DCF_ANALYSIS_INDICATORS,
  "relative-valuation": RELATIVE_ANALYSIS_INDICATORS,
  profitability: PROFITABILITY_ANALYSIS_INDICATORS,
};

export function buildSecurityAnalysisRequest(
  marketCode: string,
  view: SecurityAnalysisView,
) {
  return {
    symbol: [{ type: "market_code", value: [marketCode] }],
    indicator: [...ANALYSIS_COMMON_INDICATORS, ...ANALYSIS_INDICATORS[view]],
    page: { begin: 0, count: 1 },
    res_symbol_type: "market_code",
  };
}

export function buildAnalysisPeerSnapshotRequest(marketCodes: string[]) {
  const values = marketCodes.slice(0, 8);
  return {
    symbol: [{ type: "market_code", value: values }],
    indicator: [
      { id: "55", req_unique_id: "company" },
      { id: "10", req_unique_id: "price", attr: { trade_class: "intraday" } },
      { id: "total_market_value", req_unique_id: "marketCap" },
      ...RELATIVE_ANALYSIS_INDICATORS,
    ],
    page: { begin: 0, count: values.length },
    res_symbol_type: "market_code",
  };
}

export function buildPeerSnapshotRequest(marketCodes: string[]) {
  return {
    symbol: [{ type: "market_code", value: marketCodes.slice(0, 12) }],
    indicator: [
      { id: "55", req_unique_id: "company" },
      { id: "10", req_unique_id: "price", attr: { trade_class: "intraday" } },
      { id: "total_market_value", req_unique_id: "marketCap" },
      { id: "pe_ttm", req_unique_id: "pe" },
      { id: "pb_mrq", req_unique_id: "pb" },
      { id: "ps_ttm", req_unique_id: "ps" },
    ],
    page: { begin: 0, count: Math.min(12, marketCodes.length) },
    res_symbol_type: "market_code",
  };
}

export function buildRelationRequest(sectorCode: string) {
  return {
    relation: "component",
    symbol: sectorCode,
    symbol_type: "market_code",
    page: { begin: 0, count: 12 },
  };
}

const RANGE_COUNTS: Record<string, number> = {
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "1y": 260,
  "3y": 780,
  "5y": 1300,
  max: 2000,
};

export function pointsForRange(range: string): number {
  return RANGE_COUNTS[range] ?? RANGE_COUNTS["1y"];
}

export function buildSeriesRequest(
  marketCode: string,
  group: string,
  range: string,
) {
  const count = pointsForRange(range);
  const quarterly = group === "eps" || group === "financials" || group === "targets";
  const timePeriod = quarterly ? "quarter" : "day_1";
  const indicators: Record<string, IndicatorRequest[]> = {
    price: [
      {
        id: "10",
        req_unique_id: "price",
        attr: { time_period: "day_1", trade_class: "intraday" },
      },
    ],
    eps: [
      {
        id: "balanced_eps_ttm",
        req_unique_id: "eps",
        attr: { time_period: "quarter" },
      },
    ],
    financials: [
      {
        id: "operating_income_total_ttm",
        req_unique_id: "revenue",
        attr: { time_period: "quarter" },
      },
      {
        id: "parent_holder_net_profit_ttm",
        req_unique_id: "netIncome",
        attr: { time_period: "quarter" },
      },
      {
        id: "free_cash_flow_ttm",
        req_unique_id: "freeCashFlow",
        attr: { time_period: "quarter" },
      },
    ],
    targets: [
      {
        id: "analyst_target_price_latest",
        req_unique_id: "target",
        attr: { time_period: "quarter" },
      },
    ],
  };
  return {
    symbol: { type: "market_code", value: [marketCode] },
    indicator: indicators[group] ?? indicators.price,
    time_range: {
      type: "end_count",
      end_time: 0,
      count: Math.min(2000, count),
      time_period: timePeriod,
    },
  };
}

export function buildMultiKlineRequest(marketCode: string, range: string) {
  const separator = marketCode.indexOf(":");
  const market = separator >= 0 ? marketCode.slice(0, separator) : "";
  const code = separator >= 0 ? marketCode.slice(separator + 1) : marketCode;
  return {
    code_list: [{ market, codes: [code] }],
    trade_class: "intraday",
    time_period: "day_1",
    time_range: {
      count: Math.min(2000, pointsForRange(range)),
      end_time: 0,
    },
    adjust_type: "forward",
  };
}
