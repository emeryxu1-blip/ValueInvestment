import type { ReactNode } from "react";

export type ResearchPanelView =
  | "overview"
  | "cash-flow"
  | "market-expectations"
  | "quality";

export default function ResearchPanelHeader({
  view,
  eyebrow,
  title,
  description,
  action,
}: {
  view: ResearchPanelView;
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const titleId = `research-panel-heading-${view}`;

  return (
    <header
      className="security-research-panel-header"
      data-research-panel={view}
      aria-labelledby={titleId}
    >
      <div className="security-research-panel-header__copy">
        <p className="security-research-panel-header__eyebrow">{eyebrow}</p>
        <h2
          className="security-research-panel-header__title"
          id={titleId}
        >
          {title}
        </h2>
        <p className="security-research-panel-header__body">{description}</p>
      </div>
      {action ? (
        <div className="security-research-panel-header__actions">{action}</div>
      ) : null}
    </header>
  );
}
