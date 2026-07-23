import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import ValueAnalysisClient from "@/components/security/ValueAnalysisClient";
import { resolveMarketCode } from "@/lib/market-codes";

type PageProps = {
  params: Promise<{ exchange: string; symbol: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { exchange, symbol } = await params;
  const security = resolveMarketCode(exchange, symbol);
  if (!security) return {};

  const canonicalExchange = security.exchange.toLowerCase();
  const canonicalSymbol = security.symbol.toLowerCase();
  return {
    description: `Compare ${security.symbol}'s market expectations with similar companies to find relative value opportunities.`,
    alternates: {
      canonical: `/value-opportunities/${encodeURIComponent(canonicalExchange)}/${encodeURIComponent(canonicalSymbol)}/market-comparison`,
    },
  };
}

export default async function MarketComparisonPage({ params }: PageProps) {
  const { exchange, symbol } = await params;
  const security = resolveMarketCode(exchange, symbol);
  if (!security) notFound();

  const canonicalExchange = security.exchange.toLowerCase();
  const canonicalSymbol = security.symbol.toLowerCase();
  if (exchange !== canonicalExchange || symbol !== canonicalSymbol) {
    redirect(
      `/value-opportunities/${encodeURIComponent(canonicalExchange)}/${encodeURIComponent(canonicalSymbol)}/market-comparison`,
    );
  }

  return (
    <ValueAnalysisClient
      key={`${exchange}:${symbol}:market-comparison`}
      exchange={exchange}
      symbol={symbol}
      mode="relative-value"
    />
  );
}
