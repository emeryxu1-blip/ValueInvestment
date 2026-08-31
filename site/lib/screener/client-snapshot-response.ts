import {
  SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION,
  type ScreenerClientSnapshotSchemaVersion,
} from "./client-snapshot-contract.ts";

// The snapshot is immutable after publication, but the URL is not generation-keyed.
// Keep browser/proxy caching disabled so a newly published D1 generation is always
// observed on the next request. The ETag remains useful for explicit conditional
// requests made against the current origin response.
const CLIENT_SNAPSHOT_CACHE_CONTROL = "no-store";

export type StoredScreenerClientSnapshotResponse = {
  payloadJson: string;
  etag: string;
  schemaVersion?: ScreenerClientSnapshotSchemaVersion;
};

function quotedEtag(value: string): string {
  if (/^(?:W\/)?"[^"\r\n]+"$/.test(value)) return value;
  return `"${value.replaceAll("\\", "").replaceAll('"', "")}"`;
}

export function etagMatches(
  requestValue: string | null,
  responseValue: string,
): boolean {
  if (!requestValue) return false;
  const normalize = (value: string) => value.trim().replace(/^W\//, "");
  return (
    requestValue.trim() === "*" ||
    requestValue
      .split(",")
      .some((candidate) => normalize(candidate) === normalize(responseValue))
  );
}

export function screenerClientSnapshotResponse(
  request: Request,
  snapshot: StoredScreenerClientSnapshotResponse | null,
): Response {
  if (!snapshot) {
    return Response.json(
      {
        code: "SNAPSHOT_UNAVAILABLE",
        error: "The stored company snapshot is temporarily unavailable.",
        retryable: true,
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }

  const etag = quotedEtag(snapshot.etag);
  const schemaVersion =
    snapshot.schemaVersion ?? SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION;
  const isCurrentSchema =
    schemaVersion === SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION;
  const headers = new Headers({
    "Cache-Control": isCurrentSchema
      ? CLIENT_SNAPSHOT_CACHE_CONTROL
      : "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ETag: etag,
    "X-Screener-Schema-Version": String(schemaVersion),
    "X-Content-Type-Options": "nosniff",
  });
  if (etagMatches(request.headers.get("If-None-Match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(snapshot.payloadJson, { status: 200, headers });
}
