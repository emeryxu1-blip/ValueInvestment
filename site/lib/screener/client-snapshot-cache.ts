import { etagMatches } from "./client-snapshot-response.ts";
import { SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION } from "./client-snapshot-contract.ts";

type SnapshotCache = Pick<Cache, "match" | "put">;

export function isScreenerApiPath(pathname: string): boolean {
  return pathname === "/api/screener" || pathname.startsWith("/api/screener/");
}

function conditionalSnapshotResponse(
  request: Request,
  response: Response,
): Response {
  const responseTag = response.headers.get("ETag");
  if (
    !responseTag ||
    !etagMatches(request.headers.get("If-None-Match"), responseTag)
  ) {
    return response;
  }
  const headers = new Headers({ ETag: responseTag });
  const cacheControl = response.headers.get("Cache-Control");
  if (cacheControl) headers.set("Cache-Control", cacheControl);
  return new Response(null, { status: 304, headers });
}

export function screenerSnapshotCacheKey(request: Request): Request {
  const url = new URL(request.url);
  url.search = "";
  url.searchParams.set(
    "schema",
    String(SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION),
  );
  return new Request(url.toString(), { method: "GET" });
}

export async function cachedScreenerSnapshotResponse(
  request: Request,
  options: {
    cache: SnapshotCache;
    fetchOrigin: () => Promise<Response>;
    waitUntil: (promise: Promise<unknown>) => void;
  },
): Promise<Response> {
  const cacheKey = screenerSnapshotCacheKey(request);
  const cached = await options.cache.match(cacheKey);
  if (cached) return conditionalSnapshotResponse(request, cached);

  const response = await options.fetchOrigin();
  if (
    response.status === 200 &&
    response.headers.get("X-Screener-Schema-Version") ===
      String(SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION)
  ) {
    options.waitUntil(options.cache.put(cacheKey, response.clone()));
  }
  return response;
}
