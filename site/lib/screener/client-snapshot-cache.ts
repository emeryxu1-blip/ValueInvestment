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
  // D1 can publish a newer generation without changing this route's URL. A
  // schema-only edge key could therefore replay old financial numbers after a
  // successful refresh. Always revalidate at the origin; retain this wrapper's
  // conditional-GET behavior, but never read or write an edge body cache.
  const response = await options.fetchOrigin();
  return conditionalSnapshotResponse(request, response);
}
