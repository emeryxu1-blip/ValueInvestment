import Link from "next/link";

export type ResearchView =
  | "summary"
  | "cash-flow-value"
  | "relative-value"
  | "business-quality";

const views: Array<{ id: ResearchView; label: string }> = [
  { id: "summary", label: "Opportunity overview" },
  { id: "cash-flow-value", label: "Cash-flow safety" },
  { id: "relative-value", label: "Market expectations" },
  { id: "business-quality", label: "Quality check" },
];

export function SecurityResearchNav({
  exchange,
  symbol,
  active,
}: {
  exchange: string;
  symbol: string;
  active: ResearchView;
}) {
  const base = `/value-opportunities/${encodeURIComponent(exchange.toLowerCase())}/${encodeURIComponent(symbol.toLowerCase())}`;
  const hrefs: Record<ResearchView, string> = {
    summary: `${base}/overview`,
    "cash-flow-value": `${base}/cash-flow`,
    "relative-value": `${base}/market-comparison`,
    "business-quality": `${base}/business-quality`,
  };

  return (
    <nav className="security-research-nav" aria-label="Company research views">
      <div className="security-research-nav__rail">
        {views.map((view) => (
          <Link
            key={view.id}
            href={hrefs[view.id]}
            aria-current={view.id === active ? "page" : undefined}
          >
            {view.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
