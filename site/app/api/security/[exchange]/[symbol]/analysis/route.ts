import { jsonResponse, routeError } from "../../../../../../lib/http";
import {
  resolveMarketCode,
  supportsCompanyAnalysis,
  unsupportedCompanyAnalysisReason,
} from "../../../../../../lib/market-codes";
import { getSecurityAnalysis } from "../../../../../../lib/security/analysis";
import {
  analysisQuerySchema,
  securityParamsSchema,
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
    const query = analysisQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
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
    return jsonResponse(await getSecurityAnalysis(resolved, query.view), {
      cacheControl: "no-store",
    });
  } catch (error) {
    return routeError(error);
  }
}
