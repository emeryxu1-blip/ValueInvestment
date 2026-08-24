import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getD1 } from "../../../../db";
import { screenerClientSnapshotResponse } from "../../../../lib/screener/client-snapshot-response";
import { readScreenerClientSnapshot } from "../../../../lib/screener/snapshot";

async function readLocalSnapshot(): Promise<Response | null> {
  if (process.env.NODE_ENV !== "development") return null;
  try {
    const payload = await readFile(
      resolve(process.cwd(), ".local/screener-snapshot.json"),
      "utf8",
    );
    return new Response(payload, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "X-Screener-Local-Source": "synced-snapshot",
      },
    });
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "development") {
    const local = await readLocalSnapshot();
    if (local) return local;
  }
  try {
    const snapshot = await readScreenerClientSnapshot(await getD1());
    return screenerClientSnapshotResponse(request, snapshot);
  } catch {
    return screenerClientSnapshotResponse(request, null);
  }
}
