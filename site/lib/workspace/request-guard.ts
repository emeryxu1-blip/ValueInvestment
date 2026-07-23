export class WorkspaceHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "WorkspaceHttpError";
    this.status = status;
  }
}

const MAX_JSON_BODY_BYTES = 256 * 1024;

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("Origin");
  if (!origin || origin === "null") {
    throw new WorkspaceHttpError(
      403,
      "A same-origin Origin header is required for this operation.",
    );
  }

  let requestOrigin: string;
  let suppliedOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
    suppliedOrigin = new URL(origin).origin;
  } catch {
    throw new WorkspaceHttpError(403, "The request origin is invalid.");
  }

  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (
    suppliedOrigin !== requestOrigin ||
    (fetchSite !== null && fetchSite !== "same-origin")
  ) {
    throw new WorkspaceHttpError(
      403,
      "Cross-origin workspace mutations are not allowed.",
    );
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_JSON_BODY_BYTES
  ) {
    throw new WorkspaceHttpError(413, "The request body is too large.");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    throw new WorkspaceHttpError(413, "The request body is too large.");
  }
  if (!text.trim()) {
    throw new WorkspaceHttpError(400, "A JSON request body is required.");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new WorkspaceHttpError(400, "The request body must be valid JSON.");
  }
}
