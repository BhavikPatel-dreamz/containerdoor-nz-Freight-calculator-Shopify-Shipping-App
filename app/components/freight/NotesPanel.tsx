/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */
import type { NoteItem } from "./types";

interface CommunicationLogEntry {
  id: string;
  channel: string;
  subject: string;
  body: string;
  recipientEmail: string;
  recipientName: string;
  sentBy: string;
  deliveryStatus: string;
  sentAt: string;
}

type NotesPanelProps = {
  notes: NoteItem[];
  communications?: CommunicationLogEntry[];
  notesFetching: boolean;
  onAddNote: () => void;
};

function formatCommsTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) +
      " " + d.toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

export function NotesPanel({ notes, communications = [], notesFetching, onAddNote }: NotesPanelProps) {
  const hasComms = communications.length > 0;

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
        ) : notes.length === 0 && !hasComms ? (
          <div style={{ color: "#9ca3af", fontSize: "13px", textAlign: "center", marginTop: "40px" }}>No notes yet for this line item.</div>
        ) : null}

        {/* Communication log entries */}
        {hasComms && (
          <>
            <div style={{ fontSize: "10px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em", padding: "8px 0 4px", borderTop: notes.length > 0 ? "1px solid #e5e7eb" : "none" }}>
              Emails sent ({communications.length})
            </div>
            {communications.map((c) => (
              <div key={c.id} className="fo-note-item" style={{ borderLeftColor: c.deliveryStatus === "sent" ? "#16a34a" : "#dc2626" }}>
                <div className="fo-note-avatar" style={{ background: c.deliveryStatus === "sent" ? "#16a34a" : "#dc2626" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                </div>
                <div className="fo-note-body">
                  <div className="fo-note-meta">
                    <span className="fo-note-author">Email</span>
                    <span style={{ color: "#d1d5db" }}>·</span>
                    <span>{formatCommsTime(c.sentAt)}</span>
                    <span className="fo-note-role-tag system" style={{ background: c.deliveryStatus === "sent" ? "#dcfce7" : "#fee2e2", color: c.deliveryStatus === "sent" ? "#166534" : "#991b1b" }}>
                      {c.deliveryStatus === "sent" ? "Sent" : "Failed"}
                    </span>
                  </div>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "#111827", marginTop: 2 }}>
                    {c.subject}
                  </div>
                  <div className="fo-note-text" style={{ marginTop: 2, whiteSpace: "pre-wrap" }}>
                    To: {c.recipientName} &lt;{c.recipientEmail}&gt;
                    {c.body ? `\n${c.body.slice(0, 200)}${c.body.length > 200 ? "…" : ""}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {notes.map((note, i) => (
          <div className="fo-note-item" key={`note-${i}`}>
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
