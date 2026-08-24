import assert from "node:assert/strict";
import test, { after } from "node:test";

import { register } from "tsx/esm/api";

const typescript = register({ namespace: "screener-daily-refresh-data-tests" });
const { runDailyScreenerSnapshotRefresh } = await typescript.import(
  "../lib/screener/daily-refresh.ts",
  import.meta.url,
);

after(async () => {
  await typescript.unregister();
});

function dailyRunDatabase() {
  const runs = new Map();

  function statement(sql) {
    return {
      sql,
      values: [],
      bind(...values) {
        this.values = values;
        return this;
      },
      async first() {
        if (!/SELECT status, generation_id/.test(sql)) {
          throw new Error(`Unexpected daily-run first statement: ${sql}`);
        }
        const run = runs.get(this.values[0]);
        return run
          ? { status: run.status, generation_id: run.generationId }
          : null;
      },
      async run() {
        if (/INSERT INTO screener_snapshot_daily_runs/.test(sql)) {
          const [tradingDate, scheduledAt, startedAt, leaseToken, staleBefore] =
            this.values;
          const current = runs.get(tradingDate);
          const canClaim =
            !current ||
            current.status === "failed" ||
            (current.status === "running" && current.startedAt <= staleBefore);
          if (!canClaim) return { meta: { changes: 0 } };
          runs.set(tradingDate, {
            status: "running",
            scheduledAt,
            startedAt,
            completedAt: null,
            generationId: null,
            attemptCount: (current?.attemptCount ?? 0) + 1,
            leaseToken,
            errorMessage: null,
          });
          return { meta: { changes: 1 } };
        }
        if (/SET status = 'complete'/.test(sql)) {
          const [completedAt, generationId, tradingDate, leaseToken] = this.values;
          const run = runs.get(tradingDate);
          if (
            !run ||
            run.status !== "running" ||
            run.leaseToken !== leaseToken
          ) {
            return { meta: { changes: 0 } };
          }
          Object.assign(run, {
            status: "complete",
            completedAt,
            generationId,
            errorMessage: null,
          });
          return { meta: { changes: 1 } };
        }
        if (/SET status = 'failed'/.test(sql)) {
          const [completedAt, errorMessage, tradingDate, leaseToken] = this.values;
          const run = runs.get(tradingDate);
          if (
            !run ||
            run.status !== "running" ||
            run.leaseToken !== leaseToken
          ) {
            return { meta: { changes: 0 } };
          }
          Object.assign(run, {
            status: "failed",
            completedAt,
            generationId: null,
            errorMessage,
          });
          return { meta: { changes: 1 } };
        }
        throw new Error(`Unexpected daily-run write statement: ${sql}`);
      },
    };
  }

  return {
    db: { prepare: statement },
    runs,
  };
}

function snapshot(generationId, refreshedAt) {
  return {
    generationId,
    universeRefreshedAt: refreshedAt - 1,
    refreshedAt,
    rows: [],
  };
}

test("publishes one deterministic generation per trading date", async () => {
  const database = dailyRunDatabase();
  const scheduledAt = Date.parse("2026-08-13T12:00:00Z");
  let refreshCalls = 0;
  const refresh = async (_db, options) => {
    refreshCalls += 1;
    assert.equal(options.generationId, "daily-2026-08-13");
    assert.equal(options.refreshedAt, scheduledAt + 1_000);
    return snapshot(options.generationId, options.refreshedAt);
  };
  const first = await runDailyScreenerSnapshotRefresh(
    database.db,
    "2026-08-13",
    {
      scheduledAt,
      now: () => scheduledAt + 1_000,
      leaseToken: "lease-first",
      refresh,
      readGeneration: async () => null,
    },
  );
  const second = await runDailyScreenerSnapshotRefresh(
    database.db,
    "2026-08-13",
    {
      scheduledAt: scheduledAt + 30 * 60 * 1_000,
      now: () => scheduledAt + 30 * 60 * 1_000,
      leaseToken: "lease-second",
      refresh,
      readGeneration: async () => null,
    },
  );

  assert.deepEqual(first, {
    status: "published",
    tradingDate: "2026-08-13",
    generationId: "daily-2026-08-13",
  });
  assert.deepEqual(second, {
    status: "already-published",
    tradingDate: "2026-08-13",
    generationId: "daily-2026-08-13",
  });
  assert.equal(refreshCalls, 1);
  assert.equal(database.runs.get("2026-08-13").attemptCount, 1);
});

test("records a failed first attempt and lets the pre-open retry publish", async () => {
  const database = dailyRunDatabase();
  const firstScheduledAt = Date.parse("2026-08-14T12:00:00Z");
  await assert.rejects(
    runDailyScreenerSnapshotRefresh(database.db, "2026-08-14", {
      scheduledAt: firstScheduledAt,
      now: () => firstScheduledAt + 1_000,
      leaseToken: "lease-failed",
      refresh: async () => {
        throw new Error("provider unavailable");
      },
      readGeneration: async () => null,
    }),
    /provider unavailable/,
  );
  assert.equal(database.runs.get("2026-08-14").status, "failed");
  assert.equal(
    database.runs.get("2026-08-14").errorMessage,
    "provider unavailable",
  );

  const retryAt = firstScheduledAt + 30 * 60 * 1_000;
  const result = await runDailyScreenerSnapshotRefresh(
    database.db,
    "2026-08-14",
    {
      scheduledAt: retryAt,
      now: () => retryAt + 1_000,
      leaseToken: "lease-retry",
      refresh: async (_db, options) =>
        snapshot(options.generationId, options.refreshedAt),
      readGeneration: async () => null,
    },
  );
  assert.equal(result.status, "published");
  assert.equal(database.runs.get("2026-08-14").status, "complete");
  assert.equal(database.runs.get("2026-08-14").attemptCount, 2);
});

test("does not overlap a live lease and recovers an already-written generation", async () => {
  const database = dailyRunDatabase();
  const scheduledAt = Date.parse("2026-08-17T12:00:00Z");
  database.runs.set("2026-08-17", {
    status: "running",
    scheduledAt,
    startedAt: scheduledAt - 5 * 60 * 1_000,
    completedAt: null,
    generationId: null,
    attemptCount: 1,
    leaseToken: "live-lease",
    errorMessage: null,
  });
  let refreshCalls = 0;
  const liveResult = await runDailyScreenerSnapshotRefresh(
    database.db,
    "2026-08-17",
    {
      scheduledAt,
      now: () => scheduledAt,
      leaseToken: "overlap",
      refresh: async () => {
        refreshCalls += 1;
        return snapshot("unexpected", scheduledAt);
      },
      readGeneration: async () => null,
    },
  );
  assert.equal(liveResult.status, "in-progress");
  assert.equal(refreshCalls, 0);

  database.runs.get("2026-08-17").status = "failed";
  database.runs.get("2026-08-17").completedAt = scheduledAt;
  const recovered = await runDailyScreenerSnapshotRefresh(
    database.db,
    "2026-08-17",
    {
      scheduledAt: scheduledAt + 30 * 60 * 1_000,
      now: () => scheduledAt + 30 * 60 * 1_000,
      leaseToken: "recovery",
      refresh: async () => {
        refreshCalls += 1;
        return snapshot("unexpected", scheduledAt);
      },
      readGeneration: async (_db, generationId) =>
        snapshot(generationId, scheduledAt),
    },
  );
  assert.equal(recovered.status, "already-published");
  assert.equal(recovered.generationId, "daily-2026-08-17");
  assert.equal(refreshCalls, 0);
});

test("rejects weekends and exchange holidays before touching D1", async () => {
  const db = {
    prepare() {
      assert.fail("D1 must not be touched for a non-trading date");
    },
  };
  await assert.rejects(
    runDailyScreenerSnapshotRefresh(db, "2026-08-15", {
      scheduledAt: Date.parse("2026-08-15T12:00:00Z"),
    }),
    /only run for a US trading day/i,
  );
  await assert.rejects(
    runDailyScreenerSnapshotRefresh(db, "2026-12-25", {
      scheduledAt: Date.parse("2026-12-25T13:00:00Z"),
    }),
    /only run for a US trading day/i,
  );
});
