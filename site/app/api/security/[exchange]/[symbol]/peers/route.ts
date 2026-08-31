import { jsonResponse, routeError } from "../../../../../../lib/http";
import {
  resolveMarketCode,
  supportsCompanyAnalysis,
  unsupportedCompanyAnalysisReason,
} from "../../../../../../lib/market-codes";
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
    return jsonResponse(await getPeersResponse(resolved), {
      cacheControl: "no-store",
    });
  } catch (error) {
    return routeError(error);
  }
}
