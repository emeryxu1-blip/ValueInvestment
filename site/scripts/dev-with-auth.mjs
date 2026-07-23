#!/usr/bin/env node

import { chmod, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const authPath = resolve(projectRoot, "../skills/Cauth.json");
const nextPath = resolve(projectRoot, "node_modules/.bin/next");

let credentials = null;
try {
  credentials = JSON.parse(await readFile(authPath, "utf8"));
} catch {
  if (!process.env.AINVEST_C_COOKIE?.trim()) {
    console.warn("Market-data credentials are unavailable; APIs will fail closed.");
  }
}

const validCredentials =
  typeof credentials?.userid === "string" &&
  credentials.userid.length > 0 &&
  typeof credentials?.sessionid === "string" &&
  credentials.sessionid.length > 0;

if (credentials && !validCredentials) {
  if (!process.env.AINVEST_C_COOKIE?.trim()) {
    console.warn("Market-data credentials are incomplete; APIs will fail closed.");
  }
}

// Best-effort hardening. The file is outside the site repository and is never
// copied, logged, or serialized into an application response.
if (validCredentials) {
  try {
    await chmod(authPath, 0o600);
  } catch {
    // A read-only filesystem can still run the app without weakening secrecy.
  }
}

const cookie = validCredentials
  ? `userid=${credentials.userid}; sessionid=${credentials.sessionid}`
  : process.env.AINVEST_C_COOKIE?.trim() || null;
credentials = undefined;

const child = spawn(nextPath, ["dev", ...process.argv.slice(2)], {
  cwd: projectRoot,
  env: {
    ...process.env,
    ...(cookie ? { AINVEST_C_COOKIE: cookie } : {}),
  },
  stdio: "inherit",
});

child.once("error", () => {
  console.error("Unable to start the local development server.");
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
