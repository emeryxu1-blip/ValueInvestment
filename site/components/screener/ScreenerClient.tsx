"use client";

import Link from "next/link";
import { CompanyLogo } from "@/components/CompanyLogo";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Bookmark,
  Check,
  ChevronDown,
  CircleAlert,
  CloudOff,
  Columns3,
  Filter,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  COLUMN_OPTIONS,
  DEFAULT_COLUMNS,
  DEFAULT_FILTERS,
  deriveScreenerView,
  FILTER_LIBRARY,
  filterMatchesSearch,
  isFilterSupportedBySnapshot,
  isRequiredUniverseFilter,
  normalizeScreenerPayload,
  SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION,
  withRequiredUniverseFilters,
  withSnapshotCompatibleFilters,
} from "./screener-data";
import { ScreenerModal } from "./ScreenerModal";
import type {
  ColumnKey,
  Metric,
  SavedScreen,
  ScanState,
  ScreenerFilter,
  ScreenerStock,
  SortOrder,
} from "./types";

const STORAGE_KEY = "value-workbench:saved-screeners:v1";

type SavedScreenerApi = Omit<SavedScreen, "savedAt"> & {
  createdAt: string;
  updatedAt: string;
};

const COLUMN_LABELS: Record<ColumnKey, string> = {
  price: "Last price",
  changePercent: "Price change",
  marketCap: "Market cap",
  fairValue: "DCF value",
  mispricing: "Value gap",
  pe: "P/E",
  revenueGrowth: "Revenue growth",
};

const SORTABLE_COLUMNS = new Set<ColumnKey>([
  "price",
  "changePercent",
  "marketCap",
  "fairValue",
  "mispricing",
  "pe",
  "revenueGrowth",
]);

function formatCurrency(metric: Metric<number>, currency: string | null) {
  if (metric.value === null || !currency) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: metric.value >= 1000 ? 0 : 2,
      maximumFractionDigits: metric.value >= 1000 ? 0 : 2,
    }).format(metric.value);
  } catch {
    return "—";
  }
}

function formatCompactCurrency(metric: Metric<number>, currency: string | null) {
  if (metric.value === null || !currency) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(metric.value);
}

function percentValue(metric: Metric<number>) {
  if (metric.value === null) return null;
  const unit = metric.unit?.toLowerCase() ?? "";
  if (unit.includes("ratio")) return metric.value * 100;
  if (unit.includes("%")) return metric.value;
  return null;
}

function formatPercent(metric: Metric<number>, signed = false) {
  const value = percentValue(metric);
  if (value === null) return "—";
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

function formatMultiple(metric: Metric<number>) {
  if (metric.value === null || !metric.unit?.toLowerCase().includes("x")) return "—";
  return `${metric.value.toLocaleString("en-US", { maximumFractionDigits: 1 })}×`;
}

function safeExchange(stock: ScreenerStock) {
  const raw = stock.exchange.trim().toLowerCase();
  return raw === "nasdaq" || raw === "nyse" ? raw : null;
}

function savedScreenFromApi(screen: SavedScreenerApi): SavedScreen {
  return {
    id: screen.id,
    name: screen.name,
    filters: withRequiredUniverseFilters(screen.filters),
    columns: screen.columns,
    sortKey: screen.sortKey,
    sortOrder: screen.sortOrder,
    savedAt: screen.createdAt,
  };
}

function filterForStorage(filter: ScreenerFilter): ScreenerFilter {
  const persisted = { ...filter };
  delete persisted.description;
  delete persisted.minimumSnapshotSchemaVersion;
  return persisted;
}

async function workspaceJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "Your saved-screen workspace is temporarily unavailable.";
    throw new Error(message);
  }
  return payload as T;
}

function columnMetric(stock: ScreenerStock, column: ColumnKey) {
  return stock[column];
}

function cellValue(stock: ScreenerStock, column: ColumnKey) {
  const metric = columnMetric(stock, column);
  if (column === "price" || column === "fairValue") return formatCurrency(metric, stock.currency);
  if (column === "marketCap") return formatCompactCurrency(metric, stock.currency);
  if (column === "pe") return formatMultiple(metric);
  return formatPercent(metric, column === "changePercent" || column === "mispricing");
}

function InlineFilterLibrary({
  selected,
  snapshotSchemaVersion,
  onToggle,
}: {
  selected: ScreenerFilter[];
  snapshotSchemaVersion: number | null;
  onToggle: (filter: ScreenerFilter) => void;
}) {
  const [query, setQuery] = useState("");
  const categories = ["Universe", "Valuation", "Quality", "Growth"] as const;
  const selectedIds = new Set(selected.map((filter) => filter.id));
  const filtered = FILTER_LIBRARY.filter((filter) =>
    isFilterSupportedBySnapshot(filter, snapshotSchemaVersion),
  ).filter((filter) => filterMatchesSearch(filter, query));

  return (
    <div className="inline-filter-workspace" aria-labelledby="filter-library-title">
      <div className="inline-filter-workspace__header">
        <div>
          <h3 id="filter-library-title">Filter library</h3>
          <p>Select a criterion to add it. The Top 1,000 and NYSE/NASDAQ scopes always stay applied.</p>
        </div>
        <div className="filter-search">
          <Search size={17} aria-hidden="true" />
          <label className="sr-only" htmlFor="inline-filter-search">
            Search filters
          </label>
          <input
            id="inline-filter-search"
            type="search"
            placeholder="Search filters"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear filter search">
              <X size={14} />
            </button>
          ) : null}
        </div>
      </div>
      <p className="filter-library-guidance" role="note">
        Screen matches are research candidates, not recommendations. Banks, insurers, REITs, utilities, and cyclicals require sector-appropriate, normalized measures.
      </p>
      <div className="filter-library">
        {categories.map((category) => {
          const filters = filtered.filter((filter) => filter.category === category);
          if (!filters.length) return null;
          return (
            <section
              className="filter-category"
              key={category}
              aria-labelledby={`inline-filter-${category.toLowerCase()}`}
            >
              <div className="filter-category__title">
                <span className={`category-icon category-icon--${category.toLowerCase()}`} aria-hidden="true">
                  {category.slice(0, 1)}
                </span>
                <div>
                  <h4 id={`inline-filter-${category.toLowerCase()}`}>{category}</h4>
                  <p>
                    {category === "Universe" && "Choose where to look"}
                    {category === "Valuation" && "Set the price discipline"}
                    {category === "Quality" && "Look for financial resilience"}
                    {category === "Growth" && "Define the trajectory"}
                  </p>
                </div>
              </div>
              <div className="filter-option-list">
                {filters.map((filter) => {
                  const active = selectedIds.has(filter.id);
                  const available = filter.available !== false;
                  const locked = isRequiredUniverseFilter(filter.id);
                  return (
                    <button
                      className={`filter-option${available ? "" : " is-unavailable"}${locked ? " is-locked" : ""}`}
                      type="button"
                      key={filter.id}
                      aria-pressed={active}
                      aria-label={`${filter.label}. ${filter.shortLabel}`}
                      aria-disabled={locked || !available}
                      disabled={locked || !available}
                      title={locked ? "This universe rule is always applied." : filter.unavailableReason}
                      onClick={() => onToggle(filter)}
                    >
                      <span className="filter-option__copy">
                        <span className="filter-option__title">{filter.label}</span>
                        <small className="filter-option__terms">{filter.shortLabel}</small>
                        {locked ? <small className="filter-option__status">Always applied</small> : null}
                        {!available ? <small className="filter-option__status">{filter.unavailableReason}</small> : null}
                      </span>
                      {available ? (
                        <span className={`filter-option__check${active ? " is-active" : ""}`} aria-hidden="true">
                          {active ? <Check size={14} strokeWidth={2.5} /> : <Plus size={14} />}
                        </span>
                      ) : (
                        <span className="availability-pill">Unavailable</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        {filtered.length === 0 ? <p className="filter-library-empty">No filters match “{query}”.</p> : null}
      </div>
    </div>
  );
}

function ColumnsModal({
  open,
  value,
  onApply,
  onClose,
}: {
  open: boolean;
  value: ColumnKey[];
  onApply: (columns: ColumnKey[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ColumnKey[]>(value);
  const closeModal = () => {
    setDraft(value);
    onClose();
  };

  const toggle = (column: ColumnKey) => {
    setDraft((current) =>
      current.includes(column)
        ? current.length === 1
          ? current
          : current.filter((item) => item !== column)
        : [...current, column],
    );
  };

  return (
    <ScreenerModal
      open={open}
      title="Choose columns"
      description="Company identity always stays pinned on the left."
      onClose={closeModal}
      footer={
        <>
          <button className="secondary-button" type="button" onClick={() => setDraft(DEFAULT_COLUMNS)}>
            Reset
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            Apply columns
          </button>
        </>
      }
    >
      <div className="column-options">
        {COLUMN_OPTIONS.map((column) => {
          const checked = draft.includes(column.key);
          return (
            <label className="column-option" key={column.key}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(column.key)}
                aria-describedby={`column-${column.key}-description`}
              />
              <span className="column-option__check" aria-hidden="true">
                {checked ? <Check size={13} strokeWidth={3} /> : null}
              </span>
              <span>
                <strong>{column.label}</strong>
                <small id={`column-${column.key}-description`}>{column.description}</small>
              </span>
            </label>
          );
        })}
      </div>
    </ScreenerModal>
  );
}

function ScanBanner({ scan }: { scan: ScanState }) {
  const percent = scan.total != null && scan.total > 0 && scan.scanned != null
    ? Math.min(100, Math.round((scan.scanned / scan.total) * 100))
    : null;
  return (
    <div className={`scan-banner scan-banner--${scan.state}`} role="status" aria-live="polite">
      <div className="scan-banner__icon" aria-hidden="true">
        {scan.state === "error" ? <CircleAlert size={20} /> : <LoaderCircle className="spin" size={20} />}
      </div>
      <div className="scan-banner__body">
        <div className="scan-banner__line">
          <strong>{scan.state === "error" ? "Valuation scan paused" : "Evaluating the market"}</strong>
          {percent !== null ? <span>{percent}%</span> : <span>Progress unavailable</span>}
        </div>
        <p>
          {scan.state === "error"
            ? "Some companies may be missing. Try again to resume the scan."
            : "We’re comparing stored market prices with current DCF references. Matches appear as each company is evaluated."}
        </p>
        {scan.state !== "error" ? (
          <div
            className={`scan-progress${percent === null ? " scan-progress--indeterminate" : ""}`}
            aria-label={percent === null ? "Scan progress unavailable" : `${percent}% of securities scanned`}
          >
            <span style={percent === null ? undefined : { width: `${percent}%` }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MetricValue({ stock, column }: { stock: ScreenerStock; column: ColumnKey }) {
  const metric = columnMetric(stock, column);
  const numeric = percentValue(metric);
  const directional = column === "changePercent" || column === "mispricing";
  const tone = directional && numeric !== null ? (numeric > 0 ? "positive" : numeric < 0 ? "negative" : "neutral") : "neutral";
  return (
    <div className={`metric-value metric-value--${tone}`}>
      {column === "changePercent" && numeric !== null ? (
        numeric > 0 ? (
          <ArrowUp size={13} aria-hidden="true" />
        ) : numeric < 0 ? (
          <ArrowDown size={13} aria-hidden="true" />
        ) : null
      ) : null}
      <span>{cellValue(stock, column)}</span>
      {column === "mispricing" && numeric !== null ? (
        <small>{numeric > 1 ? "positive gap" : numeric < -1 ? "negative gap" : "within ±1%"}</small>
      ) : null}
    </div>
  );
}

function CompanyIdentity({ stock }: { stock: ScreenerStock }) {
  return (
    <div className="company-identity">
      <CompanyLogo className="company-mark" symbol={stock.symbol} />
      <span className="company-copy">
        <strong>{stock.company ?? "Company name unavailable"}</strong>
        <small>
          {stock.symbol} · {stock.exchange.toUpperCase()}
        </small>
      </span>
    </div>
  );
}

function ResultsTable({
  rows,
  columns,
  sortKey,
  sortOrder,
  onSort,
}: {
  rows: ScreenerStock[];
  columns: ColumnKey[];
  sortKey: string;
  sortOrder: SortOrder;
  onSort: (key: string) => void;
}) {
  const sortIcon = (key: string) => {
    if (sortKey !== key) return <ArrowUpDown size={13} aria-hidden="true" />;
    return sortOrder === "asc" ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />;
  };

  return (
    <div className="desktop-results">
      <table>
        <thead>
          <tr>
            <th scope="col">
              <button type="button" onClick={() => onSort("company")}>
                Company {sortIcon("company")}
              </button>
            </th>
            {columns.map((column) => (
              <th scope="col" key={column}>
                {SORTABLE_COLUMNS.has(column) ? (
                  <button type="button" onClick={() => onSort(column)}>
                    {COLUMN_LABELS[column]} {sortIcon(column)}
                  </button>
                ) : (
                  COLUMN_LABELS[column]
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((stock) => (
            <tr key={`${stock.marketCode}-${stock.symbol}`}>
              <td>
                {safeExchange(stock) ? (
                  <Link href={`/value-opportunities/${safeExchange(stock)}/${stock.symbol.toLowerCase()}/overview`}>
                    <CompanyIdentity stock={stock} />
                  </Link>
                ) : (
                  <CompanyIdentity stock={stock} />
                )}
              </td>
              {columns.map((column) => (
                <td key={column}>
                  <MetricValue stock={stock} column={column} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobileResults({ rows, columns }: { rows: ScreenerStock[]; columns: ColumnKey[] }) {
  const cardColumns = columns.slice(0, 4);
  return (
    <div className="mobile-results">
      {rows.map((stock) => (
        <div
          className="stock-card"
          key={`${stock.marketCode}-${stock.symbol}`}
        >
          <div className="stock-card__top">
            {safeExchange(stock) ? (
              <Link href={`/value-opportunities/${safeExchange(stock)}/${stock.symbol.toLowerCase()}/overview`}>
                <CompanyIdentity stock={stock} />
              </Link>
            ) : (
              <CompanyIdentity stock={stock} />
            )}
            {safeExchange(stock) ? <ArrowRight size={17} aria-hidden="true" /> : null}
          </div>
          <dl className="stock-card__metrics">
            {cardColumns.map((column) => (
              <div key={column}>
                <dt>{COLUMN_LABELS[column]}</dt>
                <dd>
                  <MetricValue stock={stock} column={column} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function LoadingRows({ columns }: { columns: ColumnKey[] }) {
  return (
    <div className="loading-results" aria-label="Loading companies" role="status">
      {[0, 1, 2, 3, 4].map((row) => (
        <div className="loading-row" key={row}>
          <span className="loading-company" />
          {columns.slice(0, 4).map((column) => (
            <span key={column} />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading companies</span>
    </div>
  );
}

export function ScreenerClient() {
  const [filters, setFilters] = useState<ScreenerFilter[]>(DEFAULT_FILTERS);
  const [columns, setColumns] = useState<ColumnKey[]>(DEFAULT_COLUMNS);
  const [sortKey, setSortKey] = useState("marketCap");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [allRows, setAllRows] = useState<ScreenerStock[]>([]);
  const [snapshotSchemaVersion, setSnapshotSchemaVersion] = useState<number | null>(null);
  const [totalKnown, setTotalKnown] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [responseStatus, setResponseStatus] = useState("loading");
  const [scan, setScan] = useState<ScanState | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [columnsModalOpen, setColumnsModalOpen] = useState(false);
  const [savedScreens, setSavedScreens] = useState<SavedScreen[]>([]);
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("Value opportunities");
  const allRowsRef = useRef<ScreenerStock[]>([]);
  const hasSnapshotRef = useRef(false);
  const requestIdRef = useRef(0);

  const view = useMemo(
    () =>
      deriveScreenerView({
        rows: allRows,
        filters,
        sortKey,
        sortOrder,
        page,
        pageSize,
      }),
    [allRows, filters, page, pageSize, sortKey, sortOrder],
  );
  const rows = view.rows;
  const total = view.total;
  const totalPages = view.totalPages;
  const currentPage = view.page;

  useEffect(() => {
    let cancelled = false;

    async function loadSavedScreens() {
      try {
        const payload = await fetch("/api/workspace/screeners", {
          cache: "no-store",
          headers: { Accept: "application/json" },
        }).then((response) =>
          workspaceJson<{ screeners: SavedScreenerApi[] }>(response),
        );
        let next = payload.screeners.map(savedScreenFromApi);

        if (next.length === 0) {
          const stored = window.localStorage.getItem(STORAGE_KEY);
          const parsed = stored ? (JSON.parse(stored) as unknown) : null;
          if (Array.isArray(parsed) && parsed.length > 0) {
            const imported: SavedScreen[] = [];
            for (const candidate of parsed) {
              if (
                !candidate ||
                typeof candidate !== "object" ||
                typeof (candidate as SavedScreen).name !== "string"
              ) {
                continue;
              }
              const local = candidate as SavedScreen;
              const created = await fetch("/api/workspace/screeners", {
                method: "POST",
                headers: {
                  Accept: "application/json",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  name: local.name,
                  filters: withRequiredUniverseFilters(local.filters).map(
                    filterForStorage,
                  ),
                  columns: local.columns,
                  sortKey: local.sortKey,
                  sortOrder: local.sortOrder,
                }),
              }).then((response) =>
                workspaceJson<{ screener: SavedScreenerApi }>(response),
              );
              imported.push(savedScreenFromApi(created.screener));
            }
            if (imported.length > 0) {
              next = imported;
              window.localStorage.removeItem(STORAGE_KEY);
            }
          }
        }

        if (!cancelled) {
          setSavedScreens(next);
          setActiveSavedId(next[0]?.id ?? null);
          setWorkspaceError(null);
        }
      } catch (reason) {
        if (!cancelled) {
          setWorkspaceError(
            reason instanceof Error
              ? reason.message
              : "Your saved-screen workspace is temporarily unavailable.",
          );
        }
      } finally {
        if (!cancelled) setStorageReady(true);
      }
    }

    void loadSavedScreens();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;

    async function load() {
      if (hasSnapshotRef.current) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);
      setRefreshError(null);
      if (!hasSnapshotRef.current) setResponseStatus("loading");
      try {
        const response = await fetch(
          `/api/screener/snapshot?schema=${SCREENER_CLIENT_SNAPSHOT_SCHEMA_VERSION}`,
          {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          },
        );
        const payload = (await response.json().catch(() => ({}))) as unknown;
        if (!response.ok && response.status !== 202) {
          const normalizedError = normalizeScreenerPayload(payload, response.status);
          throw new Error(normalizedError.message || `The data service returned ${response.status}.`);
        }

        const normalized = normalizeScreenerPayload(payload, response.status);
        if (
          response.status !== 202 &&
          normalized.totalKnown &&
          normalized.rows.length !== normalized.total
        ) {
          throw new Error("The complete company universe was not returned.");
        }
        if (controller.signal.aborted || requestId !== requestIdRef.current) {
          return;
        }
        if (normalized.schemaVersion !== null) {
          setSnapshotSchemaVersion(normalized.schemaVersion);
          setFilters((current) =>
            withSnapshotCompatibleFilters(current, normalized.schemaVersion),
          );
        }
        if (normalized.rows.length || response.status !== 202) {
          allRowsRef.current = normalized.rows;
          hasSnapshotRef.current = true;
          setAllRows(normalized.rows);
          setTotalKnown(normalized.totalKnown);
        } else if (!hasSnapshotRef.current) {
          setTotalKnown(false);
        }
        setResponseStatus(normalized.status);
        setScan(
          normalized.scan ??
            (response.status === 202
              ? { state: "warming", scanned: 0, total: 0, message: normalized.message }
              : null),
        );
      } catch {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
        if (hasSnapshotRef.current) {
          // Never keep displaying financial numbers after their refresh failed:
          // the next render must make the unavailable state explicit.
          allRowsRef.current = [];
          hasSnapshotRef.current = false;
          setAllRows([]);
          setTotalKnown(false);
          setResponseStatus("error");
          setScan(null);
          setRefreshError("We couldn’t refresh the results. Current figures are unavailable.");
        } else {
          setTotalKnown(false);
          setResponseStatus("error");
          setScan(null);
          setError("We couldn’t load the results. Try again in a moment.");
        }
      } finally {
        if (!controller.signal.aborted && requestId === requestIdRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    if (scan?.state !== "warming" || error) return;
    const timer = window.setTimeout(() => setRefreshKey((value) => value + 1), 2500);
    return () => window.clearTimeout(timer);
  }, [scan?.state, scan?.scanned, error, refreshKey]);

  const activeSaved = savedScreens.find((screen) => screen.id === activeSavedId) ?? null;

  const toggleFilter = useCallback((filter: ScreenerFilter) => {
    if (isRequiredUniverseFilter(filter.id)) return;
    setFilters((current) =>
      current.some((item) => item.id === filter.id)
        ? current.filter((item) => item.id !== filter.id)
        : [
            ...current.filter((item) => {
              if (filter.field === "marketCap" && filter.operator === "gte") {
                return !(item.field === "marketCap" && item.operator === "gte");
              }
              return true;
            }),
            filter,
          ],
    );
    setPage(1);
  }, []);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortOrder((order) => (order === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortOrder(key === "company" ? "asc" : "desc");
    }
    setPage(1);
  };

  const saveScreen = async (event: FormEvent) => {
    event.preventDefault();
    const name = saveName.trim();
    if (!name) return;
    try {
      const payload = await fetch("/api/workspace/screeners", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          filters: filters.map(filterForStorage),
          columns,
          sortKey,
          sortOrder,
        }),
      }).then((response) =>
        workspaceJson<{ screener: SavedScreenerApi }>(response),
      );
      const screen = savedScreenFromApi(payload.screener);
      setSavedScreens((current) => [screen, ...current]);
      setActiveSavedId(screen.id);
      setSaveOpen(false);
      setSaveName("Value opportunities");
      setWorkspaceError(null);
    } catch (reason) {
      setWorkspaceError(
        reason instanceof Error
          ? reason.message
          : "Your saved-screen workspace is temporarily unavailable.",
      );
    }
  };

  const loadScreen = (id: string) => {
    const screen = savedScreens.find((item) => item.id === id);
    if (!screen) return;
    setActiveSavedId(id);
    setFilters(
      withSnapshotCompatibleFilters(screen.filters, snapshotSchemaVersion),
    );
    setColumns(screen.columns);
    setSortKey(screen.sortKey);
    setSortOrder(screen.sortOrder);
    setPage(1);
  };

  const deleteScreen = async (id: string) => {
    try {
      await fetch(`/api/workspace/screeners/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      }).then((response) => workspaceJson<{ deleted: true }>(response));
      setSavedScreens((current) =>
        current.filter((screen) => screen.id !== id),
      );
      if (activeSavedId === id) {
        const next = savedScreens.find((screen) => screen.id !== id);
        setActiveSavedId(next?.id ?? null);
      }
      setWorkspaceError(null);
    } catch (reason) {
      setWorkspaceError(
        reason instanceof Error
          ? reason.message
          : "Your saved-screen workspace is temporarily unavailable.",
      );
    }
  };

  const firstResult = totalKnown && total > 0 ? (currentPage - 1) * pageSize + 1 : null;
  const lastResult = totalKnown && total > 0 ? Math.min(total, currentPage * pageSize) : null;
  return (
    <main className="screener-page">
      <div className="screener-shell">
        <header className="screener-hero">
          <div className="screener-hero__art">
            {/* This local asset is served directly so the Cloudflare build does not depend on an image optimizer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/value-opportunities-buffett-hero.webp"
              alt="Comic portrait of Warren Buffett holding a Coca-Cola bottle"
              width={1942}
              height={810}
              loading="eager"
              fetchPriority="high"
              decoding="async"
              draggable={false}
            />
          </div>
          <div className="hero-heading-row">
            <div>
              <h1>Find value opportunities worth investigating.</h1>
              <p>
                Start with a margin of safety, then narrow by DCF evidence, financial resilience, and sensible market expectations.
              </p>
            </div>
          </div>
        </header>

        <section className="criteria-panel" aria-labelledby="criteria-title">
          <div className="section-heading">
            <div>
              <h2 id="criteria-title">Define the opportunity</h2>
              <p className="criteria-intro">Choose the evidence a company must show before it earns deeper research.</p>
            </div>
            <span className="criteria-count" aria-live="polite">
              {filters.length} active
            </span>
          </div>
          <div className="filter-chips">
            {filters.map((filter) => (
              <span
                className="active-filter"
                key={filter.id}
                aria-label={`${filter.label}. ${filter.shortLabel}${isRequiredUniverseFilter(filter.id) ? ". Always applied" : ""}`}
              >
                <span className="active-filter__category">{filter.category}</span>
                <strong>{filter.label}</strong>
                {isRequiredUniverseFilter(filter.id) ? (
                  <span className="active-filter__locked">
                    <Check size={12} aria-hidden="true" /> Always on
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleFilter(filter)}
                    aria-label={`Remove ${filter.label}: ${filter.shortLabel}`}
                  >
                    <X size={14} />
                  </button>
                )}
              </span>
            ))}
            {filters.length === 0 ? (
              <div className="empty-filter-state">
                <Filter size={16} />
                No filters selected — browse the full universe or choose one below.
              </div>
            ) : null}
          </div>
          <details className="filter-library-disclosure">
            <summary>
              <span className="filter-library-disclosure__copy">
                <span className="filter-library-disclosure__icon" aria-hidden="true">
                  <SlidersHorizontal size={16} />
                </span>
                <span>
                  <strong>Browse filters</strong>
                  <small>Valuation, quality, growth, and universe</small>
                </span>
              </span>
              <ChevronDown
                className="filter-library-disclosure__chevron"
                size={17}
                aria-hidden="true"
              />
            </summary>
            <InlineFilterLibrary
              selected={filters}
              snapshotSchemaVersion={snapshotSchemaVersion}
              onToggle={toggleFilter}
            />
          </details>
        </section>

        <section className="results-panel" aria-labelledby="results-title">
          <div className="results-topbar">
            <div className="results-heading">
              <h2 id="results-title">Results</h2>
              <span>{totalKnown ? total.toLocaleString("en-US") : "…"}</span>
            </div>
            <div className="results-actions">
              {savedScreens.length ? (
                <div className="saved-picker">
                  <label className="sr-only" htmlFor="saved-screen-picker">
                    Load a saved opportunity screen
                  </label>
                  <Bookmark size={15} aria-hidden="true" />
                  <select id="saved-screen-picker" value={activeSavedId ?? ""} onChange={(event) => loadScreen(event.target.value)}>
                    <option value="" disabled>
                      Saved opportunity screens
                    </option>
                    {savedScreens.map((screen) => (
                      <option value={screen.id} key={screen.id}>
                        {screen.name}
                      </option>
                    ))}
                  </select>
                  {activeSavedId ? (
                    <button
                      type="button"
                      onClick={() => void deleteScreen(activeSavedId)}
                      aria-label={`Delete ${activeSaved?.name ?? "saved screen"}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              ) : null}
              <button className="toolbar-button" type="button" onClick={() => setSaveOpen((value) => !value)}>
                <Bookmark size={16} />
                <span>Save</span>
              </button>
              <button className="toolbar-button" type="button" onClick={() => setColumnsModalOpen(true)}>
                <Columns3 size={16} />
                <span>Columns</span>
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={() => setRefreshKey((value) => value + 1)}
                aria-label="Refresh results"
                disabled={isLoading || isRefreshing}
              >
                <RefreshCw className={isRefreshing ? "spin" : ""} size={17} />
              </button>
            </div>
          </div>

          {saveOpen ? (
            <form className="save-screen-form" onSubmit={saveScreen}>
              <div>
                <Bookmark size={17} aria-hidden="true" />
                <div>
                  <strong>Save this screen</strong>
                  <span>Keep these filters, columns, and sorting for later.</span>
                </div>
              </div>
              <label>
                <span className="sr-only">Saved screen name</span>
                <input
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  placeholder="Screen name"
                  autoFocus
                />
              </label>
              <button
                className="primary-button"
                type="submit"
                disabled={!saveName.trim() || !storageReady}
              >
                Save screen
              </button>
              <button className="icon-button" type="button" onClick={() => setSaveOpen(false)} aria-label="Cancel saving">
                <X size={16} />
              </button>
            </form>
          ) : null}

          {error || refreshError ? (
            <div className="data-notice data-notice--error" role="alert">
              <CloudOff size={19} aria-hidden="true" />
              <div>
                <strong>{error ? "Results couldn’t be loaded" : "Results couldn’t be refreshed"}</strong>
                <p>{error ?? refreshError}</p>
              </div>
              <button type="button" onClick={() => setRefreshKey((value) => value + 1)}>
                Try again
              </button>
            </div>
          ) : responseStatus === "partial" ? (
            <div className="data-notice" role="status">
              <CircleAlert size={19} aria-hidden="true" />
              <div>
                <strong>Results are limited</strong>
                <p>Some companies or values couldn’t be included. Counts reflect only what is shown.</p>
              </div>
            </div>
          ) : null}
          {workspaceError ? (
            <div className="data-notice data-notice--error" role="status">
              <CloudOff size={19} aria-hidden="true" />
              <div>
                <strong>Saved screens are unavailable</strong>
                <p>{workspaceError}</p>
              </div>
            </div>
          ) : null}

          {scan && (scan.state === "warming" || scan.state === "error") ? <ScanBanner scan={scan} /> : null}

          {!error && !refreshError ? (
            <>
              <div className="result-context">
                <div>
                  <strong>
                    {totalKnown ? total.toLocaleString("en-US") : "—"} {totalKnown ? "companies" : "total unavailable"}
                  </strong>
                  <span>
                    {firstResult !== null && lastResult !== null
                      ? `Showing ${firstResult.toLocaleString("en-US")}–${lastResult.toLocaleString("en-US")}`
                      : scan?.state === "warming"
                        ? "Scanning the universe"
                        : "No matches"}
                  </span>
                </div>
                <div className="sort-summary">
                  <SlidersHorizontal size={14} aria-hidden="true" />
                  {COLUMN_LABELS[sortKey as ColumnKey] ?? "Company"} · {sortOrder === "desc" ? "high to low" : "low to high"}
                </div>
              </div>
            </>
          ) : null}

          {error || refreshError ? null : (isLoading || scan?.state === "warming") && allRows.length === 0 ? (
            <LoadingRows columns={columns} />
          ) : rows.length ? (
            <>
              <ResultsTable
                rows={rows}
                columns={columns}
                sortKey={sortKey}
                sortOrder={sortOrder}
                onSort={handleSort}
              />
              <MobileResults rows={rows} columns={columns} />
            </>
          ) : (
            <div className="empty-results">
              <div aria-hidden="true">
                <Search size={23} />
              </div>
              <h3>No companies match this screen</h3>
              <p>Remove one or two filters to widen the opportunity set.</p>
              <button className="secondary-button" type="button" onClick={() => setFilters(DEFAULT_FILTERS)}>
                Reset to DCF value
              </button>
            </div>
          )}

          {total > 0 && totalKnown ? (
            <div className="pagination" aria-label="Results pagination">
              <label>
                Rows
                <select
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                >
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <span>
                Page {currentPage.toLocaleString("en-US")} of {totalPages.toLocaleString("en-US")}
              </span>
              <div>
                <button type="button" disabled={currentPage <= 1} onClick={() => setPage(Math.max(1, currentPage - 1))} aria-label="Previous page">
                  <ArrowLeft size={16} />
                </button>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                  aria-label="Next page"
                >
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="screener-faq" aria-labelledby="faq-title">
          <div className="faq-heading">
            <h2 id="faq-title">From low price to real opportunity</h2>
            <p>Price starts the search. Owner earnings, resilience, and downside protection decide what deserves research.</p>
          </div>
          <div className="faq-list">
            <details open>
              <summary>
                <span>What makes a company a value opportunity?</span>
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <p>
                A value opportunity appears when the market price sits below a conservative estimate of what the
                business can earn for owners, with enough financial strength to survive a weaker outcome. A low multiple
                alone is not enough: the cash flows must be understandable, the balance sheet must be resilient, and the
                discount must compensate for uncertainty.
              </p>
            </details>
            <details>
              <summary>
                <span>Why begin with a margin of safety?</span>
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <p>
                DCF value is a reference, not a precise prediction. Forecasts can be wrong, cycles can turn, and capital
                allocation can disappoint. Requiring price to sit below a conservative value estimate creates room for
                those errors and helps separate an interesting business from an investable price.
              </p>
            </details>
            <details>
              <summary>
                <span>What should I test after a company appears?</span>
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <p>
                Open the opportunity overview and test normalized free cash flow, debt, dilution, reinvestment returns,
                competitive durability, and the assumptions behind the valuation. Look for a clear reason the market may
                be too pessimistic, then write down what evidence would prove the thesis wrong.
              </p>
            </details>
            <details>
              <summary>
                <span>How do saved screens help find new opportunities?</span>
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <p>
                Save a repeatable set of value criteria instead of rebuilding the search around each market move. The
                saved definition keeps the same filters, columns, and sorting ready for the next review.
              </p>
            </details>
          </div>
        </section>

        <p className="screener-disclaimer">
          Prices and estimates can be delayed or incomplete. A screen identifies research candidates, not buy
          recommendations. DCF value is an uncertain reference and should be tested against company filings.
        </p>
      </div>

      <ColumnsModal
        open={columnsModalOpen}
        value={columns}
        onApply={(nextColumns) => {
          setColumns(nextColumns);
          setPage(1);
        }}
        onClose={() => setColumnsModalOpen(false)}
      />
    </main>
  );
}
