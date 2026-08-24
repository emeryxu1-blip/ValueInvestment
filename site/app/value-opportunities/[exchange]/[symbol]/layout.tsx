import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SecurityResearchShell from "@/components/security/SecurityResearchShell";
import { resolveMarketCode } from "@/lib/market-codes";
import "../../../security/security.css";
import "../../../security/analysis.css";
import "../../../security/profitability.css";
import "../../../security/research-shell.css";

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ exchange: string; symbol: string }>;
};

export async function generateMetadata({
  params,
}: Omit<LayoutProps, "children">): Promise<Metadata> {
  const { exchange, symbol } = await params;
  const security = resolveMarketCode(exchange, symbol);
  if (!security) return { title: "Value opportunity" };

  return {
    title: `${security.symbol} Value opportunity overview`,
    description: `Research ${security.companyName} across price, cash-flow value, market expectations, and business quality.`,
  };
}

export default async function SecurityResearchLayout({
  children,
  params,
}: LayoutProps) {
  const { exchange, symbol } = await params;
  const security = resolveMarketCode(exchange, symbol);
  if (!security) notFound();

  return (
    <SecurityResearchShell
      exchange={security.exchange.toUpperCase()}
      symbol={security.symbol}
      companyName={security.companyName}
    >
      {children}
    </SecurityResearchShell>
  );
}
