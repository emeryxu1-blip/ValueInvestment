#!/usr/bin/env node

import { access, chmod } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const devVarsPath = resolve(projectRoot, ".dev.vars");
const localSnapshotPath = resolve(projectRoot, ".local/screener-snapshot.json");
const nextPath = resolve(projectRoot, "node_modules/.bin/next");

try {
  await access(localSnapshotPath);
} catch {
  const syncPath = resolve(projectRoot, "scripts/sync-local-snapshot.mjs");
  const sync = spawnSync(process.execPath, ["--env-file-if-exists=.dev.vars", syncPath], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (sync.status !== 0) {
    console.warn("Local screener snapshot is unavailable; the screener will show an empty state until sync succeeds.");
  }
}

try {
  await chmod(devVarsPath, 0o600);
} catch {
  // The ignored local secrets file is optional or may be read-only.
}

if (
  !process.env.AINVEST_C_COOKIE?.trim() &&
  !(process.env.AINVEST_EMAIL?.trim() && process.env.AINVEST_PASSWORD?.trim())
) {
  console.warn("Market-data credentials are unavailable; APIs will fail closed.");
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
