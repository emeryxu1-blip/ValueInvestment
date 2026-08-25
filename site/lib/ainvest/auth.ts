export class AInvestAuthError extends Error {
  constructor(
    message = "AInvest authentication is unavailable. Manual session rotation is required.",
  ) {
    super(message);
    this.name = "AInvestAuthError";
  }
}

type AuthOptions = {
  signal?: AbortSignal;
};

let rejectedSessionKey: string | null = null;

const validCookieValue = (value: string) =>
  value.length > 0 && !/[;\r\n]/.test(value);

function configuredSession(): {
  cookie: string;
  key: string;
} | null {
  const userid = process.env.AINVEST_USERID?.trim() ?? "";
  const sessionid = process.env.AINVEST_SESSIONID?.trim() ?? "";
  if (
    !validCookieValue(userid) ||
    !validCookieValue(sessionid) ||
    userid.startsWith("mt_") ||
    sessionid.startsWith("mt_")
  ) return null;
  return {
    cookie: `userid=${userid}; sessionid=${sessionid}`,
    key: `${userid}\u0000${sessionid}`,
  };
}

export function hasAInvestAuthConfig() {
  const session = configuredSession();
  return Boolean(session && session.key !== rejectedSessionKey);
}

export async function resolveAInvestCookie(options: AuthOptions = {}) {
  if (options.signal?.aborted) throw new AInvestAuthError();
  const session = configuredSession();
  if (!session || session.key === rejectedSessionKey) {
    throw new AInvestAuthError();
  }
  return session.cookie;
}

export function invalidateAInvestCookie(failedCookie?: string) {
  const session = configuredSession();
  if (!session) return;
  if (failedCookie && failedCookie !== session.cookie) return;
  rejectedSessionKey = session.key;
}

export function __resetAInvestAuthForTests() {
  rejectedSessionKey = null;
}
