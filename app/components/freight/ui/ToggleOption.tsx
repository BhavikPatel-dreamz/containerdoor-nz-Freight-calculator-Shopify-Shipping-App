import type { ReactNode } from "react";

type ToggleOptionProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  badge?: string;
};

export function ToggleOption({
  checked,
  onChange,
  label,
  description,
  disabled,
  badge,
}: ToggleOptionProps) {
  return (
    <button
      type="button"
      className={`fo-toggle-option ${disabled ? "is-disabled" : ""} ${checked ? "is-checked" : ""}`.trim()}
      onClick={() => {
        if (disabled) return;
        onChange(!checked);
      }}
      disabled={disabled}
      aria-pressed={checked}
    >
      <span className={`fo-action-check ${checked ? "is-checked" : ""}`} aria-hidden="true">
        {checked ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : null}
      </span>
      <span className="fo-toggle-option-text">
        <span className="fo-toggle-option-label">
          {label}
          {badge ? <span className="fo-toggle-badge">{badge}</span> : null}
        </span>
        {description ? <span className="fo-toggle-option-desc">{description}</span> : null}
      </span>
    </button>
  );
}

type ToggleCardProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
};

/** Switch-style toggle row (notify customer, etc.) */
export function ToggleCard({ checked, onChange, title, description, children }: ToggleCardProps) {
  return (
    <div className={`fo-toggle-card ${checked ? "is-on" : ""}`.trim()}>
      <div className="fo-toggle-card-row">
        <div>
          <div className="fo-toggle-card-title">{title}</div>
          {description ? <div className="fo-toggle-card-desc">{description}</div> : null}
        </div>
        <button
          type="button"
          className={`fo-switch ${checked ? "is-on" : ""}`}
          onClick={() => onChange(!checked)}
          aria-pressed={checked}
        >
          <span className="fo-switch-knob" />
        </button>
      </div>
      {checked && children ? <div className="fo-toggle-card-body">{children}</div> : null}
    </div>
  );
}
