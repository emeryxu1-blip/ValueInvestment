import type {
  AnalysisMetric,
  AnalysisPeer,
  SecurityAnalysisResponse,
} from "../contracts";
import {
  parseDcfModule,
  parseGrowthForecastModule,
  yyyymmddToIso,
} from "./derivations.ts";
import { MINIMUM_PEER_SAMPLE } from "./peer-selection.ts";

export type DcfCashFlowPoint = {
  period: string;
  value: number;
};

export type DcfCashFlowEvidence = {
  reported: DcfCashFlowPoint[];
  forecast: DcfCashFlowPoint[];
  latestReported: number | null;
  trailingFourQuarter: number | null;
  nextForecast: number | null;
  forwardFourQuarter: number | null;
  forwardGrowth: number | null;
};

export type DcfValuePoint = {
  period: string;
  value: number;
};

export type RelativeMeasure = {
  id: "pe" | "ps" | "pb";
  label: string;
  companyMultiple: number | null;
  peerMedian: number | null;
  denominatorPerShare: number | null;
  impliedValue: number | null;
  premiumDiscount: number | null;
  peerSampleSize: number;
};

export type DcfValuation = {
  kind: "dcf";
  method: "ainvest-dcf";
  providerValue: number | null;
  providerValuePeriod: string | null;
  providerValueAsOf: string | null;
  cashFlow: DcfCashFlowEvidence;
  cashFlowAsOf: string | null;
  providerValuePeriods: DcfValuePoint[];
  price: number | null;
  priceAsOf: string | null;
  baseValue: number | null;
  gap: number | null;
  opportunity: string;
  modelVersion: typeof VALUATION_MODEL_VERSION;
};

export type RelativeValuation = {
  kind: "relative";
  measures: RelativeMeasure[];
  relativeValue: number | null;
  price: number | null;
  priceAsOf: string | null;
  peerAsOf: string | null;
  baseValue: number | null;
  gap: number | null;
  opportunity: string;
  aggregation: "median-positive-implied-values";
  modelVersion: typeof VALUATION_MODEL_VERSION;
};

export type SecurityValuation = DcfValuation | RelativeValuation;

export const VALUATION_MODEL_VERSION = "2026-08-12.1";

export function medianPositive(
  values: Array<number | null>,
  minimumCount = 1,
): number | null {
  const sorted = values
    .filter(
      (value): value is number =>
        value !== null && Number.isFinite(value) && value > 0,
    )
    .sort((left, right) => left - right);
  if (sorted.length < minimumCount) return null;
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[midpoint]
    : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

export function analysisMetricNumber(
  metrics: Record<string, AnalysisMetric> | undefined,
  key: string,
): number | null {
  const value = metrics?.[key]?.value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[,$%×]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function positiveNumber(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

function metricObject(
  metrics: Record<string, AnalysisMetric>,
  key: string,
): Record<string, unknown> | null {
  const value = metrics[key]?.value;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function peerMetric(peer: AnalysisPeer, key: string): number | null {
  return analysisMetricNumber(peer.metrics, key);
}

const metricAsOf = (
  metrics: Record<string, AnalysisMetric> | undefined,
  key: string,
): string | null => metrics?.[key]?.asOf ?? null;

const latestAsOf = (values: Array<string | null | undefined>): string | null =>
  values
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

export function calculateRelativeMeasures(
  data: Pick<SecurityAnalysisResponse, "metrics" | "peers">,
): RelativeMeasure[] {
  const price = positiveNumber(analysisMetricNumber(data.metrics, "price"));
  const definitions: Array<{
    id: RelativeMeasure["id"];
    label: string;
  }> = [
    { id: "pe", label: "Price / earnings" },
    { id: "ps", label: "Price / sales" },
    { id: "pb", label: "Price / book" },
  ];

  return definitions.map(({ id, label }) => {
    const peerValues = data.peers.map((peer) => peerMetric(peer, id));
    const peerMedian = medianPositive(
      peerValues,
      MINIMUM_PEER_SAMPLE,
    );
    const companyMultiple = positiveNumber(
      analysisMetricNumber(data.metrics, id),
    );
    const denominatorPerShare =
      price !== null && companyMultiple !== null
        ? price / companyMultiple
        : null;
    return {
      id,
      label,
      companyMultiple,
      peerMedian,
      denominatorPerShare,
      impliedValue:
        peerMedian !== null && denominatorPerShare !== null
          ? peerMedian * denominatorPerShare
          : null,
      premiumDiscount:
        companyMultiple !== null && peerMedian !== null
          ? companyMultiple / peerMedian - 1
          : null,
      peerSampleSize: peerValues.filter(
        (value): value is number =>
          value !== null && Number.isFinite(value) && value > 0,
      ).length,
    };
  });
}

export function opportunityLabel(gap: number | null): string {
  if (gap === null) return "Needs more evidence";
  if (gap >= 0.2) return "Wide implied value gap";
  if (gap >= 0) return "Positive implied value gap";
  if (gap >= -0.1) return "Near indicated value";
  return "Price above indicated value";
}

function valuationEnvelope(
  price: number | null,
  baseValue: number | null,
) {
  const gap =
    price !== null && baseValue !== null && price > 0
      ? baseValue / price - 1
      : null;
  return {
    price,
    baseValue,
    gap,
    opportunity: opportunityLabel(gap),
  };
}

const points = (values: Array<[string, number]>): DcfCashFlowPoint[] =>
  values.map(([period, value]) => ({ period, value }));

const sumFour = (values: DcfCashFlowPoint[]): number | null =>
  values.length >= 4
    ? values
        .slice(0, 4)
        .reduce((total, point) => total + point.value, 0)
    : null;

export function calculateDcfValuation(
  metrics: Record<string, AnalysisMetric>,
): DcfValuation {
  const dcf = parseDcfModule(metricObject(metrics, "fairValueModule"));
  const growth = parseGrowthForecastModule(
    metricObject(metrics, "growthForecastModule"),
  );
  const reported = points(growth.reported);
  const forecast = points(growth.forecast);
  const trailingFourQuarter = sumFour([...reported].reverse());
  const forwardFourQuarter = sumFour(forecast);
  const forwardGrowth =
    trailingFourQuarter !== null &&
    trailingFourQuarter > 0 &&
    forwardFourQuarter !== null
      ? forwardFourQuarter / trailingFourQuarter - 1
      : null;
  const providerValue = positiveNumber(dcf.fairValue);
  const price = positiveNumber(analysisMetricNumber(metrics, "price"));
  const providerValuePeriod =
    providerValue !== null && dcf.predicted[0]
      ? yyyymmddToIso(dcf.predicted[0][0])
      : null;

  return {
    kind: "dcf",
    method: "ainvest-dcf",
    providerValue,
    providerValuePeriod,
    providerValueAsOf: metricAsOf(metrics, "fairValueModule"),
    cashFlow: {
      reported,
      forecast,
      latestReported: reported.at(-1)?.value ?? null,
      trailingFourQuarter,
      nextForecast: forecast[0]?.value ?? null,
      forwardFourQuarter,
      forwardGrowth,
    },
    cashFlowAsOf: metricAsOf(metrics, "growthForecastModule"),
    providerValuePeriods: dcf.predicted
      .map(([period, value]) => ({ period: yyyymmddToIso(period), value }))
      .sort((left, right) => left.period.localeCompare(right.period)),
    ...valuationEnvelope(price, providerValue),
    priceAsOf: metricAsOf(metrics, "price"),
    modelVersion: VALUATION_MODEL_VERSION,
  };
}

export function calculateRelativeValuation(
  data: Pick<SecurityAnalysisResponse, "metrics" | "peers">,
): RelativeValuation {
  const measures = calculateRelativeMeasures(data);
  const relativeValue = medianPositive(
    measures.map((measure) => measure.impliedValue),
  );
  const price = positiveNumber(analysisMetricNumber(data.metrics, "price"));
  return {
    kind: "relative",
    measures,
    relativeValue,
    ...valuationEnvelope(price, relativeValue),
    priceAsOf: metricAsOf(data.metrics, "price"),
    peerAsOf: latestAsOf(
      data.peers.flatMap((peer) =>
        (["pe", "ps", "pb"] as const).map((key) => metricAsOf(peer.metrics, key)),
      ),
    ),
    aggregation: "median-positive-implied-values",
    modelVersion: VALUATION_MODEL_VERSION,
  };
}
