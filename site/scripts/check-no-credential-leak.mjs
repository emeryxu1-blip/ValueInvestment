#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const devVarsPath = resolve(projectRoot, ".dev.vars");
const roots = [
  "dist",
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

let devVars = "";
try {
  devVars = await readFile(devVarsPath, "utf8");
} catch {
  // Local login credentials are optional during CI and fail-closed builds.
}

function envFileValue(name) {
  const match = devVars.match(
    new RegExp(`^(?:export[ \\t]+)?${name}[ \\t]*=[ \\t]*(.*)$`, "m"),
  );
  if (!match) return null;
  const value = match[1].trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

const needles = [
  envFileValue("AINVEST_USERID"),
  envFileValue("AINVEST_SESSIONID"),
  process.env.AINVEST_USERID,
  process.env.AINVEST_SESSIONID,
]
  .filter((value) => typeof value === "string" && value.length > 0)
  .filter((value, index, values) => values.indexOf(value) === index)
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
  if (!details.isFile()) return;

  const overlapLength = Math.max(
    0,
    ...needles.map((needle) => needle.length - 1),
  );
  let overlap = Buffer.alloc(0);
  for await (const chunk of createReadStream(target)) {
    const contents = overlap.length > 0 ? Buffer.concat([overlap, chunk]) : chunk;
    if (needles.some((needle) => contents.includes(needle))) {
      hits.push(target);
      return;
    }
    overlap = overlapLength > 0 ? contents.subarray(-overlapLength) : overlap;
  }
}

const hits = [];
for (const root of roots) await scan(resolve(projectRoot, root), hits);

devVars = "";
if (needles.length === 0) {
  console.log("Credential scan skipped: no local authentication values are available.");
  process.exit(0);
}
if (hits.length > 0) {
  console.error(
    `Credential material found in ${hits.length} generated or source file(s):\n${hits
      .map((hit) => `- ${relative(projectRoot, hit)}`)
      .join("\n")}`,
  );
  process.exit(1);
}
console.log(
  "Credential scan passed: no authentication values in source, assets, bundles, or local build logs.",
);
