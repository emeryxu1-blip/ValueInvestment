#!/usr/bin/env node

import { chmod } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const devVarsPath = resolve(projectRoot, ".dev.vars");
const nextPath = resolve(projectRoot, "node_modules/.bin/next");

try {
  await chmod(devVarsPath, 0o600);
} catch {
  // The ignored local secrets file is optional or may be read-only.
}

if (!process.env.AINVEST_USERID?.trim() || !process.env.AINVEST_SESSIONID?.trim()) {
  console.warn("AInvest session identifiers are unavailable; APIs will fail closed.");
}

const child = spawn(nextPath, ["dev", ...process.argv.slice(2)], {
  cwd: projectRoot,
  env: {
    ...process.env,
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
