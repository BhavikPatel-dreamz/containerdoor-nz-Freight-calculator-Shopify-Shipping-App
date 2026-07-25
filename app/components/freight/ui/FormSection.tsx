import { useEffect, useRef, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

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
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);
  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="fo-search-select" ref={rootRef}>
      <button
        type="button"
        id={id}
        className="fo-input fo-search-select-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>{selected?.label || (value === "" && allowClear ? clearLabel : placeholder)}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
          />
          <div className="fo-search-select-list">
            {allowClear ? (
              <button
                type="button"
                className={`fo-search-select-option ${value === "" ? "is-active" : ""}`}
                onClick={() => {
                  onChange("");
                  setOpen(false);
                  setQuery("");
                }}
              >
                {clearLabel}
              </button>
            ) : null}
            {filtered.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`fo-search-select-option ${value === opt.value ? "is-active" : ""}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                  setQuery("");
                }}
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
