import { getDb } from "@/db";
import { jsonResponse } from "@/lib/http";
import { securityParamsSchema } from "@/lib/validation";
import {
  deleteSecurityJournal,
  getSecurityJournal,
  putSecurityJournal,
} from "@/lib/workspace/repository";
import {
  assertSameOrigin,
  readJsonBody,
  workspaceRouteError,
} from "@/lib/workspace/request";
import {
  applyWorkspaceSessionCookie,
  resolveWorkspaceSession,
} from "@/lib/workspace/session";
import { journalWriteSchema } from "@/lib/workspace/validation";

type RouteContext = {
  params: Promise<{ exchange: string; symbol: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const params = securityParamsSchema.parse(await context.params);
    const db = await getDb();
    const session = await resolveWorkspaceSession(db, request);
    const journal = await getSecurityJournal(
      db,
      session.id,
      params.exchange,
      params.symbol,
    );
    return applyWorkspaceSessionCookie(
      jsonResponse({ journal }),
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
    const params = securityParamsSchema.parse(await context.params);
    const input = journalWriteSchema.parse(await readJsonBody(request));
    const db = await getDb();
    const session = await resolveWorkspaceSession(db, request);
    const journal = await putSecurityJournal(
      db,
      session.id,
      params.exchange,
      params.symbol,
      input,
    );
    return applyWorkspaceSessionCookie(
      jsonResponse({ journal }),
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
    const params = securityParamsSchema.parse(await context.params);
    const db = await getDb();
    const session = await resolveWorkspaceSession(db, request);
    const deleted = await deleteSecurityJournal(
      db,
      session.id,
      params.exchange,
      params.symbol,
    );
    return applyWorkspaceSessionCookie(
      jsonResponse({ deleted }),
      session,
    );
  } catch (error) {
    return workspaceRouteError(error);
  }
}
