import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SecuritySummaryClient from "@/components/security/SecuritySummaryClient";
import { resolveMarketCode } from "@/lib/market-codes";
import "../../../../security/security.css";

type PageProps = {
  params: Promise<{ exchange: string; symbol: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { exchange, symbol } = await params;
  const ticker = symbol.toUpperCase();
  return {
    title: `${ticker} Value opportunity overview`,
    description: `See where ${ticker}'s market price, estimated value, financial strength, and expectations may create an opportunity.`,
    alternates: {
      canonical: `/value-opportunities/${encodeURIComponent(exchange.toLowerCase())}/${encodeURIComponent(symbol.toLowerCase())}/overview`,
    },
  };
}

export default async function OpportunityOverviewPage({ params }: PageProps) {
  const { exchange, symbol } = await params;
  if (!resolveMarketCode(exchange, symbol)) notFound();
  return (
    <SecuritySummaryClient
      key={`${exchange}:${symbol}:overview`}
      exchange={exchange}
      symbol={symbol}
    />
  );
}
