import type { ReactNode } from "react";
import { Calculator, ChevronRight } from "lucide-react";

type CalculationFormula = {
  label: string;
  expression: ReactNode;
};

type CalculationItem = {
  label: string;
  value: ReactNode;
};

type CalculationDisclosureProps = {
  title?: string;
  summary: ReactNode;
  badges?: Array<string | null | undefined>;
  formulas?: CalculationFormula[];
  items?: CalculationItem[];
  children?: ReactNode;
  className?: string;
  defaultOpen?: boolean;
};

/**
 * A touch, keyboard, and screen-reader friendly explanation of a calculated value.
 * The equation or selection rule remains visible even while the details are closed.
 */
export default function CalculationDisclosure({
  title = "Method & inputs",
  summary,
  badges = [],
  formulas = [],
  items = [],
  children,
  className = "",
  defaultOpen = false,
}: CalculationDisclosureProps) {
  const visibleBadges = badges.filter((badge): badge is string => Boolean(badge));

  return (
    <details
      className={`calculation-disclosure ${className}`.trim()}
      data-calculation-disclosure="true"
      open={defaultOpen || undefined}
    >
      <summary>
        <span className="calculation-disclosure-icon" aria-hidden="true">
          <Calculator size={16} strokeWidth={1.9} />
        </span>
        <span className="calculation-disclosure-heading">
          <strong>{title}</strong>
          <span>{summary}</span>
        </span>
        {visibleBadges.length ? (
          <span className="calculation-disclosure-badges" aria-label="Method metadata">
            {visibleBadges.map((badge) => (
              <span key={badge}>{badge}</span>
            ))}
          </span>
        ) : null}
        <ChevronRight
          className="calculation-disclosure-chevron"
          size={17}
          strokeWidth={2}
          aria-hidden="true"
        />
      </summary>

      <div className="calculation-disclosure-body">
        {formulas.length ? (
          <div className="calculation-disclosure-formulas">
            {formulas.map((formula) => (
              <div key={formula.label}>
                <span>{formula.label}</span>
                <code>{formula.expression}</code>
              </div>
            ))}
          </div>
        ) : null}

        {items.length ? (
          <dl>
            {items.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {children ? <div className="calculation-disclosure-notes">{children}</div> : null}
      </div>
    </details>
  );
}
