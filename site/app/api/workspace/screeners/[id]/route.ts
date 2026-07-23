import { getDb } from "@/db";
import { jsonResponse } from "@/lib/http";
import {
  deleteSavedScreener,
  getSavedScreener,
  replaceSavedScreener,
} from "@/lib/workspace/repository";
import {
  assertSameOrigin,
  readJsonBody,
  WorkspaceNotFoundError,
  workspaceRouteError,
} from "@/lib/workspace/request";
import {
  applyWorkspaceSessionCookie,
  resolveWorkspaceSession,
} from "@/lib/workspace/session";
import {
  savedScreenerIdSchema,
  savedScreenerWriteSchema,
} from "@/lib/workspace/validation";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const id = savedScreenerIdSchema.parse((await context.params).id);
    const db = await getDb();
    const session = await resolveWorkspaceSession(db, request);
    const screener = await getSavedScreener(db, session.id, id);
    if (!screener) {
      throw new WorkspaceNotFoundError("The saved screener was not found.");
    }
    return applyWorkspaceSessionCookie(
      jsonResponse({ screener }),
      session,
    );
  } catch (error) {
    return workspaceRouteError(error);
  }
}

export async function PUT(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    assertSameOrigin(request);
    const id = savedScreenerIdSchema.parse((await context.params).id);
    const input = savedScreenerWriteSchema.parse(await readJsonBody(request));
    const db = await getDb();
    const session = await resolveWorkspaceSession(db, request);
    const screener = await replaceSavedScreener(
      db,
      session.id,
      id,
      input,
    );
    return applyWorkspaceSessionCookie(
      jsonResponse({ screener }),
      session,
    );
  } catch (error) {
    return workspaceRouteError(error);
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    assertSameOrigin(request);
    const id = savedScreenerIdSchema.parse((await context.params).id);
    const db = await getDb();
    const session = await resolveWorkspaceSession(db, request);
    await deleteSavedScreener(db, session.id, id);
    return applyWorkspaceSessionCookie(
      jsonResponse({ deleted: true }),
      session,
    );
  } catch (error) {
    return workspaceRouteError(error);
  }
}
