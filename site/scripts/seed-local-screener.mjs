#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const wranglerPath = resolve(projectRoot, "node_modules/.bin/wrangler");
const migration = spawn(
  wranglerPath,
  ["d1", "migrations", "apply", "value-investment", "--local", "--config", "wrangler.jsonc"],
  { cwd: projectRoot, stdio: "inherit" },
);

const exitCode = await new Promise((resolveExit) => {
  migration.once("error", (error) => {
    console.error("Unable to run local D1 migrations.", error);
    resolveExit(1);
  });
  migration.once("exit", (code) => resolveExit(code ?? 1));
});
if (exitCode !== 0) process.exit(exitCode);

const baseUrl = process.env.LOCAL_URL ?? "http://localhost:3000";
const date = process.argv[2] ? `?date=${encodeURIComponent(process.argv[2])}` : "";
const response = await fetch(`${baseUrl}/api/screener/snapshot/seed${date}`, {
  method: "POST",
});
const body = await response.text();
console.log(body);
if (!response.ok) process.exit(1);
