import { jsonResponse, routeError } from "../../../../../../lib/http";
import {
  resolveMarketCode,
  supportsCompanyAnalysis,
  unsupportedCompanyAnalysisReason,
} from "../../../../../../lib/market-codes";
import { getPeersResponse } from "../../../../../../lib/security/peers";
import { securityFallbackSnapshot } from "../../../../../../lib/security/fallback-snapshot";
import { snapshotRowForSecurity } from "../../../../../../lib/security/screener-fallback";
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
    try {
      return jsonResponse(await getPeersResponse(resolved), {
        cacheControl: "public, max-age=300, stale-while-revalidate=900",
      });
    } catch (error) {
      const snapshot = await securityFallbackSnapshot();
      const row = snapshot ? snapshotRowForSecurity(snapshot, resolved) : null;
      if (!snapshot || !row) throw error;
      return jsonResponse({
        symbol: resolved.symbol,
        marketCode: resolved.marketCode,
        peers: [],
        medians: {
          pe: { value: null, source: "derived", asOf: snapshot.asOf, reason: "Peer data is temporarily unavailable." },
          pb: { value: null, source: "derived", asOf: snapshot.asOf, reason: "Peer data is temporarily unavailable." },
          ps: { value: null, source: "derived", asOf: snapshot.asOf, reason: "Peer data is temporarily unavailable." },
        },
        peerValue: { value: null, source: "derived", asOf: snapshot.asOf, reason: "Peer data is temporarily unavailable." },
        selectionReason: "Peer data is temporarily unavailable.",
        source: "derived",
        asOf: snapshot.asOf,
      }, { cacheControl: "no-store" });
    }
  } catch (error) {
    return routeError(error);
  }
}
