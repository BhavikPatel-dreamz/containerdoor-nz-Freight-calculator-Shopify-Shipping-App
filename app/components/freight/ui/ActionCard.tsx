import type { ReactNode, MouseEvent } from "react";

type ActionCardProps = {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  disabled?: boolean;
};

export function ActionCard({
  enabled,
  onToggle,
  title,
  description,
  children,
  disabled,
}: ActionCardProps) {
  const toggle = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    onToggle(!enabled);
  };

  return (
    <div className={`fo-action-card ${enabled ? "is-enabled" : ""} ${disabled ? "is-disabled" : ""}`.trim()}>
      <button
        type="button"
        className="fo-action-card-toggle"
        onClick={toggle}
        disabled={disabled}
        aria-pressed={enabled}
      >
        <span className={`fo-action-check ${enabled ? "is-checked" : ""}`} aria-hidden="true">
          {enabled ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : null}
        </span>
        <span className="fo-action-card-title">{title}</span>
      </button>
      {description && !enabled ? (
        <p className="fo-action-card-desc">{description}</p>
      ) : null}
      {enabled && children ? (
        <div className="fo-action-card-body" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
