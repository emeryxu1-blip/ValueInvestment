import { ZodError } from "zod";

export function jsonResponse(
  value: unknown,
  options: { status?: number; cacheControl?: string } = {},
): Response {
  return Response.json(value, {
    status: options.status ?? 200,
    headers: {
      "Cache-Control": options.cacheControl ?? "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function validationError(error: unknown): Response {
  if (error instanceof ZodError) {
    return jsonResponse(
      {
        error: "Invalid request parameters.",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }
  return jsonResponse(
    {
      error: error instanceof Error ? error.message : "Invalid request parameters.",
    },
    { status: 400 },
  );
}

export function liveDataUnavailable(): Response {
  return jsonResponse(
    {
      code: "DATA_UNAVAILABLE",
      error: "Market data is temporarily unavailable.",
      retryable: true,
    },
    { status: 503 },
  );
}

export function routeError(error: unknown): Response {
  return error instanceof ZodError
    ? validationError(error)
    : liveDataUnavailable();
}
