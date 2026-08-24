const AINVEST_VISITOR_LOGIN_URL =
  "https://user.ainvest.com/auth/visitor/login";
const AINVEST_LOGIN_URL = "https://user.ainvest.com/auth/user/v3/login";
const AINVEST_LOGIN_UKEY = "72c55701353cb5555c8805408e7d8dbd";
const LOGIN_FAILURE_COOLDOWN_MS = 60_000;
const LOGIN_TIMEOUT_MS = 15_000;

// AInvest's web client publishes this PKCS#8 key and uses it to create the
// signedPwd field. It is protocol material, not this application's secret.
const AINVEST_PASSWORD_SIGNING_KEY =
  "MIICdwIBADANBgkqhkiG9w0BAQEFAASCAmEwggJdAgEAAoGBAIRizNv6E5TtxYdI/CyvltmGj/NgCqcYsUfxuPBEEPfi8ikeRFiUU2Gmh36o+fuEGSfpqsqSm+3VV5gc5aWdk8dJiwwSz0BP+RxsS7BAZcASdNLKj+KIGtDm4BC/Yb+1lqk1YLx9L/mQZM+3Rqznh0QIpiSxJsFhdxFwEQ3A6pvFAgMBAAECgYAly+t/NpPWplgJ+u18eJlR+5gnvRjtgiBDUSEi/9v0WggXczvCKn7v11LB985/X8Sq34zSjy8TpSCAHmf2c9nX1t3MWNeR+rdG70vpNNVkFDZyGJbWOJIc8yhdMRpGoxSzviWXV3gB9SiIHdW2HoN3YijY23apxiROTiixzQgG1QJBANP1hzEdb4otsNpTamFupUDAPi8HHSxJlbSWduG/3Z1FpuDcCdHZvJMpxvD21iV92OSFtgWVyCdVZ3nqDl5lPu8CQQCf5KNQma7rgwVb/0xqEtNE0RpRuM9vwsMwkq8z9UN6IvjnzFtBaFxb+GZy6PdUyxlwRsE4y9tSQ9y98pHMJZCLAkAwanM5GtoxnAI7vLYeD2IcCk2p/FwDk8Nofr4lDuiWViSqVFjB4JScoPxaame8JKT4fjp3yCDyKyX5yScDFOltAkEAixgnSpKnLJIKM4HgQ9akm5UcREN1kU/o5XR1ncmbLcEGrv+D016qGgf5d7ValBUqyBWFOZd98A7BFSzT0LhNCQJBAKkVlYifrI7uWI5LQHULskWVSJ5oOTtPMkeGeH2J6QZNsTEMXC4oul3jPSJ3lkwve3RuZtwcqJiTwUqAdhpr1dQ=";

export class AInvestAuthError extends Error {
  readonly shouldCoolDown: boolean;

  constructor(
    message = "AInvest authentication is unavailable.",
    options: { shouldCoolDown?: boolean } = {},
  ) {
    super(message);
    this.name = "AInvestAuthError";
    this.shouldCoolDown = options.shouldCoolDown ?? false;
  }
}

type AuthOptions = {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
};

type LoginCredentials = {
  email: string;
  password: string;
};

let cachedCookie: string | null = null;
let rejectedSeedCookie: string | null = null;
let loginInFlight: Promise<string> | null = null;
let loginFailureUntil = 0;
let signingKeyPromise: Promise<CryptoKey> | null = null;

function configuredSeedCookie() {
  const value = process.env.AINVEST_C_COOKIE?.trim();
  return value || null;
}

function configuredCredentials(): LoginCredentials | null {
  const email = process.env.AINVEST_EMAIL?.trim();
  const password = process.env.AINVEST_PASSWORD;
  return email && password ? { email, password } : null;
}

export function hasAInvestAuthConfig() {
  const seed = configuredSeedCookie();
  return Boolean(
    (seed && seed !== rejectedSeedCookie) || configuredCredentials(),
  );
}

export function splitSetCookieHeader(value: string): string[] {
  return value
    .split(/,(?=\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+=)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function responseSetCookieHeaders(headers: Headers): string[] {
  const extendedHeaders = headers as Headers & {
    getSetCookie?: () => string[];
  };
  const values = extendedHeaders.getSetCookie?.() ?? [];
  if (values.length > 0) return values;
  const combined = headers.get("Set-Cookie");
  return combined ? splitSetCookieHeader(combined) : [];
}

function setCookiePair(value: string): [string, string] | null {
  const pair = value.split(";", 1)[0];
  const separator = pair.indexOf("=");
  if (separator <= 0) return null;
  const name = pair.slice(0, separator).trim();
  const cookieValue = pair.slice(separator + 1).trim();
  return name && !/[;\r\n]/.test(cookieValue)
    ? [name, cookieValue]
    : null;
}

export function parseSetCookieHeaders(
  values: string[],
  initial: ReadonlyMap<string, string> = new Map(),
) {
  const jar = new Map(initial);
  for (const value of values) {
    const pair = setCookiePair(value);
    if (pair) jar.set(...pair);
  }
  return jar;
}

export function parseCookieHeader(value: string) {
  const jar = new Map<string, string>();
  for (const part of value.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const cookieValue = part.slice(separator + 1).trim();
    if (name && !/[;\r\n]/.test(cookieValue)) jar.set(name, cookieValue);
  }
  return jar;
}

export function serializeCookieJar(jar: ReadonlyMap<string, string>) {
  return [...jar]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function decodeBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64(value: ArrayBuffer) {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function passwordSigningKey() {
  signingKeyPromise ??= crypto.subtle.importKey(
    "pkcs8",
    decodeBase64(AINVEST_PASSWORD_SIGNING_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return signingKeyPromise;
}

async function signPassword(password: string) {
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await passwordSigningKey(),
    new TextEncoder().encode(password),
  );
  return `${Date.now()}${encodeBase64(signature)}`;
}

async function cancelBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is only a best-effort way to avoid downloading the page.
  }
}

async function loginToAInvest(
  credentials: LoginCredentials,
  options: AuthOptions,
) {
  const fetcher = options.fetcher ?? fetch;
  const fingerprint = crypto.randomUUID();
  let visitorResponse: Response;
  try {
    visitorResponse = await fetcher(AINVEST_VISITOR_LOGIN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://www.ainvest.com",
        Referer: "https://www.ainvest.com/",
        fingerprint,
        "X-Auth-Version": "1.0",
        "X-Auth-Progid": "7047",
        "X-Auth-Select-Market-Level": "uus:level0",
      },
      body: new URLSearchParams({
        udid: fingerprint,
        clientType: "WEB",
      }),
      redirect: "manual",
      signal: options.signal,
      cache: "no-store",
    });
  } catch {
    throw new AInvestAuthError();
  }

  const visitorCookies = responseSetCookieHeaders(visitorResponse.headers);
  await cancelBody(visitorResponse);
  if (!visitorResponse.ok) throw new AInvestAuthError();
  const visitorJar = parseSetCookieHeaders(visitorCookies);
  const visitorId = visitorJar.get("userid");
  const visitorToken = visitorJar.get("sessionid");
  if (!visitorId || !visitorToken) throw new AInvestAuthError();

  const signedPwd = await signPassword(credentials.password);
  let loginResponse: Response;
  try {
    loginResponse = await fetcher(AINVEST_LOGIN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: serializeCookieJar(visitorJar),
        Origin: "https://www.ainvest.com",
        Referer: "https://www.ainvest.com/login/",
        fingerprint,
        ukey: AINVEST_LOGIN_UKEY,
        "X-Auth-Version": "1.0",
        "X-Auth-Progid": "7047",
        "X-Auth-Select-Market-Level": "uus:level0",
      },
      body: JSON.stringify({
        type: "EMAIL",
        loginType: "ACCOUNT_PWD",
        email: credentials.email,
        signedPwd,
        visitorId,
        token: visitorToken,
      }),
      redirect: "manual",
      signal: options.signal,
      cache: "no-store",
    });
  } catch {
    throw new AInvestAuthError();
  }

  let payload: unknown;
  try {
    payload = await loginResponse.json();
  } catch {
    throw new AInvestAuthError(undefined, {
      shouldCoolDown: loginResponse.status === 466,
    });
  }
  if (
    !loginResponse.ok ||
    !payload ||
    typeof payload !== "object" ||
    String((payload as { i18nMsg?: unknown }).i18nMsg).toLowerCase() !==
      "success"
  ) {
    throw new AInvestAuthError(undefined, { shouldCoolDown: true });
  }

  const authenticatedJar = parseSetCookieHeaders(
    responseSetCookieHeaders(loginResponse.headers),
  );
  const userid = authenticatedJar.get("userid");
  const sessionid = authenticatedJar.get("sessionid");
  const username = authenticatedJar.get("u_name");
  if (!userid || !sessionid || !username || username.startsWith("mt_")) {
    throw new AInvestAuthError();
  }
  return `userid=${userid}; sessionid=${sessionid}`;
}

function waitForLogin(login: Promise<string>, signal?: AbortSignal) {
  if (!signal) return login;
  if (signal.aborted) return Promise.reject(new AInvestAuthError());

  return new Promise<string>((resolve, reject) => {
    const aborted = () => {
      cleanup();
      reject(new AInvestAuthError());
    };
    const cleanup = () => signal.removeEventListener("abort", aborted);
    signal.addEventListener("abort", aborted, { once: true });
    login.then(
      (cookie) => {
        cleanup();
        resolve(cookie);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export async function resolveAInvestCookie(options: AuthOptions = {}) {
  if (cachedCookie) return cachedCookie;

  const credentials = configuredCredentials();
  const seed = configuredSeedCookie();
  if (!credentials && seed && seed !== rejectedSeedCookie) {
    cachedCookie = seed;
    return seed;
  }

  if (!credentials) throw new AInvestAuthError();
  if (loginFailureUntil > Date.now()) throw new AInvestAuthError();
  if (loginInFlight) return waitForLogin(loginInFlight, options.signal);

  const loginController = new AbortController();
  const loginTimeout = setTimeout(
    () => loginController.abort("login-timeout"),
    LOGIN_TIMEOUT_MS,
  );
  loginInFlight = loginToAInvest(credentials, {
    fetcher: options.fetcher,
    signal: loginController.signal,
  })
    .then((cookie) => {
      cachedCookie = cookie;
      loginFailureUntil = 0;
      return cookie;
    })
    .catch((error) => {
      if (error instanceof AInvestAuthError && error.shouldCoolDown) {
        loginFailureUntil = Date.now() + LOGIN_FAILURE_COOLDOWN_MS;
      }
      throw new AInvestAuthError();
    })
    .finally(() => {
      clearTimeout(loginTimeout);
      loginInFlight = null;
    });
  return waitForLogin(loginInFlight, options.signal);
}

export function invalidateAInvestCookie(failedCookie?: string) {
  if (failedCookie && cachedCookie !== failedCookie) return;
  cachedCookie = null;
  const seed = configuredSeedCookie();
  if (failedCookie && seed === failedCookie) rejectedSeedCookie = seed;
}

export function __resetAInvestAuthForTests() {
  cachedCookie = null;
  rejectedSeedCookie = null;
  loginInFlight = null;
  loginFailureUntil = 0;
}
