#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { stdin } from "node:process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(scriptDirectory, "..");
export const REQUIRED_SECRET_NAMES = Object.freeze([
  "AINVEST_USERID",
  "AINVEST_SESSIONID",
]);

const DEFAULT_DEV_VARS_PATH = resolve(projectRoot, ".dev.vars");
const DEFAULT_WRANGLER_PATH = resolve(projectRoot, "node_modules/.bin/wrangler");
const DEFAULT_CONFIG_PATH = resolve(projectRoot, "wrangler.jsonc");
const WRANGLER_TIMEOUT_MS = 120_000;
const VERIFY_TIMEOUT_MS = 15_000;
const VERIFY_URL =
  "https://extquote.ainvest.com/index_api/indicator/v2/snapshot";
const VERIFY_BODY = {
  symbol: [{ type: "market_code", value: ["185:MSFT"] }],
  indicator: [
    {
      id: "10",
      req_unique_id: "authProbePrice",
      attr: { trade_class: "intraday" },
    },
  ],
  page: { begin: 0, count: 1 },
  res_symbol_type: "market_code",
};

export class RotationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "RotationError";
    this.exitCode = exitCode;
  }
}

function usage() {
  return `Usage: npm run rotate:ainvest -- [options]

Read AInvest credentials from the private site/.dev.vars file and update the
Cloudflare Worker secrets without putting either value in command arguments,
logs, or source control.

Options:
  --dev-vars <path>     Credential file (default: .dev.vars)
  --stdin               Read a JSON object from stdin instead of a file
  --config <path>       Wrangler config (default: wrangler.jsonc)
  --wrangler-bin <path> Wrangler executable
  --verify              Verify the session with an AInvest API request first
  --dry-run             Validate (and optionally verify) without updating Cloudflare
  --json                Emit secret-free JSON output
  --help                Show this help

The JSON/stdin and file sources must include these required values; other local
variables are ignored:
  AINVEST_USERID
  AINVEST_SESSIONID

Never pass credential values as command-line arguments. Update both local values
together, then run this command from the site directory or through npm.
`;
}

function optionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new RotationError(`${option} requires a path value.`, 2);
  }
  return value;
}

export function parseArgs(argv = []) {
  const options = {
    devVarsPath: DEFAULT_DEV_VARS_PATH,
    devVarsExplicit: false,
    configPath: DEFAULT_CONFIG_PATH,
    wranglerBin: DEFAULT_WRANGLER_PATH,
    readStdin: false,
    verify: false,
    dryRun: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--stdin") {
      options.readStdin = true;
      continue;
    }
    if (argument === "--verify") {
      options.verify = true;
      continue;
    }
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--json") {
      options.json = true;
      continue;
    }

    const equalsIndex = argument.indexOf("=");
    const option = equalsIndex >= 0 ? argument.slice(0, equalsIndex) : argument;
    const inlineValue = equalsIndex >= 0 ? argument.slice(equalsIndex + 1) : null;
    if (
      option === "--dev-vars" ||
      option === "--config" ||
      option === "--wrangler-bin"
    ) {
      const value = inlineValue ?? optionValue(argv, index++, option);
      if (!value) throw new RotationError(`${option} requires a path value.`, 2);
      if (option === "--dev-vars") {
        options.devVarsPath = resolve(projectRoot, value);
        options.devVarsExplicit = true;
      } else if (option === "--config") {
        options.configPath = resolve(projectRoot, value);
      } else {
        options.wranglerBin = resolve(projectRoot, value);
      }
      continue;
    }

    const safeArgument = argument.includes("=")
      ? argument.slice(0, argument.indexOf("="))
      : argument;
    throw new RotationError(`Unknown option: ${safeArgument}`, 2);
  }

  if (options.readStdin && options.devVarsExplicit) {
    throw new RotationError("Use either --stdin or --dev-vars, not both.", 2);
  }
  return options;
}

function parseQuotedValue(raw, lineNumber) {
  const quote = raw[0];
  let closingIndex = -1;
  let escaped = false;
  for (let index = 1; index < raw.length; index += 1) {
    const character = raw[index];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === quote) {
      closingIndex = index;
      break;
    }
  }
  if (closingIndex < 0) {
    throw new RotationError(`Malformed quoted value on line ${lineNumber}.`, 3);
  }
  const trailing = raw.slice(closingIndex + 1).trim();
  if (trailing && !trailing.startsWith("#")) {
    throw new RotationError(`Malformed quoted value on line ${lineNumber}.`, 3);
  }
  const value = raw.slice(1, closingIndex);
  if (quote === '"') {
    return value.replace(/\\([\\"nrt])/g, (_match, escapedCharacter) => {
      if (escapedCharacter === "n") return "\n";
      if (escapedCharacter === "r") return "\r";
      if (escapedCharacter === "t") return "\t";
      return escapedCharacter;
    });
  }
  return value;
}

export function parseEnvFile(contents) {
  if (typeof contents !== "string") {
    throw new RotationError("Credential file contents are not text.", 3);
  }
  const values = {};
  const lines = contents.split("\n");
  lines.forEach((originalLine, lineIndex) => {
    const lineNumber = lineIndex + 1;
    let line = originalLine.endsWith("\r")
      ? originalLine.slice(0, -1).trim()
      : originalLine.trim();
    if (!line || line.startsWith("#")) return;
    line = line.replace(/^export\s+/, "");

    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new RotationError(`Malformed credential file on line ${lineNumber}.`, 3);
    }
    const name = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new RotationError(`Malformed variable name on line ${lineNumber}.`, 3);
    }
    if (Object.hasOwn(values, name)) {
      throw new RotationError(`Duplicate variable on line ${lineNumber}.`, 3);
    }

    let rawValue = line.slice(separator + 1).trim();
    if (rawValue.startsWith("'") || rawValue.startsWith('"')) {
      rawValue = parseQuotedValue(rawValue, lineNumber);
    } else {
      const commentStart = rawValue.indexOf(" #");
      if (commentStart >= 0) rawValue = rawValue.slice(0, commentStart).trimEnd();
    }
    values[name] = rawValue;
  });
  return values;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateCredentials(values) {
  if (!isPlainObject(values)) {
    throw new RotationError("Credential input must be an object.", 3);
  }

  const credentials = {};
  for (const name of REQUIRED_SECRET_NAMES) {
    const rawValue = values[name];
    if (typeof rawValue !== "string") {
      throw new RotationError(`${name} is missing or is not a string.`, 3);
    }
    const value = rawValue.trim();
    if (!value) throw new RotationError(`${name} is empty.`, 3);
    if (
      value.startsWith("mt_") ||
      /[\u0000-\u001f\u007f;]/.test(value)
    ) {
      throw new RotationError(`${name} contains an invalid session value.`, 3);
    }
    credentials[name] = value;
  }

  return Object.freeze(credentials);
}

async function readPrivateEnvFile(filePath) {
  let details;
  try {
    details = await stat(filePath);
  } catch {
    throw new RotationError(
      `Credential file not found: ${relative(projectRoot, filePath) || filePath}.`,
      3,
    );
  }
  if (!details.isFile()) {
    throw new RotationError("The credential source is not a regular file.", 3);
  }
  if (process.platform !== "win32" && (details.mode & 0o077) !== 0) {
    throw new RotationError(
      "The credential file must be private (chmod 600 or stricter).",
      3,
    );
  }
  try {
    return parseEnvFile(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error instanceof RotationError) throw error;
    throw new RotationError("Unable to read the credential file.", 3);
  }
}

async function readStdinObject() {
  if (process.stdin.isTTY) {
    throw new RotationError(
      "Cannot read credentials from an interactive stdin. Use .dev.vars or pipe JSON with --stdin.",
      3,
    );
  }
  let text;
  try {
    const chunks = [];
    for await (const chunk of stdin) chunks.push(chunk);
    text = Buffer.concat(
      chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))),
    ).toString("utf8");
  } catch {
    throw new RotationError("Unable to read credential JSON from stdin.", 3);
  }
  let values;
  try {
    values = JSON.parse(text);
  } catch {
    throw new RotationError("Credential stdin must contain valid JSON.", 3);
  }
  if (!isPlainObject(values)) {
    throw new RotationError("Credential stdin must contain a JSON object.", 3);
  }
  return values;
}

export async function readCredentials(options) {
  const values = options.readStdin
    ? await readStdinObject()
    : await readPrivateEnvFile(options.devVarsPath);
  return validateCredentials(values);
}

function sanitizedEnvironment() {
  const environment = { ...process.env };
  for (const name of [
    "AINVEST_USERID",
    "AINVEST_SESSIONID",
    "AINVEST_C_COOKIE",
    "AINVEST_EMAIL",
    "AINVEST_PASSWORD",
  ]) {
    delete environment[name];
  }
  return environment;
}

export async function verifyAInvestSession(
  credentials,
  { fetcher = fetch, timeoutMs = VERIFY_TIMEOUT_MS } = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("verification-timeout"), timeoutMs);
  let response;
  try {
    response = await fetcher(VERIFY_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: `userid=${credentials.AINVEST_USERID}; sessionid=${credentials.AINVEST_SESSIONID}`,
        "X-Auth-ProgId": "7080",
      },
      body: JSON.stringify(VERIFY_BODY),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    throw new RotationError("AInvest session verification could not reach the API.", 5);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new RotationError(
      response.status === 401 || response.status === 403
        ? "AInvest rejected the supplied session during verification."
        : `AInvest session verification returned HTTP ${response.status}.`,
      5,
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new RotationError("AInvest session verification returned invalid JSON.", 5);
  }
  if (!isPlainObject(payload) || Number(payload.status_code) !== 0) {
    throw new RotationError("AInvest rejected the supplied session during verification.", 5);
  }
  return true;
}

export function updateCloudflareSecrets(
  credentials,
  {
    wranglerBin = DEFAULT_WRANGLER_PATH,
    configPath = DEFAULT_CONFIG_PATH,
    timeoutMs = WRANGLER_TIMEOUT_MS,
  } = {},
) {
  const args = ["secret", "bulk", "--config", configPath];
  const child = spawn(wranglerBin, args, {
    cwd: projectRoot,
    env: sanitizedEnvironment(),
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });

  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let timeout;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(
        rejectPromise,
        new RotationError(
          "Wrangler timed out while updating Cloudflare Worker secrets.",
          4,
        ),
      );
    }, timeoutMs);

    child.stdout.resume();
    child.stderr.resume();
    child.once("error", () => {
      finish(
        rejectPromise,
        new RotationError(
          "Unable to start Wrangler. Install dependencies and check Wrangler authentication.",
          4,
        ),
      );
    });
    child.once("exit", (code, signal) => {
      if (code === 0) {
        finish(resolvePromise, undefined);
        return;
      }
      finish(
        rejectPromise,
        new RotationError(
          signal
            ? `Wrangler stopped with signal ${signal} while updating Cloudflare Worker secrets.`
            : `Wrangler exited with code ${code ?? 1} while updating Cloudflare Worker secrets.`,
          4,
        ),
      );
    });

    child.stdin.once("error", () => {
      finish(
        rejectPromise,
        new RotationError(
          "Unable to send the credentials to Wrangler securely.",
          4,
        ),
      );
    });
    child.stdin.end(`${JSON.stringify(credentials)}\n`);
  });
}

export async function execute(options) {
  const credentials = await readCredentials(options);
  if (options.verify) await verifyAInvestSession(credentials);
  if (!options.dryRun) {
    await updateCloudflareSecrets(credentials, {
      wranglerBin: options.wranglerBin,
      configPath: options.configPath,
    });
  }
  return {
    source: options.readStdin
      ? "stdin"
      : relative(projectRoot, options.devVarsPath) || options.devVarsPath,
    validated: true,
    verified: options.verify,
    dryRun: options.dryRun,
    updated: !options.dryRun,
    targets: [...REQUIRED_SECRET_NAMES],
  };
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  console.log(
    result.dryRun
      ? result.verified
        ? `Validated and verified AInvest credentials from ${result.source}. Dry run: Cloudflare secrets were not changed.`
        : `Validated AInvest credentials from ${result.source}. Dry run: Cloudflare secrets were not changed.`
      : result.verified
        ? "Verified the AInvest session and updated Cloudflare Worker secrets: AINVEST_USERID, AINVEST_SESSIONID."
        : "Updated Cloudflare Worker secrets: AINVEST_USERID, AINVEST_SESSIONID.",
  );
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) {
      console.log(usage());
      return 0;
    }
    const result = await execute(options);
    printResult(result, options.json);
    return 0;
  } catch (error) {
    const safeError =
      error instanceof RotationError
        ? error
        : new RotationError("AInvest secret rotation failed.", 1);
    const wantsJson = options?.json || argv.includes("--json");
    if (wantsJson) {
      console.error(
        JSON.stringify({
          validated: false,
          updated: false,
          error: safeError.message,
        }),
      );
    } else {
      console.error(`AInvest secret rotation failed: ${safeError.message}`);
    }
    return safeError.exitCode;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  const exitCode = await main();
  if (exitCode !== 0) process.exitCode = exitCode;
}
