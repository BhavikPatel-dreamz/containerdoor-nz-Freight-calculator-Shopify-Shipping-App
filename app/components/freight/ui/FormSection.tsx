import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export function FormSection({
  label,
  htmlFor,
  hint,
  children,
}: {
  label?: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="fo-form-section">
      {label ? (
        <label className="fo-field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {hint ? <div className="fo-form-hint">{hint}</div> : null}
    </div>
  );
}

export function FieldInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="fo-input" {...props} />;
}

export function FieldSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="fo-input fo-input-select" {...props} />;
}

export function FieldTextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="fo-input fo-input-textarea" {...props} />;
}

type SearchableSelectProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  allowClear?: boolean;
  clearLabel?: string;
};

export function SearchableSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "Search…",
  allowClear = true,
  clearLabel = "— clear —",
}: SearchableSelectProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);
  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(query.toLowerCase()),
  );
  const rows: Array<{ value: string; label: string }> = allowClear
    ? [{ value: "", label: clearLabel }, ...filtered]
    : filtered;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) setHighlight(0);
  }, [open, query]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery("");
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter" && rows[highlight]) {
      e.preventDefault();
      pick(rows[highlight].value);
    }
  };

  return (
    <div className="fo-search-select" ref={rootRef}>
      <button
        type="button"
        id={id}
        className="fo-input fo-search-select-trigger"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-label={selected?.label || placeholder}
      >
        <span>{selected?.label || (value === "" && allowClear ? clearLabel : placeholder)}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open ? (
        <div className="fo-search-select-menu">
          <input
            className="fo-input"
            autoFocus
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            aria-label={placeholder}
            aria-controls={listId}
            aria-activedescendant={rows[highlight] ? `${listId}-opt-${highlight}` : undefined}
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
          />
          <div className="fo-search-select-list" id={listId} role="listbox">
            {rows.map((opt, i) => (
              <button
                key={`${opt.value}-${i}`}
                id={`${listId}-opt-${i}`}
                type="button"
                role="option"
                aria-selected={value === opt.value}
                className={`fo-search-select-option ${value === opt.value || i === highlight ? "is-active" : ""}`}
                onClick={() => pick(opt.value)}
              >
                {opt.label}
              </button>
            ))}
            {filtered.length === 0 ? (
              <div className="fo-search-select-empty">No matches</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
