/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */

/**
 * Activity & History — reads ONLY from our Postgres CommunicationLog.
 * No Shopify / Monday / Cin7 / legacy notes-string as source of truth.
 */

export interface ActivityLogEntry {
  id: string;
  activityType?: string;
  channel: string;
  subject: string;
  body: string;
  recipientEmail?: string;
  recipientName?: string;
  sentBy: string;
  deliveryStatus: string;
  sentAt: string;
  variantId?: string | null;
  syncTargets?: string[] | null;
  syncResults?: Record<string, { ok?: boolean; error?: string }> | null;
}

type NotesPanelProps = {
  communications?: ActivityLogEntry[];
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

function activityMeta(type: string, status?: string) {
  if (type === "email" && status === "pending") {
    return { icon: "📧", label: "Email Queued", color: "#ca8a04" };
  }
  switch (type) {
    case "email":
      return { icon: "📧", label: status === "failed" ? "Email Failed" : "Email Sent", color: status === "failed" ? "#dc2626" : "#16a34a" };
    case "internal_note":
      return { icon: "📝", label: "Internal Note", color: "#2563eb" };
    case "customer_note":
      return { icon: "💬", label: "Customer Note", color: "#16a34a" };
    case "monday_note":
      return { icon: "📋", label: "Monday Note", color: "#7c3aed" };
    case "cin7_note":
      return { icon: "🏭", label: "Cin7 Note", color: "#0891b2" };
    case "shopify_note":
      return { icon: "🏪", label: "Shopify Note", color: "#059669" };
    case "edd_update":
      return { icon: "🚚", label: "EDD Updated", color: "#d97706" };
    case "supplier_update":
      return { icon: "📦", label: "Supplier Updated", color: "#ea580c" };
    case "payment_update":
      return { icon: "💳", label: "Payment Updated", color: "#0f766e" };
    case "tracking_update":
      return { icon: "📍", label: "Tracking Updated", color: "#2563eb" };
    case "sms":
      return { icon: "📱", label: "SMS", color: "#4f46e5" };
    case "whatsapp":
      return { icon: "💬", label: "WhatsApp", color: "#16a34a" };
    default:
      return { icon: "⚙️", label: "System Event", color: "#6b7280" };
  }
}

function statusStyle(status: string) {
  if (status === "failed") return { bg: "#fee2e2", color: "#991b1b", label: "Failed" };
  if (status === "pending") return { bg: "#fef3c7", color: "#92400e", label: "Queued" };
  if (status === "synced") return { bg: "#ede9fe", color: "#5b21b6", label: "Synced" };
  if (status === "internal") return { bg: "#f3f4f6", color: "#374151", label: "OMS only" };
  if (status === "partial") return { bg: "#ffedd5", color: "#9a3412", label: "Partial" };
  return { bg: "#dcfce7", color: "#166534", label: "Sent" };
}

export function NotesPanel({ communications = [], notesFetching, onAddNote }: NotesPanelProps) {
  // Newest first — server already sorts; re-sort client-side as safety net
  const sorted = [...communications].sort((a, b) => {
    const ta = new Date(a.sentAt || 0).getTime();
    const tb = new Date(b.sentAt || 0).getTime();
    if (tb !== ta) return tb - ta;
    return String(b.id).localeCompare(String(a.id));
  });
  const hasComms = sorted.length > 0;

  return (
    <div className="fo-detail-right">
      <div className="fo-notes-hdr">
        Activity & History
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
            Loading history…
          </div>
        ) : !hasComms ? (
          <div style={{ color: "#9ca3af", fontSize: "13px", textAlign: "center", marginTop: "40px" }}>
            No activity yet for this line item.
          </div>
        ) : null}

        {hasComms && sorted.map((c) => {
          const type = c.activityType || (c.channel === "email" ? "email" : "system_event");
          const meta = activityMeta(type, c.deliveryStatus);
          const st = statusStyle(c.deliveryStatus);
          return (
            <div key={c.id} className="fo-note-item" style={{ borderLeftColor: meta.color }}>
              <div className="fo-note-avatar" style={{ background: meta.color, fontSize: "12px" }}>
                {meta.icon}
              </div>
              <div className="fo-note-body">
                <div className="fo-note-meta">
                  <span className="fo-note-author">{meta.label}</span>
                  <span style={{ color: "#d1d5db" }}>·</span>
                  <span>{c.sentBy}</span>
                  <span style={{ color: "#d1d5db" }}>·</span>
                  <span>{formatCommsTime(c.sentAt)}</span>
                  <span className="fo-note-role-tag system" style={{ background: st.bg, color: st.color }}>
                    {st.label}
                  </span>
                </div>
                {c.subject && type === "email" ? (
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "#111827", marginTop: 2 }}>{c.subject}</div>
                ) : null}
                <div className="fo-note-text" style={{ marginTop: 2, whiteSpace: "pre-wrap" }}>
                  {type === "email" && c.recipientEmail
                    ? `To: ${c.recipientName || "—"} <${c.recipientEmail}>\n`
                    : ""}
                  {c.body}
                </div>
                {Array.isArray(c.syncTargets) && c.syncTargets.length > 0 ? (
                  <div style={{ fontSize: "10px", color: "#6b7280", marginTop: 4 }}>
                    Sync: {c.syncTargets.join(", ")}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
