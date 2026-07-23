import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import BusinessQualityClient from "@/components/security/business-quality/BusinessQualityClient";
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
    description: `Assess whether ${security.symbol}'s margins, cash conversion, and returns on capital can support a durable value opportunity.`,
    alternates: {
      canonical: `/value-opportunities/${encodeURIComponent(canonicalExchange)}/${encodeURIComponent(canonicalSymbol)}/business-quality`,
    },
  };
}

export default async function BusinessQualityOpportunityPage({
  params,
}: PageProps) {
  const { exchange, symbol } = await params;
  const security = resolveMarketCode(exchange, symbol);
  if (!security) notFound();

  const canonicalExchange = security.exchange.toLowerCase();
  const canonicalSymbol = security.symbol.toLowerCase();
  if (exchange !== canonicalExchange || symbol !== canonicalSymbol) {
    redirect(
      `/value-opportunities/${encodeURIComponent(canonicalExchange)}/${encodeURIComponent(canonicalSymbol)}/business-quality`,
    );
  }

  return (
    <BusinessQualityClient
      key={`${exchange}:${symbol}:business-quality`}
      exchange={exchange}
      symbol={symbol}
    />
  );
}
