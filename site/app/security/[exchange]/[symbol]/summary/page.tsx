import { redirect } from "next/navigation";

export default async function LegacySecuritySummaryPage({
  params,
}: {
  params: Promise<{ exchange: string; symbol: string }>;
}) {
  const { exchange, symbol } = await params;
  redirect(
    `/value-opportunities/${encodeURIComponent(exchange.toLowerCase())}/${encodeURIComponent(symbol.toLowerCase())}/overview`,
  );
}
