import { ZodError } from "zod";
import { jsonResponse, validationError } from "../http";
import { WorkspaceHttpError } from "./request-guard";

export {
  assertSameOrigin,
  readJsonBody,
  WorkspaceHttpError,
} from "./request-guard";

export class WorkspaceNotFoundError extends WorkspaceHttpError {
  constructor(message: string) {
    super(404, message);
    this.name = "WorkspaceNotFoundError";
  }
}

export class WorkspaceLimitError extends WorkspaceHttpError {
  constructor(message: string) {
    super(409, message);
    this.name = "WorkspaceLimitError";
  }
}

export function workspaceRouteError(error: unknown): Response {
  if (error instanceof ZodError) return validationError(error);
  if (error instanceof WorkspaceHttpError) {
    return jsonResponse({ error: error.message }, { status: error.status });
  }
  return jsonResponse(
    {
      code: "WORKSPACE_UNAVAILABLE",
      error: "Workspace storage is temporarily unavailable.",
      retryable: true,
    },
    { status: 503 },
  );
}
