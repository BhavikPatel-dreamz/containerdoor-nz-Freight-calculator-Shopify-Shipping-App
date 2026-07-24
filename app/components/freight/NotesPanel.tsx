/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */
import type { NoteItem } from "./types";

type NotesPanelProps = {
  notes: NoteItem[];
  notesFetching: boolean;
  onAddNote: () => void;
};

export function NotesPanel({ notes, notesFetching, onAddNote }: NotesPanelProps) {
  return (
    <div className="fo-detail-right">
      <div className="fo-notes-hdr">
        Notes & Customer History
        <button className="fo-notes-add-btn" onClick={onAddNote}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Add note
        </button>
      </div>
      <div className="fo-note-list">
        {notesFetching ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginTop: "40px", color: "#9ca3af", fontSize: "13px" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            Loading notes…
          </div>
        ) : notes.length === 0 ? (
          <div style={{ color: "#9ca3af", fontSize: "13px", textAlign: "center", marginTop: "40px" }}>No notes yet for this line item.</div>
        ) : null}
        {notes.map((note, i) => (
          <div className="fo-note-item" key={i}>
            <div className="fo-note-avatar" style={{ background: note.role === "customer" ? "#16a34a" : note.role === "system" ? "#6b7280" : "#2563eb" }}>
              {note.author.slice(0, 2).toUpperCase()}
            </div>
            <div className="fo-note-body">
              <div className="fo-note-meta">
                <span className="fo-note-author">{note.author}</span>
                <span style={{ color: "#d1d5db" }}>·</span>
                <span>{note.time}</span>
                <span className={`fo-note-role-tag ${note.role}`}>{note.scheme.charAt(0).toUpperCase() + note.scheme.slice(1)}</span>
              </div>
              <div className="fo-note-text">{note.text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
