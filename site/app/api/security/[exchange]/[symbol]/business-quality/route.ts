import { jsonResponse, routeError } from "@/lib/http";
import { resolveMarketCode } from "@/lib/market-codes";
import { getBusinessQualityResponse } from "@/lib/security/business-quality-service";
import { securityParamsSchema } from "@/lib/validation";

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
        {
          error:
            "This exchange and symbol are not in the supported security catalog.",
        },
        { status: 404 },
      );
    }
    return jsonResponse(await getBusinessQualityResponse(resolved), {
      cacheControl: "public, max-age=30, stale-while-revalidate=120",
    });
  } catch (error) {
    return routeError(error);
  }
}
