import { getD1 } from "../../../../../db";
import { runDailyScreenerSnapshotRefresh } from "../../../../../lib/screener/daily-refresh";
import { isUsEquityTradingDay } from "../../../../../lib/market-calendar";
import { refreshTopMarketCapUniverse } from "../../../../../lib/screener/universe";

function localOnly(): Response | null {
  return process.env.NODE_ENV === "development"
    ? null
    : Response.json({ code: "NOT_FOUND", error: "Not found." }, { status: 404 });
}

function tradingDate(value: string | null): string {
  const candidate = value ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate) || !isUsEquityTradingDay(candidate)) {
    throw new Error("Provide a US trading date with ?date=YYYY-MM-DD.");
  }
  return candidate;
}

export async function POST(request: Request): Promise<Response> {
  const unavailable = localOnly();
  if (unavailable) return unavailable;

  try {
    const date = tradingDate(new URL(request.url).searchParams.get("date"));
    const db = await getD1();
    await refreshTopMarketCapUniverse(db);
    const result = await runDailyScreenerSnapshotRefresh(db, date, {
      scheduledAt: Date.now(),
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Local screener seed failed.",
      },
      { status: 500 },
    );
  }
}
