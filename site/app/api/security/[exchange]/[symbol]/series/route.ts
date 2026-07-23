import { jsonResponse, routeError } from "../../../../../../lib/http";
import { resolveMarketCode } from "../../../../../../lib/market-codes";
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
    return jsonResponse(await getSeriesResponse(resolved, query.group, query.range), {
      cacheControl: "public, max-age=60, stale-while-revalidate=240",
    });
  } catch (error) {
    return routeError(error);
  }
}
