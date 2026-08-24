#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const snapshotPath = resolve(projectRoot, ".local/screener-snapshot.json");
const source =
  process.env.SCREENER_SNAPSHOT_SYNC_URL?.trim() ||
  "https://value-investment.emery-xu1.workers.dev/api/screener/snapshot?schema=3";

const response = await fetch(source, { headers: { Accept: "application/json" } });
if (!response.ok) {
  throw new Error(`Snapshot sync failed with HTTP ${response.status}.`);
}
const payload = await response.json();
if (
  !payload ||
  typeof payload !== "object" ||
  !Number.isSafeInteger(payload.schemaVersion) ||
  typeof payload.generationId !== "string" ||
  !Number.isSafeInteger(payload.total) ||
  !Array.isArray(payload.rows) ||
  payload.rows.length !== payload.total
) {
  throw new Error("Snapshot sync returned an invalid payload.");
}
await mkdir(dirname(snapshotPath), { recursive: true });
await writeFile(snapshotPath, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
console.log(`Saved ${payload.rows.length} screener rows to ${snapshotPath}.`);
