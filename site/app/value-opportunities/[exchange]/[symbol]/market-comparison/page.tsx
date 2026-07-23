import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ValueAnalysisClient from "@/components/security/ValueAnalysisClient";
import { resolveMarketCode } from "@/lib/market-codes";
import "../../../../security/analysis.css";

type PageProps = {
  params: Promise<{ exchange: string; symbol: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { exchange, symbol } = await params;
  const ticker = symbol.toUpperCase();
  return {
    title: `${ticker} Market comparison opportunity`,
    description: `Compare ${ticker}'s market expectations with similar companies to find relative value opportunities.`,
    alternates: {
      canonical: `/value-opportunities/${encodeURIComponent(exchange.toLowerCase())}/${encodeURIComponent(symbol.toLowerCase())}/market-comparison`,
    },
  };
}

export default async function MarketComparisonPage({ params }: PageProps) {
  const { exchange, symbol } = await params;
  if (!resolveMarketCode(exchange, symbol)) notFound();
  return (
    <ValueAnalysisClient
      key={`${exchange}:${symbol}:market-comparison`}
      exchange={exchange}
      symbol={symbol}
      mode="relative-value"
    />
  );
}
