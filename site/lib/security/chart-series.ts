export type ChartPoint = {
  time: string;
  value: number;
};

export function referencePriceFromLines(
  lines: ReadonlyArray<{
    seriesKind?: "historical" | "reference-overlay" | "model-period";
    points: ReadonlyArray<{ value: number }>;
  }>,
): number | null {
  const reference = lines.find(
    (line) => line.seriesKind === "reference-overlay" && line.points.length === 1,
  );
  const value = reference?.points[0]?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export type ChartCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const COMPACT_DATE = /^(\d{4})(\d{2})(\d{2})$/;
const NUMERIC_TIMESTAMP = /^\d{10,13}(?:\.\d+)?$/;
const MIN_TIMESTAMP_MS = Date.UTC(1990, 0, 1);
const MAX_TIMESTAMP_MS = Date.UTC(2200, 0, 1);
const MIN_CALENDAR_YEAR = 1990;
const MAX_CALENDAR_YEAR = 2200;

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/[,$%]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function dateToIsoDate(date: Date | null): string | null {
  return !date || Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
}

function timestampToDate(value: number): Date | null {
  // AInvest timestamps are milliseconds. Accept seconds too so this helper is
  // safe at the browser/server boundary if a compatible endpoint is added.
  const milliseconds = Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
  if (!Number.isFinite(milliseconds) || milliseconds < MIN_TIMESTAMP_MS || milliseconds > MAX_TIMESTAMP_MS) {
    return null;
  }
  return new Date(milliseconds);
}

function validCalendarDate(year: number, month: number, day: number): string | null {
  if (
    year < MIN_CALENDAR_YEAR ||
    year > MAX_CALENDAR_YEAR ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function compactNumberToIso(value: number): string | null {
  if (!Number.isInteger(value)) return null;
  const text = String(value);
  if (!/^\d{8}$/.test(text)) return null;
  return validCalendarDate(
    Number(text.slice(0, 4)),
    Number(text.slice(4, 6)),
    Number(text.slice(6, 8)),
  );
}

function compactToTimestamp(value: number): number | null {
  const iso = compactNumberToIso(value);
  if (!iso) return null;
  return Date.parse(`${iso}T00:00:00.000Z`);
}

/**
 * Convert provider time values to the daily ISO keys accepted by Lightweight
 * Charts. Invalid calendar dates are rejected instead of reaching the chart.
 */
export function canonicalChartTime(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value) && value >= 10_000_000 && value <= 99_999_999) {
      return compactNumberToIso(value);
    }
    return dateToIsoDate(timestampToDate(value));
  }

  if (value instanceof Date) {
    const milliseconds = value.valueOf();
    return milliseconds >= MIN_TIMESTAMP_MS && milliseconds <= MAX_TIMESTAMP_MS
      ? dateToIsoDate(value)
      : null;
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  const isoMatch = ISO_DATE.exec(trimmed);
  if (isoMatch) {
    return validCalendarDate(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
    );
  }

  const compactMatch = COMPACT_DATE.exec(trimmed);
  if (compactMatch) {
    return validCalendarDate(
      Number(compactMatch[1]),
      Number(compactMatch[2]),
      Number(compactMatch[3]),
    );
  }

  if (NUMERIC_TIMESTAMP.test(trimmed)) {
    const timestamp = Number(trimmed);
    if (!Number.isFinite(timestamp)) return null;
    if (Number.isInteger(timestamp) && timestamp >= 10_000_000 && timestamp <= 99_999_999) {
      return compactNumberToIso(timestamp);
    }
    return dateToIsoDate(timestampToDate(timestamp));
  }
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;

  const parsed = Date.parse(trimmed);
  return parsed >= MIN_TIMESTAMP_MS && parsed <= MAX_TIMESTAMP_MS
    ? dateToIsoDate(new Date(parsed))
    : null;
}

/**
 * Produce strict ascending, unique data for a Lightweight Charts line/area
 * series. If a provider repeats a day, the last returned observation wins.
 */
export function normalizeChartPoints(
  points: ReadonlyArray<{ time: unknown; value: unknown }>,
): ChartPoint[] {
  const byTime = new Map<string, number>();
  for (const point of points) {
    const time = canonicalChartTime(point.time);
    const value = finiteNumber(point.value);
    if (!time || value === null) continue;
    byTime.set(time, value);
  }
  return [...byTime.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([time, value]) => ({ time, value }));
}

/**
 * Normalize close-only K-line rows for the line/area price chart. OHLC fields
 * are intentionally not required because the current UI renders closing price,
 * and providers may omit unused fields for some instruments.
 */
export function normalizeChartPricePoints(
  candles: ReadonlyArray<{
    time: unknown;
    timestamp?: unknown;
    close: unknown;
  }>,
): ChartPoint[] {
  return normalizeChartPoints(
    candles.map((candle) => ({
      time: candle.timestamp ?? candle.time,
      value: candle.close,
    })),
  );
}

/**
 * Produce strict ascending, unique daily OHLC data for a candlestick series.
 */
export function normalizeChartCandles(
  candles: ReadonlyArray<{
    time: unknown;
    timestamp?: unknown;
    open: unknown;
    high: unknown;
    low: unknown;
    close: unknown;
    volume?: unknown;
  }>,
): ChartCandle[] {
  const byTime = new Map<string, ChartCandle>();
  for (const candle of candles) {
    const time = canonicalChartTime(candle.timestamp ?? candle.time);
    const open = finiteNumber(candle.open);
    const high = finiteNumber(candle.high);
    const low = finiteNumber(candle.low);
    const close = finiteNumber(candle.close);
    if (
      !time ||
      open === null ||
      high === null ||
      low === null ||
      close === null
    ) {
      continue;
    }
    byTime.set(time, {
      time,
      open,
      high,
      low,
      close,
      volume: finiteNumber(candle.volume),
    });
  }
  return [...byTime.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, candle]) => candle);
}

export function mergeChartPoints(
  current: ReadonlyArray<{ time: unknown; value: unknown }>,
  incoming: ReadonlyArray<{ time: unknown; value: unknown }>,
): ChartPoint[] {
  return normalizeChartPoints([...current, ...incoming]);
}

export function mergeChartCandles(
  current: ReadonlyArray<{
    time: unknown;
    timestamp?: unknown;
    open: unknown;
    high: unknown;
    low: unknown;
    close: unknown;
    volume?: unknown;
  }>,
  incoming: ReadonlyArray<{
    time: unknown;
    timestamp?: unknown;
    open: unknown;
    high: unknown;
    low: unknown;
    close: unknown;
    volume?: unknown;
  }>,
): ChartCandle[] {
  return normalizeChartCandles([...current, ...incoming]);
}

/**
 * The AInvest K-line `end_time` is inclusive. Return a strict cursor so the
 * next request cannot return the same oldest bar forever.
 */
export function cursorBeforeTime(time: string | null | undefined): number | null {
  if (!time) return null;
  const timestamp = Date.parse(time);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return timestamp - 1;
}

export function timeToTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value) && value >= 10_000_000 && value <= 99_999_999) {
      return compactToTimestamp(value);
    }
    const milliseconds = Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
    return milliseconds >= MIN_TIMESTAMP_MS && milliseconds <= MAX_TIMESTAMP_MS
      ? milliseconds
      : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const trimmed = value.trim();
    const numeric = Number(trimmed.replace(/[,$]/g, ""));
    if (Number.isFinite(numeric)) {
      if (Number.isInteger(numeric) && numeric >= 10_000_000 && numeric <= 99_999_999) {
        return compactToTimestamp(numeric);
      }
      const milliseconds = Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric;
      return milliseconds >= MIN_TIMESTAMP_MS && milliseconds <= MAX_TIMESTAMP_MS
        ? milliseconds
        : null;
    }
    const parsed = Date.parse(trimmed);
    return parsed >= MIN_TIMESTAMP_MS && parsed <= MAX_TIMESTAMP_MS ? parsed : null;
  }
  if (value instanceof Date) {
    const milliseconds = value.valueOf();
    return milliseconds >= MIN_TIMESTAMP_MS && milliseconds <= MAX_TIMESTAMP_MS
      ? milliseconds
      : null;
  }
  return null;
}
