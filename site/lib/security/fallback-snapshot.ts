import { readFile } from "node:fs/promises";
import { getD1 } from "../../db";
import type { ScreenerClientSnapshotPayload } from "../screener/client-snapshot-contract";
import { readScreenerClientSnapshot } from "../screener/snapshot";

export async function securityFallbackSnapshot(): Promise<ScreenerClientSnapshotPayload | undefined> {
  if (process.env.NODE_ENV === "development") {
    try {
      return JSON.parse(
        await readFile(".local/screener-snapshot.json", "utf8"),
      ) as ScreenerClientSnapshotPayload;
    } catch {
      // Fall through to D1 so local Worker preview and tests share production behavior.
    }
  }
  try {
    const snapshot = await readScreenerClientSnapshot(await getD1());
    return snapshot
      ? (JSON.parse(snapshot.payloadJson) as ScreenerClientSnapshotPayload)
      : undefined;
  } catch {
    return undefined;
  }
}
