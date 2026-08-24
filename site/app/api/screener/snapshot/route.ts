import { getD1 } from "../../../../db";
import { screenerClientSnapshotResponse } from "../../../../lib/screener/client-snapshot-response";
import { readScreenerClientSnapshot } from "../../../../lib/screener/snapshot";

const DEFAULT_LOCAL_SNAPSHOT_SOURCE =
  "https://value-investment.emery-xu1.workers.dev/api/screener/snapshot";

async function localSnapshotFallback(request: Request): Promise<Response | null> {
  if (process.env.NODE_ENV !== "development") return null;
  const source =
    process.env.LOCAL_SNAPSHOT_SOURCE_URL?.trim() || DEFAULT_LOCAL_SNAPSHOT_SOURCE;
  try {
    const sourceUrl = new URL(source);
    sourceUrl.search = new URL(request.url).search;
    const response = await fetch(sourceUrl, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.delete("age");
    headers.delete("cf-cache-status");
    headers.set("Cache-Control", "no-store");
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers,
    });
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const snapshot = await readScreenerClientSnapshot(await getD1());
    if (snapshot) return screenerClientSnapshotResponse(request, snapshot);
    const fallback = await localSnapshotFallback(request);
    return fallback ?? screenerClientSnapshotResponse(request, null);
  } catch {
    const fallback = await localSnapshotFallback(request);
    return fallback ?? screenerClientSnapshotResponse(request, null);
  }
}
