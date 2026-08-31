export type AInvestIndicatorMeta = {
  id?: string;
  req_unique_id?: string;
  attr?: { value_type?: string; unit?: string; [key: string]: unknown };
};

export type AInvestCell = {
  t?: number | string;
  v?: unknown;
  value?: Array<{ t?: number | string; v?: unknown }>;
};

export type NormalizedValue = {
  id: string;
  requestId: string;
  value: unknown;
  asOf: string | null;
  valueType: string | null;
  unit: string | null;
  rawUnit: string | null;
};

export type NormalizedSnapshotRow = {
  symbolCode: string;
  values: Record<string, NormalizedValue>;
};

export type NormalizedSeriesRow = {
  symbolCode: string;
  asOf: string | null;
  values: Record<string, { id: string; points: Array<{ time: string; value: number }> }>;
};

const MIN_PROVIDER_TIMESTAMP_MS = Date.UTC(1990, 0, 1);
const MAX_PROVIDER_TIMESTAMP_MS = Date.UTC(2200, 0, 1);

type SnapshotEnvelope = {
  data?: {
    indicator?: AInvestIndicatorMeta[];
    data?: Array<{ symbol_code?: string; value?: AInvestCell[] }>;
    page?: { total?: number };
    symbol_list?: string[];
    as_of?: unknown;
    timestamp?: unknown;
  };
};

function finiteNumeric(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/[,$]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function timestampToMilliseconds(timestamp: unknown): number | null {
  const raw = typeof timestamp === "string" ? timestamp.trim() : timestamp;
  if (typeof raw === "string" && raw !== "" && !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw)) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) && parsed >= MIN_PROVIDER_TIMESTAMP_MS && parsed <= MAX_PROVIDER_TIMESTAMP_MS
      ? parsed
      : null;
  }
  const numeric = finiteNumeric(raw);
  if (numeric === null) return null;
  if (
    Number.isInteger(numeric) &&
    numeric >= 10_000_000 &&
    numeric <= 99_999_999
  ) {
    const text = String(numeric);
    const year = Number(text.slice(0, 4));
    const month = Number(text.slice(4, 6));
    const day = Number(text.slice(6, 8));
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return date.valueOf();
    }
    return null;
  }
  const milliseconds = Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric;
  return milliseconds >= MIN_PROVIDER_TIMESTAMP_MS && milliseconds <= MAX_PROVIDER_TIMESTAMP_MS
    ? milliseconds
    : null;
}

function timestampToIso(timestamp: unknown): string | null {
  const milliseconds = timestampToMilliseconds(timestamp);
  if (milliseconds === null) return null;
  const date = new Date(milliseconds);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function timestampForKline(value: unknown): number | null {
  const numeric = finiteNumeric(value);
  if (numeric === null) return null;
  if (
    Number.isInteger(numeric) &&
    numeric >= 10_000_000 &&
    numeric <= 99_999_999
  ) {
    const text = String(numeric);
    const year = Number(text.slice(0, 4));
    const month = Number(text.slice(4, 6));
    const day = Number(text.slice(6, 8));
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
      ? date.valueOf()
      : null;
  }
  const milliseconds = Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric;
  return milliseconds >= MIN_PROVIDER_TIMESTAMP_MS && milliseconds <= MAX_PROVIDER_TIMESTAMP_MS
    ? milliseconds
    : null;
}

export function normalizeSnapshot(payload: unknown): {
  rows: NormalizedSnapshotRow[];
  total: number;
  symbolList: string[];
  indicators: AInvestIndicatorMeta[];
} {
  const envelope = (payload ?? {}) as SnapshotEnvelope;
  if (!envelope.data || !Array.isArray(envelope.data.data)) {
    return { rows: [], total: 0, symbolList: [], indicators: [] };
  }
  const indicators = Array.isArray(envelope.data.indicator)
    ? envelope.data.indicator
    : [];
  const data = envelope.data.data;
  const rows = data.map((rawRow) => {
    const cells = Array.isArray(rawRow.value) ? rawRow.value : [];
    const values: Record<string, NormalizedValue> = {};
    indicators.forEach((indicator, index) => {
      const requestId = indicator.req_unique_id || indicator.id || `indicator_${index}`;
      const cell = cells[index] ?? {};
      values[requestId] = {
        id: indicator.id ?? requestId,
        requestId,
        value: Object.hasOwn(cell, "v") ? cell.v : null,
        asOf: timestampToIso(cell.t),
        valueType:
          typeof indicator.attr?.value_type === "string"
            ? indicator.attr.value_type
            : null,
        unit:
          typeof indicator.attr?.unit === "string"
            ? indicator.attr.unit
            : indicator.attr?.value_type === "ratio" ||
                indicator.attr?.value_type === "ratio2"
              ? "%"
              : null,
        rawUnit:
          typeof indicator.attr?.unit === "string"
            ? indicator.attr.unit
            : indicator.attr?.value_type === "ratio" ||
                indicator.attr?.value_type === "ratio2"
              ? "%"
              : null,
      };
    });
    return {
      symbolCode: typeof rawRow.symbol_code === "string" ? rawRow.symbol_code : "",
      values,
    };
  });
  return {
    rows,
    total:
      typeof envelope.data?.page?.total === "number"
        ? envelope.data.page.total
        : rows.length,
    symbolList: Array.isArray(envelope.data?.symbol_list)
      ? envelope.data.symbol_list.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    indicators,
  };
}

export function normalizeSeries(payload: unknown): NormalizedSeriesRow[] {
  const envelope = (payload ?? {}) as {
    data?: {
      indicator?: AInvestIndicatorMeta[];
      data?: Array<{ symbol_code?: string; value?: AInvestCell[] }>;
      as_of?: unknown;
      timestamp?: unknown;
      timestamp_ms?: unknown;
    };
  };
  const indicators = Array.isArray(envelope.data?.indicator)
    ? envelope.data.indicator
    : [];
  const rows = Array.isArray(envelope.data?.data) ? envelope.data.data : [];
  const providerAsOf = timestampToIso(
    envelope.data?.as_of ?? envelope.data?.timestamp ?? envelope.data?.timestamp_ms,
  );
  return rows.map((row) => {
    const cells = Array.isArray(row.value) ? row.value : [];
    const values: Record<
      string,
      { id: string; points: Array<{ time: string; value: number }> }
    > = {};
    indicators.forEach((indicator, index) => {
      const requestId = indicator.req_unique_id || indicator.id || `indicator_${index}`;
      const rawPoints = Array.isArray(cells[index]?.value) ? cells[index].value : [];
      values[requestId] = {
        id: indicator.id ?? requestId,
        points: rawPoints
          .map((point) => {
            const time = timestampToIso(point.t);
            const value = finiteNumeric(point.v);
            return time && value !== null ? { time, value } : null;
          })
          .filter(
            (point): point is { time: string; value: number } => point !== null,
          ),
      };
    });
    return {
      symbolCode: typeof row.symbol_code === "string" ? row.symbol_code : "",
      asOf: providerAsOf,
      values,
    };
  });
}

export function normalizeKline(payload: unknown): Array<{
  marketCode: string;
  points: Array<{
    time: string;
    timestamp: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
  }>;
}> {
  const quoteData = (payload as {
    data?: {
      quote_data?: Array<{
        market?: unknown;
        code?: unknown;
        data_fields?: unknown;
        value?: unknown;
      }>;
    };
  })?.data?.quote_data;
  if (!Array.isArray(quoteData)) return [];
  return quoteData.map((quote) => {
    const fields = Array.isArray(quote.data_fields)
      ? quote.data_fields.map(String)
      : [];
    const rows = Array.isArray(quote.value) ? quote.value : [];
    const index = (field: string) => fields.indexOf(field);
    const numberAt = (row: unknown[], field: string) => {
      const fieldIndex = index(field);
      return fieldIndex < 0 ? null : finiteNumeric(row[fieldIndex]);
    };
    return {
      marketCode: `${String(quote.market ?? "")}:${String(quote.code ?? "")}`,
      points: rows
        .filter((row): row is unknown[] => Array.isArray(row))
        .map((row) => {
          const timestamp = timestampForKline(row[index("1")]);
          const date = timestamp == null ? null : new Date(timestamp);
          return {
            time:
              date && !Number.isNaN(date.valueOf())
                ? date.toISOString().slice(0, 10)
                : "",
            timestamp,
            open: numberAt(row, "7"),
            high: numberAt(row, "8"),
            low: numberAt(row, "9"),
            close: numberAt(row, "11"),
            volume: numberAt(row, "13"),
          };
        })
        .filter((point) => point.time),
    };
  });
}

export function numberValue(
  row: NormalizedSnapshotRow | undefined,
  requestId: string,
): number | null {
  return finiteNumeric(row?.values[requestId]?.value);
}

export function displayNumberValue(
  row: NormalizedSnapshotRow | undefined,
  requestId: string,
): number | null {
  const raw = numberValue(row, requestId);
  const metadata = row?.values[requestId];
  if (raw == null || metadata?.valueType !== "ratio2") return raw;
  if (metadata.rawUnit === "x100") return raw;
  if (metadata.rawUnit === "x1000") return raw / 10;
  if (metadata.rawUnit === "%" || metadata.unit === "%") return raw * 100;
  if (metadata.valueType === "ratio2") return raw * 100;
  return null;
}

/**
 * Normalize a provider ratio to its fractional form for calculations.
 *
 * AInvest can encode ratios as an already fractional value, a percentage, or
 * a scaled `ratio2` value. Keeping this conversion beside the snapshot
 * metadata parser prevents company and peer ratios from silently using
 * different scales.
 */
export function ratioNumberValue(
  row: NormalizedSnapshotRow | undefined,
  requestId: string,
): number | null {
  const raw = numberValue(row, requestId);
  const metadata = row?.values[requestId];
  if (raw == null) return null;

  if (metadata?.valueType === "ratio2") {
    if (metadata.rawUnit === "x100") return raw / 100;
    if (metadata.rawUnit === "x1000") return raw / 1000;
    if (metadata.rawUnit === "%") return raw;
    if (metadata.unit === "%") return raw;
    if (metadata.valueType === "ratio2") return raw;
    return raw;
  }
  if (metadata?.rawUnit === "%" || metadata?.unit === "%") return raw / 100;
  if (metadata?.valueType === "ratio") return raw;
  return raw;
}

export function stringValue(
  row: NormalizedSnapshotRow | undefined,
  requestId: string,
): string | null {
  const value = row?.values[requestId]?.value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function objectValue<T extends object>(
  row: NormalizedSnapshotRow | undefined,
  requestId: string,
): T | null {
  const value = row?.values[requestId]?.value;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as T)
    : null;
}

export function formatAInvestValue(value: NormalizedValue): string {
  if (value.value == null) return "—";
  if (
    typeof value.value === "number" &&
    (value.valueType === "ratio" || value.valueType === "ratio2")
  ) {
    const displayValue =
      value.valueType === "ratio2"
        ? value.rawUnit === "x100"
          ? value.value
          : value.rawUnit === "x1000"
            ? value.value / 10
            : value.unit === "%"
              ? value.value * 100
              : null
        : value.rawUnit === "%"
          ? value.value
          : null;
    return displayValue === null ? "—" : `${displayValue}%`;
  }
  return String(value.value);
}
