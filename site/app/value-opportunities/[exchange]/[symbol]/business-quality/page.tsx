import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BusinessQualityClient from "@/components/security/business-quality/BusinessQualityClient";
import { resolveMarketCode } from "@/lib/market-codes";
import "../../../../security/profitability.css";

type PageProps = {
  params: Promise<{ exchange: string; symbol: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { exchange, symbol } = await params;
  const ticker = symbol.toUpperCase();
  return {
    title: `${ticker} Business quality opportunity`,
    description: `Assess whether ${ticker}'s margins, cash conversion, and returns on capital can support a durable value opportunity.`,
    alternates: {
      canonical: `/value-opportunities/${encodeURIComponent(exchange.toLowerCase())}/${encodeURIComponent(symbol.toLowerCase())}/business-quality`,
    },
  };
}

export default async function BusinessQualityOpportunityPage({
  params,
}: PageProps) {
  const { exchange, symbol } = await params;
  if (!resolveMarketCode(exchange, symbol)) notFound();
  return (
    <BusinessQualityClient
      key={`${exchange}:${symbol}:business-quality`}
      exchange={exchange}
      symbol={symbol}
    />
  );
}
