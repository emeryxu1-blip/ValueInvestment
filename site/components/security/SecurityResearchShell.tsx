"use client";

import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Clock3,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { CompanyLogo } from "@/components/CompanyLogo";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { normalizeSummary } from "./data";
import {
  researchViewFromPathname,
  SecurityResearchNav,
} from "./SecurityResearchNav";
import type { SecuritySummary } from "./types";

type ResearchShellContextValue = {
  summary: SecuritySummary | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  notFound: boolean;
  refreshSummary: (background?: boolean) => Promise<void>;
};

const ResearchShellContext =
  createContext<ResearchShellContextValue | null>(null);

export function useSecurityResearchShell(): ResearchShellContextValue {
  const context = useContext(ResearchShellContext);
  if (!context) {
    throw new Error(
      "Security research panels must render inside SecurityResearchShell.",
    );
  }
  return context;
}

const money = (value: number | null, currency: string, compact = false) => {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value);
};

const percent = (value: number | null) =>
  value === null || !Number.isFinite(value)
    ? "—"
    : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

const freshness = (asOf: string | null) => {
  if (!asOf) return "Page calculation time unavailable";
  const timestamp = Date.parse(asOf);
  if (!Number.isFinite(timestamp)) return "Page calculation time unavailable";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Page calculated just now";
  if (minutes < 60) return `Page calculated ${minutes}m ago`;
  if (minutes < 24 * 60) return `Page calculated ${Math.floor(minutes / 60)}h ago`;
  return `Page calculated ${new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
};

export default function SecurityResearchShell({
  exchange,
  symbol,
  companyName,
  children,
}: {
  exchange: string;
  symbol: string;
  companyName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const activeView = researchViewFromPathname(pathname);
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const summaryPath = `/api/security/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}/summary`;

  const refreshSummary = useCallback(
    async (background = false) => {
      if (background) setRefreshing(true);
      else setLoading(true);
      try {
        const response = await fetch(summaryPath, { cache: "no-store" });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          if (response.status === 404) {
            setNotFound(true);
            setError(null);
            return;
          }
          const message =
            payload &&
            typeof payload === "object" &&
            "error" in payload &&
            typeof payload.error === "string"
              ? payload.error
              : "Data is temporarily unavailable";
          throw new Error(message);
        }
        setSummary(normalizeSummary(payload, exchange, symbol));
        setNotFound(false);
        setError(null);
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Data is temporarily unavailable",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [exchange, summaryPath, symbol],
  );

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshSummary(), 0);
    const interval = window.setInterval(
      () => void refreshSummary(true),
      30_000,
    );
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [refreshSummary]);

  const quote = summary?.quote;
  const currency = summary?.identity.currency ?? "USD";
  const isPositive = (quote?.changePercent.value ?? 0) >= 0;
  const displayCompanyName = summary?.identity.company.value ?? companyName;

  return (
    <ResearchShellContext.Provider
      value={{
        summary,
        loading,
        refreshing,
        error,
        notFound,
        refreshSummary,
      }}
    >
      <div className="security-research-page">
        <div className="security-research-shell">
          <Link className="security-research-back" href="/value-opportunities">
            <ArrowLeft aria-hidden="true" size={16} />
            Back to opportunities
          </Link>

          <header className="security-research-header">
            <div className="security-research-identity">
              <CompanyLogo
                className="security-research-monogram"
                symbol={symbol}
                loading="eager"
              />
              <div>
                <p className="security-research-ticker">
                  {exchange}:{symbol}
                </p>
                <h1>{displayCompanyName} opportunity overview</h1>
                <p>
                  {summary?.applicability.companyAnalysis === false
                    ? "Quote data is available, but company valuation and business-quality models do not apply to this security type."
                    : "Does today's price offer enough margin of safety for this business's quality and risks?"}
                </p>
              </div>
            </div>

            <div className="security-research-quote">
              <div>
                <strong>{money(quote?.price.value ?? null, currency)}</strong>
                {quote?.changePercent.value !== null &&
                quote?.changePercent.value !== undefined ? (
                  <span className={isPositive ? "is-positive" : "is-negative"}>
                    {isPositive ? (
                      <ArrowUpRight aria-hidden="true" size={15} />
                    ) : (
                      <ArrowDownRight aria-hidden="true" size={15} />
                    )}
                    {percent(quote.changePercent.value)}
                  </span>
                ) : null}
              </div>
              <p>
                {quote?.marketCap.value !== null &&
                quote?.marketCap.value !== undefined ? (
                  <span className="security-research-market-cap">
                    Market cap{" "}
                    {money(quote.marketCap.value, currency, true)}
                  </span>
                ) : null}
                <span>
                  <Clock3 aria-hidden="true" size={13} />
                  {freshness(summary?.asOf ?? null)}
                </span>
                <button
                  type="button"
                  aria-label="Refresh company summary"
                  disabled={refreshing}
                  onClick={() => void refreshSummary(true)}
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={refreshing ? "is-spinning" : undefined}
                    size={15}
                  />
                </button>
              </p>
            </div>
          </header>
        </div>

        <div className="security-research-tabs-sticky">
          <div className="security-research-tabs-inner">
            <SecurityResearchNav exchange={exchange} symbol={symbol} />
          </div>
        </div>

        <main className="security-research-main">
          <div
            id="research-tab-panel"
            className="security-research-tab-panel"
            role="tabpanel"
            aria-labelledby={`research-tab-${activeView}`}
            tabIndex={0}
          >
            {children}
          </div>
        </main>
      </div>
    </ResearchShellContext.Provider>
  );
}
