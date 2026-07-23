import { redirect } from "next/navigation";

export default async function LegacyDcfValuePage({
  params,
}: {
  params: Promise<{ exchange: string; symbol: string }>;
}) {
  const { exchange, symbol } = await params;
  redirect(
    `/value-opportunities/${encodeURIComponent(exchange.toLowerCase())}/${encodeURIComponent(symbol.toLowerCase())}/cash-flow`,
  );
}
