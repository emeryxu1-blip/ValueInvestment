import {
  findAnonymousSession,
  insertAnonymousSession,
  touchAnonymousSession,
  type WorkspaceDatabase,
} from "./repository";
import {
  generateWorkspaceSessionToken,
  hashWorkspaceSessionToken,
  readWorkspaceSessionToken,
  serializeWorkspaceSessionCookie,
  WORKSPACE_SESSION_TTL_MS,
} from "./session-cookie";

export {
  generateWorkspaceSessionToken,
  hashWorkspaceSessionToken,
  readWorkspaceSessionToken,
  serializeWorkspaceSessionCookie,
  WORKSPACE_SESSION_COOKIE,
  WORKSPACE_SESSION_TTL_MS,
} from "./session-cookie";

const TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export type WorkspaceSessionContext = {
  id: string;
  setCookie: string | null;
};

export async function resolveWorkspaceSession(
  db: WorkspaceDatabase,
  request: Request,
  now = Date.now(),
): Promise<WorkspaceSessionContext> {
  const token = readWorkspaceSessionToken(request.headers.get("Cookie"));
  if (token) {
    const id = await hashWorkspaceSessionToken(token);
    const session = await findAnonymousSession(db, id);
    if (session && session.expiresAt > now) {
      if (now - session.lastSeenAt >= TOUCH_INTERVAL_MS) {
        await touchAnonymousSession(db, id, now);
      }
      return { id, setCookie: null };
    }
  }

  const nextToken = generateWorkspaceSessionToken();
  const id = await hashWorkspaceSessionToken(nextToken);
  await insertAnonymousSession(db, {
    id,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + WORKSPACE_SESSION_TTL_MS,
  });
  return {
    id,
    setCookie: serializeWorkspaceSessionCookie(nextToken, request.url, now),
  };
}

export function applyWorkspaceSessionCookie(
  response: Response,
  session: WorkspaceSessionContext,
): Response {
  if (session.setCookie) {
    response.headers.append("Set-Cookie", session.setCookie);
  }
  return response;
}
