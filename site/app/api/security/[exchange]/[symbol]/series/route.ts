import { jsonResponse, routeError } from "../../../../../../lib/http";
import { resolveMarketCode } from "../../../../../../lib/market-codes";
import { securityFallbackSnapshot } from "../../../../../../lib/security/fallback-snapshot";
import { snapshotRowForSecurity } from "../../../../../../lib/security/screener-fallback";
import { getSeriesResponse } from "../../../../../../lib/security/series";
import {
  securityParamsSchema,
  seriesQuerySchema,
} from "../../../../../../lib/validation";

type RouteContext = {
  params: Promise<{ exchange: string; symbol: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const params = securityParamsSchema.parse(await context.params);
    const query = seriesQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    const resolved = resolveMarketCode(params.exchange, params.symbol);
    if (!resolved) {
      return jsonResponse(
        { error: "This exchange and symbol are not in the supported security catalog." },
        { status: 404 },
      );
    }
    try {
      return jsonResponse(await getSeriesResponse(resolved, query.group, query.range), {
        cacheControl: "public, max-age=60, stale-while-revalidate=240",
      });
    } catch (error) {
      const snapshot = await securityFallbackSnapshot();
      const row = snapshot ? snapshotRowForSecurity(snapshot, resolved) : null;
      if (!snapshot || !row) throw error;
      return jsonResponse({
        symbol: resolved.symbol,
        marketCode: resolved.marketCode,
        group: query.group,
        range: query.range,
        series: [],
        source: "derived",
        asOf: snapshot.asOf,
        reason: "Detailed historical data is temporarily unavailable; stored snapshot values remain available on the overview.",
      }, { cacheControl: "no-store" });
    }
  } catch (error) {
    return routeError(error);
  }
}
