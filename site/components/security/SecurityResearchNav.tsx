"use client";

import {
  ChartNoAxesCombined,
  Landmark,
  Scale,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, type KeyboardEvent } from "react";

export type ResearchView =
  | "summary"
  | "cash-flow-value"
  | "relative-value"
  | "business-quality";

type ResearchViewDefinition = {
  id: ResearchView;
  label: string;
  shortLabel: string;
  segment: string;
  icon: LucideIcon;
};

export const researchViews: ResearchViewDefinition[] = [
  {
    id: "summary",
    label: "Opportunity overview",
    shortLabel: "Overview",
    segment: "overview",
    icon: ChartNoAxesCombined,
  },
  {
    id: "cash-flow-value",
    label: "Cash-flow safety",
    shortLabel: "Cash flow",
    segment: "cash-flow",
    icon: Landmark,
  },
  {
    id: "relative-value",
    label: "Market expectations",
    shortLabel: "Expectations",
    segment: "market-comparison",
    icon: Scale,
  },
  {
    id: "business-quality",
    label: "Quality check",
    shortLabel: "Quality",
    segment: "business-quality",
    icon: ShieldCheck,
  },
];

export function researchViewFromPathname(pathname: string): ResearchView {
  const segment = pathname.split("/").filter(Boolean).at(-1);
  return (
    researchViews.find((view) => view.segment === segment)?.id ?? "summary"
  );
}

export function SecurityResearchNav({
  exchange,
  symbol,
}: {
  exchange: string;
  symbol: string;
}) {
  const pathname = usePathname();
  const active = researchViewFromPathname(pathname);
  const links = useRef<Array<HTMLAnchorElement | null>>([]);
  const base = `/value-opportunities/${encodeURIComponent(exchange.toLowerCase())}/${encodeURIComponent(symbol.toLowerCase())}`;

  const handleKeyDown = (
    event: KeyboardEvent<HTMLAnchorElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % researchViews.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (index - 1 + researchViews.length) % researchViews.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = researchViews.length - 1;
    }
    if (nextIndex === null) return;

    event.preventDefault();
    links.current[nextIndex]?.focus();
    links.current[nextIndex]?.click();
  };

  return (
    <nav className="security-research-nav" aria-label="Company research">
      <div
        className="security-research-nav__rail"
        role="tablist"
        aria-label="Investment research views"
      >
        {researchViews.map((view, index) => {
          const Icon = view.icon;
          const isActive = view.id === active;
          return (
            <Link
              key={view.id}
              ref={(node) => {
                links.current[index] = node;
              }}
              id={`research-tab-${view.id}`}
              href={`${base}/${view.segment}`}
              role="tab"
              aria-controls="research-tab-panel"
              aria-selected={isActive}
              aria-current={isActive ? "page" : undefined}
              tabIndex={isActive ? 0 : -1}
              prefetch
              scroll={false}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <Icon aria-hidden="true" size={15} strokeWidth={2} />
              <span className="security-research-nav__label">
                {view.label}
              </span>
              <span className="security-research-nav__short-label">
                {view.shortLabel}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
