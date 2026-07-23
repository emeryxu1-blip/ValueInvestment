import {
  MARKET_CODE_BY_ROUTE,
  MARKET_CODE_CATALOG_AS_OF,
  ROUTES_BY_SYMBOL,
} from "../data/market-codes.generated.mjs";

export type ResolvedSecurity = {
  exchange: string;
  symbol: string;
  marketCode: string;
  companyName: string;
  securityType: string;
  catalogAsOf: string;
};

const EXCHANGE_ALIASES: Record<string, string> = {
  amex: "amex",
  arca: "arca",
  bats: "cboe",
  cboe: "cboe",
  nasdaq: "nasdaq",
  nasdaqcm: "nasdaq",
  nasdaqgs: "nasdaq",
  nasdaqgm: "nasdaq",
  nyse: "nyse",
};

export function normalizeExchange(exchange: string): string | null {
  return EXCHANGE_ALIASES[exchange.trim().toLowerCase()] ?? null;
}

export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function resolveMarketCode(
  exchange: string,
  symbol: string,
): ResolvedSecurity | null {
  const normalizedExchange = normalizeExchange(exchange);
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedExchange || !normalizedSymbol) return null;

  const entry = MARKET_CODE_BY_ROUTE[`${normalizedExchange}:${normalizedSymbol}`];
  if (!entry) return null;
  return {
    exchange: normalizedExchange,
    symbol: normalizedSymbol,
    marketCode: entry[0],
    companyName: entry[1],
    securityType: entry[2],
    catalogAsOf: MARKET_CODE_CATALOG_AS_OF,
  };
}

export function resolveUniqueSymbol(symbol: string): ResolvedSecurity | null {
  const normalizedSymbol = normalizeSymbol(symbol);
  const routes = ROUTES_BY_SYMBOL[normalizedSymbol] ?? [];
  if (routes.length !== 1) return null;
  const [exchange] = routes[0].split(":", 1);
  return resolveMarketCode(exchange, normalizedSymbol);
}

export function routeExchangeForMarketCode(marketCode: string): string {
  const separator = marketCode.indexOf(":");
  const market = separator >= 0 ? marketCode.slice(0, separator) : "";
  const symbol = separator >= 0 ? marketCode.slice(separator + 1) : marketCode;
  if (market === "185" || market === "186") return "nasdaq";
  if (market === "170") return "amex";
  if (market === "171") return "cboe";
  const route = (ROUTES_BY_SYMBOL[normalizeSymbol(symbol)] ?? []).find(
    (candidate) => MARKET_CODE_BY_ROUTE[candidate]?.[0] === marketCode,
  );
  return route?.split(":", 1)[0] ?? "nyse";
}

export function symbolFromMarketCode(marketCode: string): string {
  const separator = marketCode.indexOf(":");
  return normalizeSymbol(separator >= 0 ? marketCode.slice(separator + 1) : marketCode);
}

export function catalogEntryForMarketCode(
  marketCode: string,
): ResolvedSecurity | null {
  const symbol = symbolFromMarketCode(marketCode);
  for (const route of ROUTES_BY_SYMBOL[symbol] ?? []) {
    const entry = MARKET_CODE_BY_ROUTE[route];
    if (entry?.[0] === marketCode) {
      const [exchange] = route.split(":", 1);
      return {
        exchange,
        symbol,
        marketCode,
        companyName: entry[1],
        securityType: entry[2],
        catalogAsOf: MARKET_CODE_CATALOG_AS_OF,
      };
    }
  }
  return null;
}
