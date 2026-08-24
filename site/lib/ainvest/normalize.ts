export type AInvestIndicatorMeta = {
  id?: string;
  req_unique_id?: string;
  attr?: { value_type?: string; unit?: string; [key: string]: unknown };
};

export type AInvestCell = {
  t?: number;
  v?: unknown;
  value?: Array<{ t?: number; v?: unknown }>;
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

type SnapshotEnvelope = {
  data?: {
    indicator?: AInvestIndicatorMeta[];
    data?: Array<{ symbol_code?: string; value?: AInvestCell[] }>;
    page?: { total?: number };
    symbol_list?: string[];
  };
};

function timestampToIso(timestamp: unknown): string | null {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export function normalizeSnapshot(payload: unknown): {
  rows: NormalizedSnapshotRow[];
  total: number;
  symbolList: string[];
  indicators: AInvestIndicatorMeta[];
} {
  const envelope = (payload ?? {}) as SnapshotEnvelope;
  const indicators = Array.isArray(envelope.data?.indicator)
    ? envelope.data.indicator
    : [];
  const data = Array.isArray(envelope.data?.data) ? envelope.data.data : [];
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
          typeof indicator.attr?.unit === "string" ? indicator.attr.unit : null,
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

export function normalizeSeries(payload: unknown): Array<{
  symbolCode: string;
  values: Record<string, { id: string; points: Array<{ time: string; value: number | null }> }>;
}> {
  const envelope = (payload ?? {}) as {
    data?: {
      indicator?: AInvestIndicatorMeta[];
      data?: Array<{ symbol_code?: string; value?: AInvestCell[] }>;
    };
  };
  const indicators = Array.isArray(envelope.data?.indicator)
    ? envelope.data.indicator
    : [];
  const rows = Array.isArray(envelope.data?.data) ? envelope.data.data : [];
  return rows.map((row) => {
    const cells = Array.isArray(row.value) ? row.value : [];
    const values: Record<
      string,
      { id: string; points: Array<{ time: string; value: number | null }> }
    > = {};
    indicators.forEach((indicator, index) => {
      const requestId = indicator.req_unique_id || indicator.id || `indicator_${index}`;
      const rawPoints = Array.isArray(cells[index]?.value) ? cells[index].value : [];
      values[requestId] = {
        id: indicator.id ?? requestId,
        points: rawPoints
          .map((point) => ({
            time: timestampToIso(point.t) ?? "",
            value:
              typeof point.v === "number" && Number.isFinite(point.v)
                ? point.v
                : null,
          }))
          .filter((point) => point.time),
      };
    });
    return {
      symbolCode: typeof row.symbol_code === "string" ? row.symbol_code : "",
      values,
    };
  });
}

export function normalizeKline(payload: unknown): Array<{
  marketCode: string;
  points: Array<{
    time: string;
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
      const value = row[index(field)];
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    };
    return {
      marketCode: `${String(quote.market ?? "")}:${String(quote.code ?? "")}`,
      points: rows
        .filter((row): row is unknown[] => Array.isArray(row))
        .map((row) => {
          const timestamp = numberAt(row, "1");
          const date = timestamp == null ? null : new Date(timestamp);
          return {
            time:
              date && !Number.isNaN(date.valueOf())
                ? date.toISOString().slice(0, 10)
                : "",
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
  const value = row?.values[requestId]?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
  return raw * 100;
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
    return raw;
  }
  if (metadata?.valueType === "ratio") return raw;
  if (metadata?.unit === "%") return raw / 100;
  return Math.abs(raw) > 2 ? raw / 100 : raw;
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
            : value.value * 100
        : value.value;
    return `${displayValue}%`;
  }
  return String(value.value);
}
