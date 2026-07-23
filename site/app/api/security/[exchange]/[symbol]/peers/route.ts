import { jsonResponse, routeError } from "../../../../../../lib/http";
import { resolveMarketCode } from "../../../../../../lib/market-codes";
import { getPeersResponse } from "../../../../../../lib/security/peers";
import { securityParamsSchema } from "../../../../../../lib/validation";

type RouteContext = {
  params: Promise<{ exchange: string; symbol: string }>;
};

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const params = securityParamsSchema.parse(await context.params);
    const resolved = resolveMarketCode(params.exchange, params.symbol);
    if (!resolved) {
      return jsonResponse(
        { error: "This exchange and symbol are not in the supported security catalog." },
        { status: 404 },
      );
    }
    return jsonResponse(await getPeersResponse(resolved), {
      cacheControl: "public, max-age=300, stale-while-revalidate=900",
    });
  } catch (error) {
    return routeError(error);
  }
}
