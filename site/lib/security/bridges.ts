import type {
  FinancialBridge,
  FinancialBridgeRow,
} from "../contracts";

const finite = (value: number | null): value is number =>
  value !== null && Number.isFinite(value);

export function buildCashFlowBridge(options: {
  period: string;
  revenue: number | null;
  netIncome: number | null;
  freeCashFlow: number | null;
}): FinancialBridge | null {
  if (
    !finite(options.revenue) ||
    options.revenue <= 0 ||
    !finite(options.netIncome)
  ) {
    return null;
  }

  const operatingBridge = options.netIncome - options.revenue;
  const rows: FinancialBridgeRow[] = [
    {
      label: "Revenue",
      value: options.revenue,
      from: 0,
      to: options.revenue,
      kind: "total",
    },
    {
      label: "Combined costs, interest & tax",
      value: operatingBridge,
      from: options.revenue,
      to: options.netIncome,
      kind: operatingBridge >= 0 ? "positive" : "negative",
    },
    {
      label: "Net income",
      value: options.netIncome,
      from: 0,
      to: options.netIncome,
      kind: options.netIncome >= 0 ? "total" : "negative",
    },
  ];

  if (finite(options.freeCashFlow)) {
    const cashAdjustment = options.freeCashFlow - options.netIncome;
    rows.push(
      {
        label: "Cash conversion & reinvestment",
        value: cashAdjustment,
        from: options.netIncome,
        to: options.freeCashFlow,
        kind: cashAdjustment >= 0 ? "positive" : "negative",
      },
      {
        label: "Free cash flow",
        value: options.freeCashFlow,
        from: 0,
        to: options.freeCashFlow,
        kind: options.freeCashFlow >= 0 ? "cash" : "negative",
      },
    );
  }

  return {
    period: options.period,
    rows,
  };
}
