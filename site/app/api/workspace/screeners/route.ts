import { getDb } from "@/db";
import { jsonResponse } from "@/lib/http";
import {
  createSavedScreener,
  listSavedScreeners,
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
import { savedScreenerWriteSchema } from "@/lib/workspace/validation";

export async function GET(request: Request): Promise<Response> {
  try {
    const db = await getDb();
    const session = await resolveWorkspaceSession(db, request);
    const screeners = await listSavedScreeners(db, session.id);
    return applyWorkspaceSessionCookie(
      jsonResponse({ screeners }),
      session,
    );
  } catch (error) {
    return workspaceRouteError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const input = savedScreenerWriteSchema.parse(await readJsonBody(request));
    const db = await getDb();
    const session = await resolveWorkspaceSession(db, request);
    const screener = await createSavedScreener(db, session.id, input);
    return applyWorkspaceSessionCookie(
      jsonResponse({ screener }, { status: 201 }),
      session,
    );
  } catch (error) {
    return workspaceRouteError(error);
  }
}
