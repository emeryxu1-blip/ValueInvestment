import {
  isUsEquityTradingDay,
  newYorkWallClock,
} from "../market-calendar.ts";

// Cloudflare Cron Triggers are UTC-only. This expression fires every 30 minutes
// from 12:00 through 14:30 UTC on weekdays; the New York wall-clock gate below
// admits only 08:00, 08:30, and 09:00 ET. That yields the same three pre-open
// attempts across both EST and EDT without relying on a fixed UTC offset.
export const SCREENER_SNAPSHOT_REFRESH_CRON = "0,30 12-14 * * mon-fri";

const PREMARKET_ATTEMPTS = new Set([8 * 60, 8 * 60 + 30, 9 * 60]);

export function scheduledScreenerTradingDate(
  cron: string,
  scheduledTime: number,
): string | null {
  if (cron !== SCREENER_SNAPSHOT_REFRESH_CRON) return null;
  const marketTime = newYorkWallClock(scheduledTime);
  if (
    !PREMARKET_ATTEMPTS.has(marketTime.hour * 60 + marketTime.minute) ||
    !isUsEquityTradingDay(marketTime.date)
  ) {
    return null;
  }
  return marketTime.date;
}
