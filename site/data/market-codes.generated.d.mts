export type GeneratedMarketCodeEntry = readonly [
  marketCode: string,
  companyName: string,
  securityType: string,
];
export const MARKET_CODE_CATALOG_AS_OF: string;
export const MARKET_CODE_CATALOG_GENERATED_AT: string;
export const MARKET_CODE_BY_ROUTE: Readonly<Record<string, GeneratedMarketCodeEntry>>;
export const ROUTES_BY_SYMBOL: Readonly<Record<string, readonly string[]>>;
