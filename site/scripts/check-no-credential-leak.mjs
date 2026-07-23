#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const authPath = resolve(projectRoot, "../skills/Cauth.json");
const roots = [
  "dist",
  ".next",
  ".open-next",
  ".vinext",
  ".wrangler",
  "public",
  "app",
  "components",
  "db",
  "docs",
  "drizzle",
  "lib",
  "data",
  "worker",
  ".openai",
  "scripts",
  "tests",
  "package.json",
  "package-lock.json",
  "README.md",
  "open-next.config.ts",
  "vite.config.ts",
  "worker-configuration.d.ts",
  "wrangler.jsonc",
];

let credentials;
try {
  credentials = JSON.parse(await readFile(authPath, "utf8"));
} catch {
  console.log("Credential scan skipped: local Cauth.json is unavailable.");
  process.exit(0);
}

const needles = [
  credentials.userid,
  credentials.sessionid,
  credentials.userid ? `userid=${credentials.userid}` : null,
  credentials.sessionid ? `sessionid=${credentials.sessionid}` : null,
]
  .filter((value) => typeof value === "string" && value.length > 0)
  .map((value) => Buffer.from(value));

async function scan(target, hits) {
  let details;
  try {
    details = await stat(target);
  } catch {
    return;
  }
  if (details.isDirectory()) {
    for (const child of await readdir(target)) {
      await scan(resolve(target, child), hits);
    }
    return;
  }
  if (!details.isFile() || details.size > 8_000_000) return;
  const contents = await readFile(target);
  if (needles.some((needle) => contents.includes(needle))) hits.push(target);
}

const hits = [];
for (const root of roots) await scan(resolve(projectRoot, root), hits);

credentials = undefined;
if (hits.length > 0) {
  console.error(`Credential material found in ${hits.length} generated or source file(s).`);
  process.exit(1);
}
console.log(
  "Credential scan passed: no userid/sessionid values in source, assets, bundles, or local build logs.",
);
