import { z } from "zod";
import type { ScreenerFilters } from "./contracts";

const optionalFiniteNumber = z.preprocess(
  (value) => (value === "" || value == null ? undefined : value),
  z.coerce.number().finite().optional(),
);

export const screenerFiltersSchema = z
  .object({
    fairValueGtePrice: z.boolean().default(true),
    minMarketCap: optionalFiniteNumber,
    maxMarketCap: optionalFiniteNumber,
    minPrice: optionalFiniteNumber,
    maxPrice: optionalFiniteNumber,
    minChangePercent: optionalFiniteNumber,
    maxChangePercent: optionalFiniteNumber,
    minMispricing: optionalFiniteNumber,
    maxMispricing: optionalFiniteNumber,
    minPe: optionalFiniteNumber,
    maxPe: optionalFiniteNumber,
    minRevenueGrowth: optionalFiniteNumber,
    maxRevenueGrowth: optionalFiniteNumber,
    positiveNetIncome: z.boolean().optional(),
    positiveFreeCashFlow: z.boolean().optional(),
    minFreeCashFlowYield: optionalFiniteNumber,
    maxEvToEbitda: optionalFiniteNumber,
    minCashConversion: optionalFiniteNumber,
    minReturnOnInvestedCapital: optionalFiniteNumber,
    maxNetDebtToFreeCashFlow: optionalFiniteNumber,
    maxDebtToEquity: optionalFiniteNumber,
    stableOperatingMargins5Y: z.boolean().optional(),
    expandingOperatingMargins5Y: z.boolean().optional(),
    sector: z.string().trim().max(80).optional(),
    exchanges: z.array(z.string().trim().min(2).max(16)).max(10).optional(),
    symbols: z.array(z.string().trim().min(1).max(24)).max(100).optional(),
    query: z.string().trim().max(80).optional(),
    unsupported: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  })
  .refine(
    (value) =>
      value.minMarketCap == null ||
      value.maxMarketCap == null ||
      value.minMarketCap <= value.maxMarketCap,
    { message: "minMarketCap must not exceed maxMarketCap" },
  )
  .refine(
    (value) =>
      value.minPrice == null || value.maxPrice == null || value.minPrice <= value.maxPrice,
    { message: "minPrice must not exceed maxPrice" },
  )
  .refine(
    (value) =>
      value.minChangePercent == null ||
      value.maxChangePercent == null ||
      value.minChangePercent <= value.maxChangePercent,
    { message: "minChangePercent must not exceed maxChangePercent" },
  )
  .refine(
    (value) =>
      value.minMispricing == null ||
      value.maxMispricing == null ||
      value.minMispricing <= value.maxMispricing,
    { message: "minMispricing must not exceed maxMispricing" },
  )
  .refine(
    (value) => value.minPe == null || value.maxPe == null || value.minPe <= value.maxPe,
    { message: "minPe must not exceed maxPe" },
  )
  .refine(
    (value) =>
      value.minRevenueGrowth == null ||
      value.maxRevenueGrowth == null ||
      value.minRevenueGrowth <= value.maxRevenueGrowth,
    { message: "minRevenueGrowth must not exceed maxRevenueGrowth" },
  );

const screenerSortSchema = z.enum([
  "company",
  "symbol",
  "price",
  "changePercent",
  "marketCap",
  "fairValue",
  "mispricing",
  "pe",
  "revenueGrowth",
]);

const ALLOWED_COLUMNS = new Set([
  "company",
  "symbol",
  "price",
  "changePercent",
  "marketCap",
  "fairValue",
  "mispricing",
  "pe",
  "revenueGrowth",
]);
const DEFAULT_COLUMNS = [
  "company",
  "price",
  "changePercent",
  "marketCap",
  "fairValue",
  "mispricing",
  "pe",
  "revenueGrowth",
];
const REQUIRED_SCREENER_EXCHANGES = ["NASDAQ", "NYSE"];

function parseBoolean(value: string | null): boolean | undefined {
  if (value == null || value === "") return undefined;
  if (["1", "true", "yes"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no"].includes(value.toLowerCase())) return false;
  throw new Error("fairValueGtePrice must be a boolean");
}

type FilterDescriptor = {
  id?: unknown;
  field?: unknown;
  operator?: unknown;
  value?: unknown;
};

function descriptorNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapFilterDescriptors(descriptors: unknown[]): Record<string, unknown> {
  const result: Record<string, unknown> = { fairValueGtePrice: false };
  const unsupported: string[] = [];
  const assignRange = (
    descriptor: FilterDescriptor,
    minKey: string,
    maxKey: string,
    transform: (value: number) => number = (value) => value,
  ) => {
    const value = descriptorNumber(descriptor.value);
    if (value == null || typeof descriptor.operator !== "string") return false;
    const transformed = transform(value);
    if (descriptor.operator === "gt" || descriptor.operator === "gte") {
      result[minKey] = transformed;
      return true;
    }
    if (descriptor.operator === "lt" || descriptor.operator === "lte") {
      result[maxKey] = transformed;
      return true;
    }
    return false;
  };

  for (const candidate of descriptors) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      unsupported.push("invalid-filter");
      continue;
    }
    const descriptor = candidate as FilterDescriptor;
    const field = typeof descriptor.field === "string" ? descriptor.field : "unknown";
    const operator = typeof descriptor.operator === "string" ? descriptor.operator : "unknown";
    let supported = false;
    if (field === "fairValueToPrice") {
      const value = descriptorNumber(descriptor.value);
      if ((operator === "gte" || operator === "gt") && value != null) {
        result.fairValueGtePrice = value >= 1;
        if (value > 1) result.minMispricing = value - 1;
        supported = true;
      }
    } else if (field === "marketCap") {
      supported = assignRange(descriptor, "minMarketCap", "maxMarketCap");
    } else if (field === "price") {
      supported = assignRange(descriptor, "minPrice", "maxPrice");
    } else if (field === "change" || field === "changePercent") {
      supported = assignRange(descriptor, "minChangePercent", "maxChangePercent");
    } else if (field === "mispricing") {
      supported = assignRange(descriptor, "minMispricing", "maxMispricing");
    } else if (field === "pe") {
      supported = assignRange(descriptor, "minPe", "maxPe");
    } else if (field === "revenueGrowth") {
      supported = assignRange(
        descriptor,
        "minRevenueGrowth",
        "maxRevenueGrowth",
        (value) => (Math.abs(value) <= 1 ? value * 100 : value),
      );
    } else if (
      field === "netIncome" &&
      (operator === "gt" || operator === "gte") &&
      descriptorNumber(descriptor.value) === 0
    ) {
      result.positiveNetIncome = true;
      supported = true;
    } else if (
      field === "freeCashFlow" &&
      (operator === "gt" || operator === "gte") &&
      descriptorNumber(descriptor.value) === 0
    ) {
      result.positiveFreeCashFlow = true;
      supported = true;
    } else if (field === "freeCashFlowYield") {
      supported = assignRange(
        descriptor,
        "minFreeCashFlowYield",
        "maxFreeCashFlowYieldUnsupported",
      );
      delete result.maxFreeCashFlowYieldUnsupported;
      if (operator === "lt" || operator === "lte") supported = false;
    } else if (field === "evToEbitda") {
      supported = assignRange(
        descriptor,
        "minEvToEbitdaUnsupported",
        "maxEvToEbitda",
      );
      delete result.minEvToEbitdaUnsupported;
      if (operator === "gt" || operator === "gte") supported = false;
    } else if (field === "cashConversion") {
      supported = assignRange(
        descriptor,
        "minCashConversion",
        "maxCashConversionUnsupported",
      );
      delete result.maxCashConversionUnsupported;
      if (operator === "lt" || operator === "lte") supported = false;
    } else if (field === "returnOnInvestedCapital") {
      supported = assignRange(
        descriptor,
        "minReturnOnInvestedCapital",
        "maxReturnOnInvestedCapitalUnsupported",
        (value) => (Math.abs(value) <= 1 ? value * 100 : value),
      );
      delete result.maxReturnOnInvestedCapitalUnsupported;
      if (operator === "lt" || operator === "lte") supported = false;
    } else if (field === "netDebtToFreeCashFlow") {
      supported = assignRange(
        descriptor,
        "minNetDebtToFreeCashFlowUnsupported",
        "maxNetDebtToFreeCashFlow",
      );
      delete result.minNetDebtToFreeCashFlowUnsupported;
      if (operator === "gt" || operator === "gte") supported = false;
    } else if (field === "debtToEquity") {
      supported = assignRange(
        descriptor,
        "minDebtToEquityUnsupported",
        "maxDebtToEquity",
        (value) => (Math.abs(value) <= 1 ? value * 100 : value),
      );
      delete result.minDebtToEquityUnsupported;
      if (operator === "gt" || operator === "gte") supported = false;
    } else if (
      field === "marginStability5Y" &&
      operator === "eq" &&
      descriptor.value === true
    ) {
      result.stableOperatingMargins5Y = true;
      supported = true;
    } else if (
      field === "marginTrend" &&
      operator === "gt" &&
      descriptorNumber(descriptor.value) === 0
    ) {
      result.expandingOperatingMargins5Y = true;
      supported = true;
    } else if (field === "sector" && operator === "eq" && typeof descriptor.value === "string") {
      result.sector = descriptor.value;
      supported = true;
    } else if (field === "exchange" && operator === "in" && Array.isArray(descriptor.value)) {
      result.exchanges = descriptor.value.filter((item): item is string => typeof item === "string");
      supported = true;
    }
    if (!supported) unsupported.push(`${field}:${operator}`);
  }
  if (unsupported.length > 0) result.unsupported = unsupported;
  return result;
}

function parseFilterJson(value: string | null): Record<string, unknown> {
  if (!value) return {};
  const shorthand = value.toLowerCase();
  if (["undervalued", "fair-value", "fairvaluegteprice"].includes(shorthand)) {
    return { fairValueGtePrice: true };
  }
  if (["all", "none"].includes(shorthand)) return { fairValueGtePrice: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("filters must be valid JSON or a supported preset");
  }
  if (Array.isArray(parsed)) return mapFilterDescriptors(parsed);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("filters must be a JSON object or descriptor array");
  }
  return parsed as Record<string, unknown>;
}

function applyNaturalLanguagePreset(
  filters: Record<string, unknown>,
  preset: string | null,
): void {
  if (!preset) return;
  const normalized = preset.trim().toLowerCase();
  if (/all stocks|show all|without fair|overvalued/.test(normalized)) {
    filters.fairValueGtePrice = false;
  }
  if (/undervalued|fair value|margin of safety/.test(normalized)) {
    filters.fairValueGtePrice = true;
  }
  if (/mega[ -]?cap/.test(normalized)) filters.minMarketCap = 200_000_000_000;
  else if (/large[ -]?cap/.test(normalized)) filters.minMarketCap = 10_000_000_000;
  if (/gainer|positive momentum|up today/.test(normalized)) filters.minChangePercent = 0;
  if (/loser|down today/.test(normalized)) filters.maxChangePercent = 0;
}

export function parseScreenerSearchParams(searchParams: URLSearchParams) {
  const rawFilters = parseFilterJson(searchParams.get("filters"));
  applyNaturalLanguagePreset(
    rawFilters,
    searchParams.get("preset") ?? searchParams.get("q"),
  );

  const directFields: Array<keyof ScreenerFilters> = [
    "minMarketCap",
    "maxMarketCap",
    "minPrice",
    "maxPrice",
    "minChangePercent",
    "maxChangePercent",
    "minMispricing",
    "maxMispricing",
    "minPe",
    "maxPe",
    "minRevenueGrowth",
    "maxRevenueGrowth",
    "minFreeCashFlowYield",
    "maxEvToEbitda",
    "minCashConversion",
    "minReturnOnInvestedCapital",
    "maxNetDebtToFreeCashFlow",
    "maxDebtToEquity",
    "sector",
    "query",
  ];
  for (const field of directFields) {
    const value = searchParams.get(field);
    if (value != null && value !== "") rawFilters[field] = value;
  }
  const fairValueGtePrice = parseBoolean(searchParams.get("fairValueGtePrice"));
  if (fairValueGtePrice != null) rawFilters.fairValueGtePrice = fairValueGtePrice;
  const symbols = searchParams.get("symbols");
  if (symbols) rawFilters.symbols = symbols.split(",").map((symbol) => symbol.trim()).filter(Boolean);

  const columns = (searchParams.get("columns") ?? "")
    .split(",")
    .map((column) => column.trim())
    .filter((column) => ALLOWED_COLUMNS.has(column));
  const parsed = z
    .object({
      page: z.coerce.number().int().min(1).max(500).default(1),
      pageSize: z.coerce.number().int().min(1).max(1000).default(25),
      sort: screenerSortSchema.default("marketCap"),
      order: z.enum(["asc", "desc"]).default("desc"),
      filters: screenerFiltersSchema,
      columns: z.array(z.string()),
    })
    .parse({
      page: searchParams.get("page") || undefined,
      pageSize: searchParams.get("pageSize") || undefined,
      sort: searchParams.get("sort") || undefined,
      order: searchParams.get("order") || undefined,
      filters: rawFilters,
      columns: columns.length > 0 ? columns : DEFAULT_COLUMNS,
    });
  return {
    ...parsed,
    filters: {
      ...parsed.filters,
      exchanges: [...REQUIRED_SCREENER_EXCHANGES],
    },
  };
}

export const securityParamsSchema = z.object({
  exchange: z.string().trim().toLowerCase().min(2).max(16).regex(/^[a-z]+$/),
  symbol: z.string().trim().toUpperCase().min(1).max(24).regex(/^[A-Z0-9.-]+$/),
});

export const seriesQuerySchema = z.object({
  group: z.enum(["valuation", "price", "eps", "financials"]).default("valuation"),
  range: z.enum(["1m", "3m", "6m", "1y", "3y", "5y", "max"]).default("1y"),
  before: z.coerce.number().int().positive().max(8_640_000_000_000).optional(),
  limit: z.coerce.number().int().min(20).max(2000).optional(),
});

export const analysisQuerySchema = z.object({
  view: z.enum([
    "dcf-valuation",
    "relative-valuation",
    "profitability",
  ]),
});
