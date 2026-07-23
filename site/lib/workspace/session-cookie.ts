export const WORKSPACE_SESSION_COOKIE = "value_lens_session";
export const WORKSPACE_SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1_000;

const SESSION_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export function generateWorkspaceSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function hashWorkspaceSessionToken(
  token: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return bytesToHex(new Uint8Array(digest));
}

export function readWorkspaceSessionToken(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== WORKSPACE_SESSION_COOKIE) continue;
    const value = part.slice(separator + 1).trim().toLowerCase();
    return SESSION_TOKEN_PATTERN.test(value) ? value : null;
  }
  return null;
}

export function serializeWorkspaceSessionCookie(
  token: string,
  requestUrl: string,
  now = Date.now(),
): string {
  if (!SESSION_TOKEN_PATTERN.test(token)) {
    throw new Error("Cannot serialize an invalid workspace session token.");
  }
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  const expires = new Date(now + WORKSPACE_SESSION_TTL_MS).toUTCString();
  return [
    `${WORKSPACE_SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(WORKSPACE_SESSION_TTL_MS / 1_000)}`,
    `Expires=${expires}${secure}`,
  ].join("; ");
}
