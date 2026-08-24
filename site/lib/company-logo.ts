const COMPANY_LOGO_BASE_URL = "https://cdn.ainvest.com/icon/us";

export function companyLogoUrl(symbol: string): string | null {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return null;
  return `${COMPANY_LOGO_BASE_URL}/${encodeURIComponent(normalized)}.png`;
}
