import { getD1 } from "../../../../db";
import { screenerClientSnapshotResponse } from "../../../../lib/screener/client-snapshot-response";
import { readScreenerClientSnapshot } from "../../../../lib/screener/snapshot";

export async function GET(request: Request): Promise<Response> {
  try {
    const snapshot = await readScreenerClientSnapshot(await getD1());
    return screenerClientSnapshotResponse(request, snapshot);
  } catch {
    return screenerClientSnapshotResponse(request, null);
  }
}
