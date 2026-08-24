const NEW_YORK_TIME_ZONE = "America/New_York";

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

export type NewYorkWallClock = CalendarDate & {
  date: string;
  hour: number;
  minute: number;
};

// Unscheduled exchange closures cannot be derived from the recurring holiday
// rules. Keep confirmed one-off full-day closures here so the scheduler has a
// single auditable override point.
const SPECIAL_FULL_DAY_CLOSURES = new Set([
  "2001-09-11",
  "2001-09-12",
  "2001-09-13",
  "2001-09-14",
  "2004-06-11",
  "2007-01-02",
  "2012-10-29",
  "2012-10-30",
  "2018-12-05",
  "2025-01-09",
]);

const newYorkFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NEW_YORK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateKey({ year, month, day }: CalendarDate): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function dateFromKey(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function utcDate({ year, month, day }: CalendarDate): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function shiftedDate(date: CalendarDate, days: number): CalendarDate {
  const shifted = utcDate(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function weekday(date: CalendarDate): number {
  return utcDate(date).getUTCDay();
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  targetWeekday: number,
  occurrence: number,
): CalendarDate {
  const first: CalendarDate = { year, month, day: 1 };
  const day = 1 + ((targetWeekday - weekday(first) + 7) % 7) + (occurrence - 1) * 7;
  return { year, month, day };
}

function lastWeekdayOfMonth(
  year: number,
  month: number,
  targetWeekday: number,
): CalendarDate {
  const firstOfNextMonth = new Date(Date.UTC(year, month, 1));
  firstOfNextMonth.setUTCDate(0);
  const last: CalendarDate = {
    year: firstOfNextMonth.getUTCFullYear(),
    month: firstOfNextMonth.getUTCMonth() + 1,
    day: firstOfNextMonth.getUTCDate(),
  };
  return shiftedDate(last, -((weekday(last) - targetWeekday + 7) % 7));
}

function observedFixedHoliday(year: number, month: number, day: number): CalendarDate {
  const holiday = { year, month, day };
  const holidayWeekday = weekday(holiday);
  if (holidayWeekday === 6) return shiftedDate(holiday, -1);
  if (holidayWeekday === 0) return shiftedDate(holiday, 1);
  return holiday;
}

function newYearsDayClosure(year: number): CalendarDate {
  const holiday = { year, month: 1, day: 1 };
  // NYSE does not close on the preceding Friday when January 1 is Saturday.
  // A Sunday January 1 is observed on Monday January 2.
  return weekday(holiday) === 0 ? shiftedDate(holiday, 1) : holiday;
}

// Gregorian computus (Meeus/Jones/Butcher), used to derive Good Friday.
function easterSunday(year: number): CalendarDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

function recurringFullDayClosures(year: number): Set<string> {
  const closures = new Set<string>();
  closures.add(dateKey(newYearsDayClosure(year)));
  closures.add(dateKey(nthWeekdayOfMonth(year, 1, 1, 3))); // MLK Day
  closures.add(dateKey(nthWeekdayOfMonth(year, 2, 1, 3))); // Washington's Birthday
  closures.add(dateKey(shiftedDate(easterSunday(year), -2))); // Good Friday
  closures.add(dateKey(lastWeekdayOfMonth(year, 5, 1))); // Memorial Day
  if (year >= 2022) {
    closures.add(dateKey(observedFixedHoliday(year, 6, 19))); // Juneteenth
  }
  closures.add(dateKey(observedFixedHoliday(year, 7, 4)));
  closures.add(dateKey(nthWeekdayOfMonth(year, 9, 1, 1))); // Labor Day
  closures.add(dateKey(nthWeekdayOfMonth(year, 11, 4, 4))); // Thanksgiving
  closures.add(dateKey(observedFixedHoliday(year, 12, 25)));
  return closures;
}

export function newYorkWallClock(timestamp: number): NewYorkWallClock {
  if (!Number.isFinite(timestamp)) {
    throw new Error("The scheduled market timestamp was invalid.");
  }
  const values = new Map(
    newYorkFormatter
      .formatToParts(new Date(timestamp))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  const hour = values.get("hour");
  const minute = values.get("minute");
  if (
    year == null ||
    month == null ||
    day == null ||
    hour == null ||
    minute == null
  ) {
    throw new Error("The New York market timestamp could not be resolved.");
  }
  return {
    year,
    month,
    day,
    hour,
    minute,
    date: dateKey({ year, month, day }),
  };
}

export function isUsEquityTradingDay(value: string): boolean {
  const date = dateFromKey(value);
  if (!date) return false;
  const dayOfWeek = weekday(date);
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  if (SPECIAL_FULL_DAY_CLOSURES.has(value)) return false;
  return !recurringFullDayClosures(date.year).has(value);
}
