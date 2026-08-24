import { isUsEquityTradingDay } from "../market-calendar.ts";
import { refreshScreenerSnapshot } from "./service.ts";
import {
  readScreenerSnapshotGeneration,
  type DurableScreenerSnapshot,
} from "./snapshot.ts";

const STALE_RUN_LEASE_MS = 30 * 60 * 1000;
const MAX_ERROR_MESSAGE_LENGTH = 500;

type StoredDailyRun = {
  status: "running" | "complete" | "failed";
  generation_id: string | null;
};

type SnapshotRefresh = (
  db: D1Database,
  options: {
    refreshedAt?: number;
    generationId?: string;
    dailyRunCompletion?: {
      tradingDate: string;
      leaseToken: string;
    };
  },
) => Promise<DurableScreenerSnapshot>;

type SnapshotGenerationRead = (
  db: D1Database,
  generationId: string,
) => Promise<DurableScreenerSnapshot | null>;

export type DailyScreenerSnapshotRefreshResult = {
  status: "published" | "already-published" | "in-progress";
  tradingDate: string;
  generationId: string | null;
};

type DailyRefreshOptions = {
  scheduledAt: number;
  now?: () => number;
  leaseToken?: string;
  refresh?: SnapshotRefresh;
  readGeneration?: SnapshotGenerationRead;
};

function dailyGenerationId(tradingDate: string): string {
  return `daily-${tradingDate}`;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown refresh error";
  return message.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

async function readDailyRun(
  db: D1Database,
  tradingDate: string,
): Promise<StoredDailyRun | null> {
  return db
    .prepare(
      `SELECT status, generation_id
       FROM screener_snapshot_daily_runs
       WHERE trading_date = ?
       LIMIT 1`,
    )
    .bind(tradingDate)
    .first<StoredDailyRun>();
}

async function claimDailyRun(
  db: D1Database,
  options: {
    tradingDate: string;
    scheduledAt: number;
    startedAt: number;
    leaseToken: string;
  },
): Promise<{ claimed: true } | { claimed: false; run: StoredDailyRun }> {
  const result = await db
    .prepare(
      `INSERT INTO screener_snapshot_daily_runs
       (trading_date, status, scheduled_at, started_at, completed_at,
        generation_id, attempt_count, lease_token, error_message)
       VALUES (?, 'running', ?, ?, NULL, NULL, 1, ?, NULL)
       ON CONFLICT(trading_date) DO UPDATE SET
         status = 'running',
         scheduled_at = excluded.scheduled_at,
         started_at = excluded.started_at,
         completed_at = NULL,
         generation_id = NULL,
         attempt_count = screener_snapshot_daily_runs.attempt_count + 1,
         lease_token = excluded.lease_token,
         error_message = NULL
       WHERE screener_snapshot_daily_runs.status = 'failed'
          OR (
            screener_snapshot_daily_runs.status = 'running'
            AND screener_snapshot_daily_runs.started_at <= ?
          )`,
    )
    .bind(
      options.tradingDate,
      options.scheduledAt,
      options.startedAt,
      options.leaseToken,
      options.startedAt - STALE_RUN_LEASE_MS,
    )
    .run();
  if ((result.meta.changes ?? 0) > 0) return { claimed: true };
  const run = await readDailyRun(db, options.tradingDate);
  if (!run) {
    throw new Error("The daily screener refresh lease could not be read.");
  }
  return { claimed: false, run };
}

async function completeDailyRun(
  db: D1Database,
  options: {
    tradingDate: string;
    leaseToken: string;
    generationId: string;
    completedAt: number;
  },
): Promise<void> {
  const result = await db
    .prepare(
      `UPDATE screener_snapshot_daily_runs
       SET status = 'complete',
           completed_at = ?,
           generation_id = ?,
           error_message = NULL
       WHERE trading_date = ?
         AND status = 'running'
         AND lease_token = ?`,
    )
    .bind(
      options.completedAt,
      options.generationId,
      options.tradingDate,
      options.leaseToken,
    )
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new Error("The daily screener refresh lease changed before completion.");
  }
}

async function failDailyRun(
  db: D1Database,
  options: {
    tradingDate: string;
    leaseToken: string;
    completedAt: number;
    error: unknown;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE screener_snapshot_daily_runs
       SET status = 'failed',
           completed_at = ?,
           generation_id = NULL,
           error_message = ?
       WHERE trading_date = ?
         AND status = 'running'
         AND lease_token = ?`,
    )
    .bind(
      options.completedAt,
      errorMessage(options.error),
      options.tradingDate,
      options.leaseToken,
    )
    .run();
}

export async function runDailyScreenerSnapshotRefresh(
  db: D1Database,
  tradingDate: string,
  options: DailyRefreshOptions,
): Promise<DailyScreenerSnapshotRefreshResult> {
  if (!isUsEquityTradingDay(tradingDate)) {
    throw new Error("A daily screener snapshot can only run for a US trading day.");
  }
  if (!Number.isSafeInteger(options.scheduledAt) || options.scheduledAt <= 0) {
    throw new Error("The daily screener refresh schedule timestamp was invalid.");
  }

  const now = options.now ?? Date.now;
  const startedAt = now();
  const leaseToken = options.leaseToken ?? crypto.randomUUID();
  const generationId = dailyGenerationId(tradingDate);
  const refresh = options.refresh ?? refreshScreenerSnapshot;
  const readGeneration =
    options.readGeneration ?? readScreenerSnapshotGeneration;
  const claim = await claimDailyRun(db, {
    tradingDate,
    scheduledAt: options.scheduledAt,
    startedAt,
    leaseToken,
  });
  if (!claim.claimed) {
    return {
      status:
        claim.run.status === "complete" ? "already-published" : "in-progress",
      tradingDate,
      generationId: claim.run.generation_id,
    };
  }

  try {
    const existing = await readGeneration(db, generationId);
    if (existing) {
      await completeDailyRun(db, {
        tradingDate,
        leaseToken,
        generationId: existing.generationId,
        completedAt: now(),
      });
      return {
        status: "already-published",
        tradingDate,
        generationId: existing.generationId,
      };
    }
    const snapshot = await refresh(db, {
      refreshedAt: startedAt,
      generationId,
      dailyRunCompletion: { tradingDate, leaseToken },
    });
    const completedRun = await readDailyRun(db, tradingDate);
    if (
      completedRun?.status !== "complete" ||
      completedRun.generation_id == null
    ) {
      // Dependency-injected refreshers and rolling upgrades may not yet append
      // the atomic ledger update. Keep a safe compatibility completion path.
      await completeDailyRun(db, {
        tradingDate,
        leaseToken,
        generationId: snapshot.generationId,
        completedAt: now(),
      });
    }
    return {
      status: "published",
      tradingDate,
      generationId:
        completedRun?.status === "complete" && completedRun.generation_id
          ? completedRun.generation_id
          : snapshot.generationId,
    };
  } catch (error) {
    // A Worker may be interrupted after the atomic generation write but before
    // its run-ledger update. Recover that deterministic daily generation rather
    // than fetching and publishing a second copy.
    const stored = await readGeneration(db, generationId).catch(() => null);
    if (stored) {
      await completeDailyRun(db, {
        tradingDate,
        leaseToken,
        generationId: stored.generationId,
        completedAt: now(),
      });
      return {
        status: "already-published",
        tradingDate,
        generationId: stored.generationId,
      };
    }
    await failDailyRun(db, {
      tradingDate,
      leaseToken,
      completedAt: now(),
      error,
    });
    throw error;
  }
}
