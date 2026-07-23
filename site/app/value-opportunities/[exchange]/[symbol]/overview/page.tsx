import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import SecuritySummaryClient from "@/components/security/SecuritySummaryClient";
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
    description: `See where ${security.symbol}'s market price, estimated value, financial strength, and expectations may create an opportunity.`,
    alternates: {
      canonical: `/value-opportunities/${encodeURIComponent(canonicalExchange)}/${encodeURIComponent(canonicalSymbol)}/overview`,
    },
  };
}

export default async function OpportunityOverviewPage({ params }: PageProps) {
  const { exchange, symbol } = await params;
  const security = resolveMarketCode(exchange, symbol);
  if (!security) notFound();

  const canonicalExchange = security.exchange.toLowerCase();
  const canonicalSymbol = security.symbol.toLowerCase();
  if (exchange !== canonicalExchange || symbol !== canonicalSymbol) {
    redirect(
      `/value-opportunities/${encodeURIComponent(canonicalExchange)}/${encodeURIComponent(canonicalSymbol)}/overview`,
    );
  }

  return (
    <SecuritySummaryClient
      key={`${exchange}:${symbol}:overview`}
      exchange={exchange}
      symbol={symbol}
    />
  );
}
