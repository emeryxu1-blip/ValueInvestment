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
    title: `${ticker} Cash-flow value opportunity`,
    description: `Estimate what ${ticker}'s future cash generation may be worth today and test the margin of safety.`,
    alternates: {
      canonical: `/value-opportunities/${encodeURIComponent(exchange.toLowerCase())}/${encodeURIComponent(symbol.toLowerCase())}/cash-flow`,
    },
  };
}

export default async function CashFlowOpportunityPage({ params }: PageProps) {
  const { exchange, symbol } = await params;
  if (!resolveMarketCode(exchange, symbol)) notFound();
  return (
    <ValueAnalysisClient
      key={`${exchange}:${symbol}:cash-flow`}
      exchange={exchange}
      symbol={symbol}
      mode="cash-flow-value"
    />
  );
}
