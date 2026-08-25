import { getD1 } from "../../../../../../db";
import { jsonResponse, routeError } from "../../../../../../lib/http";
import { resolveMarketCode } from "../../../../../../lib/market-codes";
import { getSecuritySummary } from "../../../../../../lib/security/service";
import { readScreenerClientSnapshot } from "../../../../../../lib/screener/snapshot";
import type { ScreenerClientSnapshotPayload } from "../../../../../../lib/screener/client-snapshot-contract";
import { securityParamsSchema } from "../../../../../../lib/validation";

type RouteContext = {
  params: Promise<{ exchange: string; symbol: string }>;
};

async function localFallbackSnapshot(): Promise<ScreenerClientSnapshotPayload | undefined> {
  if (process.env.NODE_ENV !== "development") return undefined;
  try {
    const raw = await import("node:fs/promises").then(({ readFile }) =>
      readFile(".local/screener-snapshot.json", "utf8"),
    );
    return JSON.parse(raw) as ScreenerClientSnapshotPayload;
  } catch {
    return undefined;
  }
}

async function snapshotFromD1(): Promise<ScreenerClientSnapshotPayload | undefined> {
  try {
    const snapshot = await readScreenerClientSnapshot(await getD1());
    return snapshot ? JSON.parse(snapshot.payloadJson) as ScreenerClientSnapshotPayload : undefined;
  } catch {
    return undefined;
  }
}

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
    return jsonResponse(
      await getSecuritySummary(resolved, {
        fallbackSnapshot:
          (await localFallbackSnapshot()) ?? (await snapshotFromD1()),
      }),
    );
  } catch (error) {
    return routeError(error);
  }
}
