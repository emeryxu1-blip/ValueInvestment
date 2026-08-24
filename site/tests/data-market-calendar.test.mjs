import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isUsEquityTradingDay,
  newYorkWallClock,
} from "../lib/market-calendar.ts";
import {
  scheduledScreenerTradingDate,
  SCREENER_SNAPSHOT_REFRESH_CRON,
} from "../lib/screener/schedule.ts";

test("recognizes regular US equity holidays and adjacent trading days", () => {
  const closed2026 = [
    "2026-01-01",
    "2026-01-19",
    "2026-02-16",
    "2026-04-03",
    "2026-05-25",
    "2026-06-19",
    "2026-07-03",
    "2026-09-07",
    "2026-11-26",
    "2026-12-25",
  ];
  for (const date of closed2026) {
    assert.equal(isUsEquityTradingDay(date), false, `${date} should be closed`);
  }
  for (const date of [
    "2026-01-02",
    "2026-04-02",
    "2026-06-18",
    "2026-07-06",
    "2026-11-27",
    "2026-12-24",
  ]) {
    assert.equal(isUsEquityTradingDay(date), true, `${date} should be open`);
  }
});

test("handles NYSE New Year rules and confirmed one-off full-day closures", () => {
  assert.equal(
    isUsEquityTradingDay("2021-12-31"),
    true,
    "NYSE does not observe a Saturday New Year's Day on Friday",
  );
  assert.equal(isUsEquityTradingDay("2023-01-02"), false);
  assert.equal(isUsEquityTradingDay("2025-01-09"), false);
  assert.equal(isUsEquityTradingDay("2025-01-10"), true);
  assert.equal(isUsEquityTradingDay("2026-08-15"), false);
  assert.equal(isUsEquityTradingDay("2026-02-30"), false);
});

test("matches every published NYSE full-day closure for 2027 and 2028", () => {
  const publishedClosures = {
    2027: [
      "2027-01-01",
      "2027-01-18",
      "2027-02-15",
      "2027-03-26",
      "2027-05-31",
      "2027-06-18",
      "2027-07-05",
      "2027-09-06",
      "2027-11-25",
      "2027-12-24",
    ],
    2028: [
      "2028-01-17",
      "2028-02-21",
      "2028-04-14",
      "2028-05-29",
      "2028-06-19",
      "2028-07-04",
      "2028-09-04",
      "2028-11-23",
      "2028-12-25",
    ],
  };
  for (const [year, dates] of Object.entries(publishedClosures)) {
    for (const date of dates) {
      assert.equal(
        isUsEquityTradingDay(date),
        false,
        `NYSE lists ${date} as a ${year} full-day closure`,
      );
    }
  }
  assert.equal(
    isUsEquityTradingDay("2027-06-21"),
    true,
    "Juneteenth 2027 is observed on Friday June 18",
  );
  assert.equal(
    isUsEquityTradingDay("2028-06-16"),
    true,
    "Juneteenth 2028 falls on Monday June 19, not Friday June 16",
  );
  assert.equal(
    isUsEquityTradingDay("2027-12-31"),
    true,
    "NYSE publishes no Friday observance for Saturday January 1, 2028",
  );
});

test("resolves New York wall-clock time across daylight-saving changes", () => {
  assert.deepEqual(newYorkWallClock(Date.parse("2026-08-13T12:00:00Z")), {
    year: 2026,
    month: 8,
    day: 13,
    date: "2026-08-13",
    hour: 8,
    minute: 0,
  });
  assert.deepEqual(newYorkWallClock(Date.parse("2026-01-15T13:30:00Z")), {
    year: 2026,
    month: 1,
    day: 15,
    date: "2026-01-15",
    hour: 8,
    minute: 30,
  });
});

test("admits only the three pre-open ET attempts on trading days", () => {
  assert.equal(
    scheduledScreenerTradingDate(
      SCREENER_SNAPSHOT_REFRESH_CRON,
      Date.parse("2026-08-13T12:00:00Z"),
    ),
    "2026-08-13",
  );
  assert.equal(
    scheduledScreenerTradingDate(
      SCREENER_SNAPSHOT_REFRESH_CRON,
      Date.parse("2026-08-13T12:30:00Z"),
    ),
    "2026-08-13",
  );
  assert.equal(
    scheduledScreenerTradingDate(
      SCREENER_SNAPSHOT_REFRESH_CRON,
      Date.parse("2026-08-13T13:00:00Z"),
    ),
    "2026-08-13",
  );
  assert.equal(
    scheduledScreenerTradingDate(
      SCREENER_SNAPSHOT_REFRESH_CRON,
      Date.parse("2026-08-13T13:30:00Z"),
    ),
    null,
  );
  assert.equal(
    scheduledScreenerTradingDate(
      SCREENER_SNAPSHOT_REFRESH_CRON,
      Date.parse("2026-01-15T13:30:00Z"),
    ),
    "2026-01-15",
  );
  assert.equal(
    scheduledScreenerTradingDate(
      SCREENER_SNAPSHOT_REFRESH_CRON,
      Date.parse("2026-01-15T14:00:00Z"),
    ),
    "2026-01-15",
  );
  assert.equal(
    scheduledScreenerTradingDate(
      SCREENER_SNAPSHOT_REFRESH_CRON,
      Date.parse("2026-01-15T12:00:00Z"),
    ),
    null,
  );
  assert.equal(
    scheduledScreenerTradingDate(
      SCREENER_SNAPSHOT_REFRESH_CRON,
      Date.parse("2026-01-19T13:00:00Z"),
    ),
    null,
  );
});

test("Wrangler installs the exact named-weekday UTC cron grid", async () => {
  const raw = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const configuration = JSON.parse(raw);
  assert.equal(SCREENER_SNAPSHOT_REFRESH_CRON, "0,30 12-14 * * mon-fri");
  assert.ok(configuration.triggers.crons.includes(SCREENER_SNAPSHOT_REFRESH_CRON));
  assert.ok(
    SCREENER_SNAPSHOT_REFRESH_CRON.endsWith("mon-fri"),
    "numeric weekdays are ambiguous in Cloudflare's cron grammar",
  );
});
