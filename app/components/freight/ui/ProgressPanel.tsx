type ProgressStep = {
  id: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
};

type ProgressPanelProps = {
  title?: string;
  done: number;
  total: number;
  steps: ProgressStep[];
  currentLabel?: string;
  currentMeta?: string;
};

export function ProgressPanel({
  title = "Updating Line Items",
  done,
  total,
  steps,
  currentLabel,
  currentMeta,
}: ProgressPanelProps) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <div className="fo-progress-panel">
      <div className="fo-progress-title">{title}</div>
      <div className="fo-progress-bar-track">
        <div className="fo-progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="fo-progress-count">
        {done} / {total}
      </div>

      <ul className="fo-progress-steps">
        {steps.map((step) => (
          <li key={step.id} className={`fo-progress-step is-${step.status}`}>
            <span className="fo-progress-step-mark">
              {step.status === "done" ? "✓" : step.status === "error" ? "✕" : step.status === "active" ? "●" : "○"}
            </span>
            {step.label}
          </li>
        ))}
      </ul>

      {(currentLabel || currentMeta) && (
        <div className="fo-progress-current">
          <div className="fo-progress-current-label">Current Item</div>
          {currentLabel ? <div className="fo-progress-current-name">{currentLabel}</div> : null}
          {currentMeta ? <div className="fo-progress-current-meta">{currentMeta}</div> : null}
        </div>
      )}
    </div>
  );
}
