export type DataSource = "live" | "derived";

export type Metric<T> = {
  value: T | null;
  source: DataSource;
  asOf: string | null;
  unit?: string;
  reason?: string;
};

export type ScreenerStock = {
  marketCode: string;
  exchange: string;
  symbol: string;
  company: string;
  currency: string;
  price: Metric<number>;
  changePercent: Metric<number>;
  marketCap: Metric<number>;
  fairValue: Metric<number>;
  mispricing: Metric<number>;
  pe: Metric<number>;
  revenueGrowth: Metric<number>;
};

export type FilterCategory = "Universe" | "Valuation" | "Momentum" | "Quality" | "Growth";

export type ScreenerFilter = {
  id: string;
  category: FilterCategory;
  label: string;
  shortLabel: string;
  field: string;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in";
  value: string | number | boolean | string[];
  available?: boolean;
  unavailableReason?: string;
};

export type ColumnKey =
  | "price"
  | "changePercent"
  | "marketCap"
  | "fairValue"
  | "mispricing"
  | "pe"
  | "revenueGrowth";

export type SortOrder = "asc" | "desc";

export type ScanState = {
  state: "idle" | "warming" | "ready" | "error";
  scanned: number;
  total: number;
  message?: string;
};

export type SavedScreen = {
  id: string;
  name: string;
  filters: ScreenerFilter[];
  columns: ColumnKey[];
  sortKey: string;
  sortOrder: SortOrder;
  symbols: string[];
  savedAt: string;
};
