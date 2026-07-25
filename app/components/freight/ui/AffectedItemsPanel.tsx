type SummaryItem = {
  id: string;
  label: string;
  active: boolean;
};

type SummaryPanelProps = {
  title?: string;
  items: SummaryItem[];
};

export function SummaryPanel({ title = "Summary", items }: SummaryPanelProps) {
  const active = items.filter((i) => i.active);
  if (active.length === 0) {
    return (
      <div className="fo-summary-panel">
        <div className="fo-ws-section-title">{title}</div>
        <p className="fo-summary-empty">No actions selected yet</p>
      </div>
    );
  }

  return (
    <div className="fo-summary-panel">
      <div className="fo-ws-section-title">{title}</div>
      <ul className="fo-summary-list">
        {active.map((item) => (
          <li key={item.id}>
            <span className="fo-summary-check">✓</span>
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

type AffectedGroup = {
  id: string;
  label: string;
  count: number;
};

type AffectedItemsPanelProps = {
  total: number;
  groups: AffectedGroup[];
  title?: string;
};

export function AffectedItemsPanel({
  total,
  groups,
  title = "Affected Items",
}: AffectedItemsPanelProps) {
  return (
    <div className="fo-affected-panel">
      <div className="fo-ws-section-title">{title}</div>
      <p className="fo-affected-total">
        {total} line item{total !== 1 ? "s" : ""} selected
      </p>
      <ul className="fo-affected-list">
        {groups.map((g) => (
          <li key={g.id}>
            <span className="fo-affected-check">✓</span>
            <span className="fo-affected-label">{g.label}</span>
            <span className="fo-affected-count">({g.count})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
