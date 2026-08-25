import type { ScreenerClientSnapshotPayload } from "../screener/client-snapshot-contract";
import type { ResolvedSecurity } from "../market-codes";

export type SnapshotRow = ScreenerClientSnapshotPayload["rows"][number];

export function snapshotRowForSecurity(
  snapshot: ScreenerClientSnapshotPayload,
  resolved: ResolvedSecurity,
): SnapshotRow | null {
  return (
    snapshot.rows.find(
      (row) =>
        row.marketCode === resolved.marketCode ||
        (row.exchange === resolved.exchange.toLowerCase() &&
          row.symbol.toUpperCase() === resolved.symbol.toUpperCase()),
    ) ?? null
  );
}
