import { jsonResponse, routeError } from "@/lib/http";
import {
  resolveMarketCode,
  supportsCompanyAnalysis,
  unsupportedCompanyAnalysisReason,
} from "@/lib/market-codes";
import { getBusinessQualityResponse } from "@/lib/security/business-quality-service";
import { fallbackBusinessQuality } from "@/lib/security/fallback-business-quality";
import { securityFallbackSnapshot } from "@/lib/security/fallback-snapshot";
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
    if (!supportsCompanyAnalysis(resolved)) {
      return jsonResponse(
        {
          code: "UNSUPPORTED_SECURITY_TYPE",
          error: unsupportedCompanyAnalysisReason(resolved),
          retryable: false,
          securityType: resolved.securityType,
        },
        { status: 422 },
      );
    }
    try {
      return jsonResponse(await getBusinessQualityResponse(resolved), {
        cacheControl: "public, max-age=30, stale-while-revalidate=120",
      });
    } catch (error) {
      const snapshot = await securityFallbackSnapshot();
      if (!snapshot) throw error;
      return jsonResponse(fallbackBusinessQuality(resolved, snapshot), {
        cacheControl: "no-store",
      });
    }
  } catch (error) {
    return routeError(error);
  }
}
