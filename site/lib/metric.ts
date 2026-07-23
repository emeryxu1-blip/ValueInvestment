import type { Metric, MetricSource } from "./contracts";

export function metric<T>(
  value: T | null | undefined,
  source: MetricSource,
  options: { asOf?: string | null; unit?: string; reason?: string } = {},
): Metric<T> {
  return {
    value: value ?? null,
    source,
    asOf: options.asOf ?? null,
    ...(options.unit ? { unit: options.unit } : {}),
    ...(options.reason ? { reason: options.reason } : {}),
  };
}

export function unavailableMetric<T>(
  reason: string,
  unit?: string,
): Metric<T> {
  return metric<T>(null, "derived", { reason, unit });
}

export function firstAvailableMetric<T>(
  ...candidates: Array<Metric<T> | undefined>
): Metric<T> {
  return (
    candidates.find((candidate) => candidate?.value != null) ??
    unavailableMetric<T>("No supported value was returned.")
  );
}
