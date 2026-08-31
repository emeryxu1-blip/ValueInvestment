import { finiteNumber } from "./derivations.ts";

export const EARNINGS_POWER_METHOD = {
  id: "no-growth-earnings-power-floor",
  version: "2026-08-28.2",
  requiredReturn: 0.1,
  earningsHaircut: 0.8,
  terminalGrowth: 0,
  description:
    "A conservative screening floor: the lower of positive TTM free cash flow and net income is reduced by 20%, capitalized with zero growth at a 10% required return, adjusted for cash and marketable securities less debt, and divided by shares outstanding. It is not a conventional forward DCF.",
} as const;

type EarningsPowerInputs = {
  freeCashFlow?: unknown;
  netIncome?: unknown;
  cash?: unknown;
  debt?: unknown;
  sharesOutstanding?: unknown;
};

export type EarningsPowerCalculation = {
  value: number | null;
  reason?: string;
  earningsBase: number | null;
  adjustedEarnings: number | null;
  equityValue: number | null;
};

export function calculateEarningsPowerFloor(
  inputs: EarningsPowerInputs,
): EarningsPowerCalculation {
  const freeCashFlow = finiteNumber(inputs.freeCashFlow);
  const netIncome = finiteNumber(inputs.netIncome);
  const cash = finiteNumber(inputs.cash);
  const debt = finiteNumber(inputs.debt);
  const sharesOutstanding = finiteNumber(inputs.sharesOutstanding);

  if (freeCashFlow == null || freeCashFlow <= 0) {
    return {
      value: null,
      reason: "Positive TTM free cash flow is unavailable for the earnings-power floor.",
      earningsBase: null,
      adjustedEarnings: null,
      equityValue: null,
    };
  }
  if (netIncome == null || netIncome <= 0) {
    return {
      value: null,
      reason: "Positive TTM net income is unavailable for the earnings-power floor.",
      earningsBase: null,
      adjustedEarnings: null,
      equityValue: null,
    };
  }
  if (cash == null || debt == null) {
    return {
      value: null,
      reason: "Cash and debt are required to bridge enterprise value to equity value.",
      earningsBase: null,
      adjustedEarnings: null,
      equityValue: null,
    };
  }
  if (sharesOutstanding == null || sharesOutstanding <= 0) {
    return {
      value: null,
      reason: "Positive shares outstanding are required for the per-share earnings-power floor.",
      earningsBase: null,
      adjustedEarnings: null,
      equityValue: null,
    };
  }

  const earningsBase = Math.min(freeCashFlow, netIncome);
  const adjustedEarnings = earningsBase * EARNINGS_POWER_METHOD.earningsHaircut;
  const capitalizedEarnings =
    adjustedEarnings /
    (EARNINGS_POWER_METHOD.requiredReturn - EARNINGS_POWER_METHOD.terminalGrowth);
  const equityValue = capitalizedEarnings + cash - debt;
  const value = equityValue / sharesOutstanding;

  if (!Number.isFinite(value) || value <= 0) {
    return {
      value: null,
      reason: "The earnings-power calculation did not produce a positive finite value.",
      earningsBase,
      adjustedEarnings,
      equityValue,
    };
  }

  return {
    value,
    earningsBase,
    adjustedEarnings,
    equityValue,
  };
}
