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
    description: `Estimate what ${security.symbol}'s future cash generation may be worth today and test the margin of safety.`,
    alternates: {
      canonical: `/value-opportunities/${encodeURIComponent(canonicalExchange)}/${encodeURIComponent(canonicalSymbol)}/cash-flow`,
    },
  };
}

export default async function CashFlowOpportunityPage({ params }: PageProps) {
  const { exchange, symbol } = await params;
  const security = resolveMarketCode(exchange, symbol);
  if (!security) notFound();

  const canonicalExchange = security.exchange.toLowerCase();
  const canonicalSymbol = security.symbol.toLowerCase();
  if (exchange !== canonicalExchange || symbol !== canonicalSymbol) {
    redirect(
      `/value-opportunities/${encodeURIComponent(canonicalExchange)}/${encodeURIComponent(canonicalSymbol)}/cash-flow`,
    );
  }

  return (
    <ValueAnalysisClient
      key={`${exchange}:${symbol}:cash-flow`}
      exchange={exchange}
      symbol={symbol}
      mode="cash-flow-value"
    />
  );
}
