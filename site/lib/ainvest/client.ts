import {
  hasAInvestAuthConfig,
  invalidateAInvestCookie,
  resolveAInvestCookie,
} from "./auth.ts";

export type AInvestEndpoint = "snapshot" | "series" | "relation" | "multiKline";

const ENDPOINTS: Record<AInvestEndpoint, string> = {
  snapshot: "https://extquote.ainvest.com/index_api/indicator/v2/snapshot",
  series: "https://extquote.ainvest.com/index_api/indicator/v2/series",
  relation: "https://extquote.ainvest.com/index_api/relation/v1/list",
  multiKline: "https://quote.ainvest.com/quote/v2/multi_kline",
};

export class AInvestError extends Error {
  readonly kind: "auth" | "upstream" | "invalid-response";
  readonly status: number;

  constructor(
    message: string,
    options: {
      kind: "auth" | "upstream" | "invalid-response";
      status?: number;
    },
  ) {
    super(message);
    this.name = "AInvestError";
    this.kind = options.kind;
    this.status = options.status ?? 502;
  }
}

export function getAInvestCookie(): string | null {
  const value = process.env.AINVEST_C_COOKIE?.trim();
  return value ? value : null;
}

export function hasAInvestAuth(): boolean {
  return hasAInvestAuthConfig();
}

function isAuthEnvelope(envelope: {
  status_code?: unknown;
  status_msg?: unknown;
}) {
  const statusCode = Number(envelope.status_code);
  const statusMessage = String(envelope.status_msg ?? "").toLowerCase();
  return (
    statusCode === 106 ||
    statusCode === 401 ||
    statusCode === 403 ||
    /auth|credential|expired|log[ -]?in|session|token/.test(statusMessage)
  );
}

async function requestAInvest<T>(
  endpoint: AInvestEndpoint,
  body: unknown,
  cookie: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(ENDPOINTS[endpoint], {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-Auth-ProgId": "7080",
      },
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
    });
  } catch {
    throw new AInvestError("The live market data service could not be reached.", {
      kind: "upstream",
    });
  }

  if (!response.ok) {
    throw new AInvestError(
      response.status === 401 || response.status === 403
        ? "The live market data session has expired."
        : "The live market data service returned an error.",
      {
        kind:
          response.status === 401 || response.status === 403
            ? "auth"
            : "upstream",
        status: response.status,
      },
    );
  }
  const contentLength = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > 10_000_000) {
    throw new AInvestError("The live market data response was too large.", {
      kind: "invalid-response",
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AInvestError("The live market data response was not valid JSON.", {
      kind: "invalid-response",
    });
  }

  if (!payload || typeof payload !== "object") {
    throw new AInvestError("The live market data response was empty.", {
      kind: "invalid-response",
    });
  }
  const envelope = payload as { status_code?: unknown; status_msg?: unknown };
  if (envelope.status_code !== 0) {
    const authFailure = isAuthEnvelope(envelope);
    throw new AInvestError(
      typeof envelope.status_msg === "string" && envelope.status_msg
        ? `AInvest: ${envelope.status_msg}`
        : "The live market data service rejected the request.",
      {
        kind: authFailure ? "auth" : "upstream",
        status: authFailure ? 401 : 502,
      },
    );
  }
  return payload as T;
}

export async function fetchAInvest<T = unknown>(
  endpoint: AInvestEndpoint,
  body: unknown,
  options: {
    fetcher?: typeof fetch;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const fetcher = options.fetcher ?? fetch;
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort("upstream-timeout"),
    options.timeoutMs ?? 10_000,
  );
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;

  const resolveCookie = async () => {
    try {
      return await resolveAInvestCookie({ fetcher, signal });
    } catch {
      throw new AInvestError("AInvest authentication is unavailable.", {
        kind: "auth",
        status: 401,
      });
    }
  };

  try {
    let cookie = await resolveCookie();
    try {
      return await requestAInvest<T>(endpoint, body, cookie, fetcher, signal);
    } catch (error) {
      if (!(error instanceof AInvestError) || error.kind !== "auth") {
        throw error;
      }
      invalidateAInvestCookie(cookie);
      cookie = await resolveCookie();
      try {
        return await requestAInvest<T>(endpoint, body, cookie, fetcher, signal);
      } catch (retryError) {
        if (retryError instanceof AInvestError && retryError.kind === "auth") {
          invalidateAInvestCookie(cookie);
        }
        throw retryError;
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}
