/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FreightOrderRow, FreightLineItem, NoteItem } from "./types";
import { getRefPrefix } from "./helpers";

// ─── Tracking Modal ──────────────────────────────────────────────────────────

type TrackingModalProps = {
  trackingModal: { order: FreightOrderRow; item: FreightLineItem };
  trackingForm: { carrier: string; trackingNumber: string; freightRef: string; deliveryMethod: string; notifyCustomer: boolean };
  trackingError: string;
  isSavingTracking: boolean;
  setTrackingForm: React.Dispatch<React.SetStateAction<{ carrier: string; trackingNumber: string; freightRef: string; deliveryMethod: string; notifyCustomer: boolean }>>;
  setTrackingModal: React.Dispatch<React.SetStateAction<{ order: FreightOrderRow; item: FreightLineItem } | null>>;
  setTrackingError: (v: string) => void;
  onSave: () => void;
};

export function TrackingModal({ trackingModal: tm, trackingForm, trackingError, isSavingTracking, setTrackingForm, setTrackingModal, setTrackingError, onSave }: TrackingModalProps) {
  const close = () => { setTrackingModal(null); setTrackingError(""); };
  return (
    <div className="fo-overlay" onClick={close}>
      <div className="fo-modal" style={{ width: "560px", maxWidth: "95vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="fo-modal-hdr" style={{ borderBottom: "1px solid #e5e7eb", padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "18px" }}>🚛</span>
            <span className="fo-modal-title" style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>
              Add / edit tracking — <span style={{ color: "#2563eb" }}>{tm.order.shopifyOrderName}</span> {tm.item.letterSuffix}
            </span>
          </div>
          <button className="fo-modal-close" onClick={close}>✕</button>
        </div>
        <div style={{ padding: "12px 20px", borderBottom: "1px solid #e5e7eb" }}>
          <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "6px", padding: "12px 16px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>{tm.item.title ?? `#${tm.item.variantId}`}</div>
            {tm.item.variantId && <div style={{ fontSize: "12px", color: "#475569", marginTop: "3px" }}>— VAR-{tm.item.variantId.slice(-6)}</div>}
          </div>
        </div>
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          {trackingError && <div style={{ padding: "10px 12px", borderRadius: "6px", background: "#fee2e2", border: "1px solid #fecaca", color: "#991b1b", fontSize: "13px" }}>{trackingError}</div>}
          <div>
            <label className="fo-field-label" htmlFor="t-carrier">Carrier</label>
            <div style={{ position: "relative" }}>
              <select id="t-carrier" className="fo-input" style={{ appearance: "none", WebkitAppearance: "none", paddingRight: "36px", cursor: "pointer" }}
                value={trackingForm.carrier}
                onChange={(e) => {
                  const carrier = e.target.value;
                  setTrackingForm((p) => {
                    const prevPrefix = getRefPrefix(p.carrier);
                    const newPrefix = getRefPrefix(carrier);
                    const shouldUpdateRef = !p.freightRef || p.freightRef === prevPrefix;
                    return { ...p, carrier, freightRef: shouldUpdateRef ? newPrefix : p.freightRef };
                  });
                }}>
                <option value="">Select carrier...</option>
                <option value="MAINFREIGHT">Mainfreight</option><option value="NZP">NZ Post</option>
                <option value="TGE">Team Global Express</option><option value="FLIWAY">Fliway - Linehaul</option>
                <option value="CASTLE">Castle</option><option value="M2H">M2H</option>
              </select>
              <svg style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#6b7280" }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
            </div>
          </div>
          <div>
            <label className="fo-field-label" htmlFor="t-num">Tracking number</label>
            <input id="t-num" className="fo-input" placeholder="e.g. MF8821003" value={trackingForm.trackingNumber} onChange={(e) => setTrackingForm((p) => ({ ...p, trackingNumber: e.target.value }))} />
          </div>
          <div>
            <label className="fo-field-label" htmlFor="t-ref">Freight / consignment reference</label>
            <input id="t-ref" className="fo-input" placeholder="Optional" value={trackingForm.freightRef} onChange={(e) => setTrackingForm((p) => ({ ...p, freightRef: e.target.value }))} />
          </div>
          <div>
            <label className="fo-field-label" htmlFor="t-method">Delivery method</label>
            <div style={{ position: "relative" }}>
              <select id="t-method" className="fo-input" style={{ appearance: "none", WebkitAppearance: "none", paddingRight: "36px", cursor: "pointer" }}
                value={trackingForm.deliveryMethod} onChange={(e) => setTrackingForm((p) => ({ ...p, deliveryMethod: e.target.value }))}>
                <option>Standard</option><option>Express</option><option>Overnight</option><option>Depot pickup</option>
              </select>
              <svg style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#6b7280" }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "14px 16px", borderRadius: "8px", background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827" }}>Notify customer with tracking details</div>
              <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "3px" }}>Sends dispatch email to {tm.order.email}</div>
            </div>
            <button type="button" onClick={() => setTrackingForm((p) => ({ ...p, notifyCustomer: !p.notifyCustomer }))}
              style={{ flexShrink: 0, width: "44px", height: "24px", borderRadius: "12px", background: trackingForm.notifyCustomer ? "#2563eb" : "#d1d5db", border: "none", cursor: "pointer", position: "relative", transition: "background 0.2s" }}>
              <span style={{ position: "absolute", top: "2px", left: trackingForm.notifyCustomer ? "22px" : "2px", width: "20px", height: "20px", borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
            </button>
          </div>
        </div>
        <div className="fo-modal-ftr" style={{ padding: "12px 20px" }}>
          <button className="fo-btn-ghost" onClick={close}>Cancel</button>
          <button type="button" style={{ padding: "8px 20px", fontSize: "13px", fontWeight: 600, borderRadius: "6px", background: "#111827", color: "#fff", border: "none", cursor: "pointer" }}
            onClick={onSave} disabled={isSavingTracking}>
            {isSavingTracking ? "Saving..." : "Save & mark dispatched"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EDD Modal ───────────────────────────────────────────────────────────────

type EddModalProps = {
  eddModal: { order: FreightOrderRow; item: FreightLineItem };
  eddForm: { newEdd: string; reason: string; notifyCustomer: boolean };
  eddError: string;
  isSavingEdd: boolean;
  setEddForm: React.Dispatch<React.SetStateAction<{ newEdd: string; reason: string; notifyCustomer: boolean }>>;
  setEddModal: React.Dispatch<React.SetStateAction<{ order: FreightOrderRow; item: FreightLineItem } | null>>;
  setEddError: (v: string) => void;
  onSave: () => void;
};

export function EddModal({ eddModal: em, eddForm, eddError, isSavingEdd, setEddForm, setEddModal, setEddError, onSave }: EddModalProps) {
  const close = () => { setEddModal(null); setEddError(""); };
  return (
    <div className="fo-overlay" onClick={close}>
      <div style={{ background: "#fff", borderRadius: "10px", width: "500px", maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #e5e7eb" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "16px" }}>📅</span>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>
              Update EDD — <span style={{ color: "#2563eb" }}>{em.order.shopifyOrderName}</span>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "20px", height: "20px", borderRadius: "4px", background: "#dbeafe", color: "#1d4ed8", fontSize: "10px", fontWeight: 700, marginLeft: "6px" }}>{em.item.letterSuffix}</span>
            </span>
          </div>
          <button className="fo-modal-close" onClick={close}>✕</button>
        </div>
        <div style={{ padding: "10px 20px", borderBottom: "1px solid #e5e7eb" }}>
          <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "6px", padding: "10px 14px", fontSize: "13px", fontWeight: 600, color: "#1e40af" }}>
            {em.item.title ?? `#${em.item.variantId}`}
            {em.item.variantId && <span style={{ color: "#3b82f6", marginLeft: "8px", fontWeight: 500 }}>— VAR-{em.item.variantId.slice(-6)}</span>}
          </div>
        </div>
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          {eddError && <div style={{ padding: "10px 12px", borderRadius: "6px", background: "#fee2e2", border: "1px solid #fecaca", color: "#991b1b", fontSize: "13px" }}>{eddError}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "#374151", marginBottom: "6px" }}>Original EDD</label>
              <input type="text" readOnly
                value={(() => { const d = em.item.originalEddDate || em.item.eddDate; if (!d) return eddForm.newEdd ? new Date(eddForm.newEdd).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : "Not set"; return new Date(d).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }); })()}
                style={{ width: "100%", padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: "8px", background: "#f9fafb", color: "#6b7280", fontSize: "13px", cursor: "not-allowed" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "#374151", marginBottom: "6px" }}>New EDD</label>
              <input type="date" value={eddForm.newEdd} onChange={(e) => setEddForm((p) => ({ ...p, newEdd: e.target.value }))}
                style={{ width: "100%", padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: "8px", background: "#fff", color: "#111827", fontSize: "13px", outline: "none" }} />
            </div>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "#374151", marginBottom: "6px" }}>Reason for change (optional)</label>
            <textarea rows={3} placeholder="e.g. Supplier delay — new stock arriving 2 Jul"
              value={eddForm.reason} onChange={(e) => setEddForm((p) => ({ ...p, reason: e.target.value }))}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: "8px", background: "#fff", color: "#111827", fontSize: "13px", outline: "none", resize: "vertical", fontFamily: "inherit" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderRadius: "8px", background: "#fffbeb", border: "1px solid #fde68a" }}>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827" }}>Notify customer of EDD change</div>
              <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "3px" }}>Toggle on to send EDD update to {em.order.email}</div>
            </div>
            <button type="button" onClick={() => setEddForm((p) => ({ ...p, notifyCustomer: !p.notifyCustomer }))}
              style={{ flexShrink: 0, width: "44px", height: "24px", borderRadius: "12px", background: eddForm.notifyCustomer ? "#2563eb" : "#d1d5db", border: "none", cursor: "pointer", position: "relative", transition: "background 0.2s" }}>
              <span style={{ position: "absolute", top: "2px", left: eddForm.notifyCustomer ? "22px" : "2px", width: "20px", height: "20px", borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
            </button>
          </div>
        </div>
        <div style={{ padding: "12px 20px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button className="fo-btn-ghost" onClick={close}>Cancel</button>
          <button type="button" style={{ padding: "8px 20px", fontSize: "13px", fontWeight: 600, borderRadius: "6px", background: "#2563eb", color: "#fff", border: "none", cursor: "pointer" }}
            onClick={onSave} disabled={isSavingEdd}>
            {isSavingEdd ? "Saving…" : "Update EDD"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Bulk EDD Modal ──────────────────────────────────────────────────────────

type BulkEddModalProps = {
  selectedCount: number;
  bulkEddForm: { newEdd: string; notifyCustomer: boolean };
  bulkEddError: string;
  isBulkSavingEdd: boolean;
  bulkProgress: { done: number; total: number } | null;
  setBulkEddForm: React.Dispatch<React.SetStateAction<{ newEdd: string; notifyCustomer: boolean }>>;
  setBulkEddModal: (v: boolean) => void;
  setBulkEddError: (v: string) => void;
  onSave: () => void;
};

export function BulkEddModal({ selectedCount, bulkEddForm, bulkEddError, isBulkSavingEdd, bulkProgress, setBulkEddForm, setBulkEddModal, setBulkEddError, onSave }: BulkEddModalProps) {
  const close = () => { if (!isBulkSavingEdd) { setBulkEddModal(false); setBulkEddError(""); } };
  return (
    <div className="fo-overlay" onClick={close}>
      <div style={{ background: "#fff", borderRadius: "10px", width: "480px", maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #e5e7eb" }}>
          <span style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>📅 Bulk update EDD — {selectedCount} line item{selectedCount === 1 ? "" : "s"}</span>
          <button className="fo-modal-close" onClick={close}>✕</button>
        </div>
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          {bulkEddError && <div style={{ padding: "10px 12px", borderRadius: "6px", background: "#fee2e2", border: "1px solid #fecaca", color: "#991b1b", fontSize: "13px" }}>{bulkEddError}</div>}
          <div style={{ fontSize: "12px", color: "#6b7280" }}>
            Applies the new EDD to all {selectedCount} selected line item{selectedCount === 1 ? "" : "s"} on this view.
          </div>
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "#374151", marginBottom: "6px" }}>New EDD</label>
            <input type="date" value={bulkEddForm.newEdd} onChange={(e) => setBulkEddForm((p) => ({ ...p, newEdd: e.target.value }))}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: "8px", background: "#fff", color: "#111827", fontSize: "13px", outline: "none" }} />
          </div>
          {bulkProgress && (
            <div style={{ fontSize: "13px", color: "#2563eb", fontWeight: 600 }}>
              Updating {bulkProgress.done} / {bulkProgress.total}…
            </div>
          )}
        </div>
        <div style={{ padding: "12px 20px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button className="fo-btn-ghost" onClick={close} disabled={isBulkSavingEdd}>Cancel</button>
          <button type="button" style={{ padding: "8px 20px", fontSize: "13px", fontWeight: 600, borderRadius: "6px", background: "#2563eb", color: "#fff", border: "none", cursor: isBulkSavingEdd ? "wait" : "pointer" }}
            onClick={onSave} disabled={isBulkSavingEdd}>
            {isBulkSavingEdd ? "Updating…" : `Update ${selectedCount} EDD`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Note Modal ──────────────────────────────────────────────────────────────

type NoteModalProps = {
  target: { order: FreightOrderRow; item: FreightLineItem };
  noteTab: string;
  noteText: string;
  sendToMonday: boolean;
  sendToCin7: boolean;
  isSavingNote: boolean;
  noteAuthor: string;
  setNoteTab: (v: string) => void;
  setNoteText: (v: string) => void;
  setSendToMonday: (v: boolean) => void;
  setSendToCin7: (v: boolean) => void;
  setNoteModal: (v: boolean) => void;
  setNoteModalTarget: (v: null) => void;
  onSave: (text: string, tab: string, pushMonday: boolean, pushCin7: boolean) => void;
};

export function NoteModal({ target, noteTab, noteText, sendToMonday, sendToCin7, isSavingNote, noteAuthor, setNoteTab, setNoteText, setSendToMonday, setSendToCin7, setNoteModal, setNoteModalTarget, onSave }: NoteModalProps) {
  const close = () => { setNoteModal(false); setNoteModalTarget(null); };
  return (
    <div className="fo-overlay" onClick={close}>
      <div className="fo-modal" style={{ width: "min(560px, 95vw)" }} onClick={(e) => e.stopPropagation()}>
        <div className="fo-modal-hdr">
          <div className="fo-modal-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "6px" }}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Add note — <span style={{ fontWeight: 400, color: "#6b7280" }}>#{target.order.shopifyOrderName}{target.item.letterSuffix}</span>
          </div>
          <button className="fo-modal-close" onClick={close}>✕</button>
        </div>
        <div style={{ padding: "12px", background: "#f3f4f6", borderBottom: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#111827" }}>
            {target.item.title ?? `#${target.item.variantId}`}
            {target.item.variantId && <span style={{ fontWeight: 400, color: "#6b7280", marginLeft: "4px" }}>— VAR-{target.item.variantId.slice(-6)}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", padding: "12px", borderBottom: "1px solid #e5e7eb" }}>
          {(["internal", "customer"] as const).map((tab) => (
            <button key={tab} onClick={() => setNoteTab(tab)}
              style={{ padding: "5px 14px", fontSize: "12px", fontWeight: 600, borderRadius: "5px", border: "1px solid", borderColor: noteTab === tab ? "#1d4ed8" : "#e5e7eb", background: noteTab === tab ? "#eff6ff" : "#fff", color: noteTab === tab ? "#1d4ed8" : "#6b7280", cursor: "pointer" }}>
              {tab === "internal" ? "Internal note" : "Customer email"}
            </button>
          ))}
        </div>
        <div style={{ padding: "12px", background: "#fff" }}>
          <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
            placeholder={noteTab === "internal" ? "Write an internal note…" : "Write a message for the customer…"}
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: "8px", fontSize: "13px", outline: "none", fontFamily: "inherit", color: "#111827", resize: "vertical", minHeight: "100px" }}
            autoFocus />
        </div>
        <div style={{ padding: "0 12px 12px", background: "#fff" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#374151", cursor: "pointer" }}>
            <input type="checkbox" checked={sendToMonday} onChange={(e) => setSendToMonday(e.target.checked)} />
            Send this note to Monday.com (visible to Warehouse)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#374151", cursor: "pointer", marginTop: "8px" }}>
            <input type="checkbox" checked={sendToCin7} onChange={(e) => setSendToCin7(e.target.checked)} />
            Send this note to Cin7 (Internal Comments)
          </label>
        </div>
        <div style={{ display: "flex", gap: "8px", padding: "12px", borderTop: "1px solid #e5e7eb", justifyContent: "flex-end" }}>
          <button style={{ padding: "6px 16px", fontSize: "13px", fontWeight: 500, borderRadius: "6px", border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", cursor: "pointer" }}
            onClick={close}>Cancel</button>
          <button style={{ padding: "6px 16px", fontSize: "13px", fontWeight: 500, borderRadius: "6px", border: "none", background: "#2563eb", color: "#fff", cursor: "pointer", opacity: isSavingNote ? 0.8 : 1 }}
            onClick={() => { if (!noteText.trim() || isSavingNote) return; onSave(noteText.trim(), noteTab, sendToMonday, sendToCin7); }}
            disabled={isSavingNote}>
            {isSavingNote ? "Saving…" : "Save note"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Dispatch & Freight Edit Modal ───────────────────────────────────────────

type DispatchEditModalProps = {
  order: FreightOrderRow;
  item: FreightLineItem;
  form: { eddDate: string; carrier: string; trackingNumber: string; freightRef: string };
  error: string;
  isSaving: boolean;
  setForm: React.Dispatch<React.SetStateAction<{ eddDate: string; carrier: string; trackingNumber: string; freightRef: string }>>;
  onClose: () => void;
  onSave: () => void;
};

export function DispatchEditModal({ order, item, form, error, isSaving, setForm, onClose, onSave }: DispatchEditModalProps) {
  return (
    <div className="fo-overlay" onClick={onClose}>
      <div className="fo-modal" style={{ width: "520px", maxWidth: "95vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="fo-modal-hdr" style={{ borderBottom: "1px solid #e5e7eb", padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "16px" }}>📦</span>
            <span className="fo-modal-title" style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>
              Edit Dispatch &amp; Freight — <span style={{ color: "#2563eb" }}>{order.shopifyOrderName}</span>{item.letterSuffix}
            </span>
          </div>
          <button className="fo-modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: "12px 20px", borderBottom: "1px solid #e5e7eb" }}>
          <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "6px", padding: "10px 14px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>{item.title ?? `#${item.variantId}`}</div>
            {item.variantId && <div style={{ fontSize: "12px", color: "#475569", marginTop: "2px" }}>VAR-{item.variantId.slice(-6)}</div>}
          </div>
        </div>
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          {error && <div style={{ padding: "10px 12px", borderRadius: "6px", background: "#fee2e2", border: "1px solid #fecaca", color: "#991b1b", fontSize: "13px" }}>{error}</div>}
          <div>
            <label className="fo-field-label" htmlFor="de-edd">Current EDD</label>
            <input id="de-edd" type="date" className="fo-input" value={form.eddDate} onChange={(e) => setForm((p) => ({ ...p, eddDate: e.target.value }))} />
          </div>
          <div>
            <label className="fo-field-label" htmlFor="de-carrier">Carrier</label>
            <div style={{ position: "relative" }}>
              <select id="de-carrier" className="fo-input" style={{ appearance: "none", WebkitAppearance: "none", paddingRight: "36px", cursor: "pointer" }}
                value={form.carrier} onChange={(e) => setForm((p) => ({ ...p, carrier: e.target.value }))}>
                <option value="">Select carrier...</option>
                <option value="MAINFREIGHT">Mainfreight</option><option value="NZP">NZ Post</option>
                <option value="TGE">Team Global Express</option><option value="FLIWAY">Fliway</option>
                <option value="CASTLE">Castle</option><option value="M2H">M2H</option>
              </select>
              <svg style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#6b7280" }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
            </div>
          </div>
          <div>
            <label className="fo-field-label" htmlFor="de-tracking">Tracking number</label>
            <input id="de-tracking" className="fo-input" placeholder="e.g. MF8821003" value={form.trackingNumber} onChange={(e) => setForm((p) => ({ ...p, trackingNumber: e.target.value }))} />
          </div>
          <div>
            <label className="fo-field-label" htmlFor="de-ref">Freight / consignment reference</label>
            <input id="de-ref" className="fo-input" placeholder="Optional" value={form.freightRef} onChange={(e) => setForm((p) => ({ ...p, freightRef: e.target.value }))} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 14px", borderRadius: "8px", background: "#f0fdf4", border: "1px solid #bbf7d0", fontSize: "12px", color: "#166534" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
            Changes auto-sync to Shopify, Monday &amp; Cin7
          </div>
        </div>
        <div className="fo-modal-ftr" style={{ padding: "12px 20px" }}>
          <button className="fo-btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" style={{ padding: "8px 20px", fontSize: "13px", fontWeight: 600, borderRadius: "6px", background: "#2563eb", color: "#fff", border: "none", cursor: isSaving ? "wait" : "pointer" }}
            onClick={onSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save & sync"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Operational Edit Modal ──────────────────────────────────────────────────

type OpsEditModalProps = {
  order: FreightOrderRow;
  item: FreightLineItem;
  form: { warehouseStatus: string; warehouseTags: string; dispatchStatus: string; deliveryStatus: string; poNumber: string; depositPaid: string; balanceDue: string; paymentStatus: string; supplierContainer: string; receivedDate: string; portArrivalDate: string; inTransitDate: string };
  error: string;
  isSaving: boolean;
  setForm: React.Dispatch<React.SetStateAction<{ warehouseStatus: string; warehouseTags: string; dispatchStatus: string; deliveryStatus: string; poNumber: string; depositPaid: string; balanceDue: string; paymentStatus: string; supplierContainer: string; receivedDate: string; portArrivalDate: string; inTransitDate: string }>>;
  onClose: () => void;
  onSave: () => void;
};

export function OpsEditModal({ order, item, form, error, isSaving, setForm, onClose, onSave }: OpsEditModalProps) {
  return (
    <div className="fo-overlay" onClick={onClose}>
      <div className="fo-modal" style={{ width: "520px", maxWidth: "95vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="fo-modal-hdr" style={{ borderBottom: "1px solid #e5e7eb", padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "16px" }}>⚙️</span>
            <span className="fo-modal-title" style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>
              Edit Operational — <span style={{ color: "#2563eb" }}>{order.shopifyOrderName}</span>{item.letterSuffix}
            </span>
          </div>
          <button className="fo-modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          {error && <div style={{ padding: "10px 12px", borderRadius: "6px", background: "#fee2e2", border: "1px solid #fecaca", color: "#991b1b", fontSize: "13px" }}>{error}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label className="fo-field-label" htmlFor="ops-warehouse">Warehouse status</label>
              <input id="ops-warehouse" className="fo-input" placeholder="e.g. Picking" value={form.warehouseStatus} onChange={(e) => setForm((p) => ({ ...p, warehouseStatus: e.target.value }))} />
            </div>
            <div>
              <label className="fo-field-label" htmlFor="ops-received">Received</label>
              <input id="ops-received" type="date" className="fo-input" value={form.receivedDate} onChange={(e) => setForm((p) => ({ ...p, receivedDate: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="fo-field-label" htmlFor="ops-warehouse-tags">Warehouse tags</label>
            <input id="ops-warehouse-tags" className="fo-input" placeholder="e.g. Fragile, Oversized" value={form.warehouseTags} onChange={(e) => setForm((p) => ({ ...p, warehouseTags: e.target.value }))} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label className="fo-field-label" htmlFor="ops-dispatch">Dispatch status</label>
              <input id="ops-dispatch" className="fo-input" placeholder="e.g. Scheduled" value={form.dispatchStatus} onChange={(e) => setForm((p) => ({ ...p, dispatchStatus: e.target.value }))} />
            </div>
            <div>
              <label className="fo-field-label" htmlFor="ops-delivery">Delivery status</label>
              <input id="ops-delivery" className="fo-input" placeholder="e.g. In transit" value={form.deliveryStatus} onChange={(e) => setForm((p) => ({ ...p, deliveryStatus: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="fo-field-label" htmlFor="ops-po">PO #</label>
            <input id="ops-po" className="fo-input" placeholder="Purchase order number" value={form.poNumber} onChange={(e) => setForm((p) => ({ ...p, poNumber: e.target.value }))} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label className="fo-field-label" htmlFor="ops-port-arrival">Port arrival</label>
              <input id="ops-port-arrival" type="date" className="fo-input" value={form.portArrivalDate} onChange={(e) => setForm((p) => ({ ...p, portArrivalDate: e.target.value }))} />
            </div>
            <div>
              <label className="fo-field-label" htmlFor="ops-in-transit">In transit date</label>
              <input id="ops-in-transit" type="date" className="fo-input" value={form.inTransitDate} onChange={(e) => setForm((p) => ({ ...p, inTransitDate: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="fo-field-label" htmlFor="ops-supplier">Supplier / Container</label>
            <input id="ops-supplier" className="fo-input" placeholder="e.g. Supplier / CONT123" value={form.supplierContainer} onChange={(e) => setForm((p) => ({ ...p, supplierContainer: e.target.value }))} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label className="fo-field-label" htmlFor="ops-deposit">Deposit paid</label>
              <input id="ops-deposit" className="fo-input" placeholder="$0.00" value={form.depositPaid} onChange={(e) => setForm((p) => ({ ...p, depositPaid: e.target.value }))} />
            </div>
            <div>
              <label className="fo-field-label" htmlFor="ops-balance">Balance due</label>
              <input id="ops-balance" className="fo-input" placeholder="$0.00" value={form.balanceDue} onChange={(e) => setForm((p) => ({ ...p, balanceDue: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="fo-field-label" htmlFor="ops-payment-status">Payment status</label>
            <select id="ops-payment-status" className="fo-input" value={form.paymentStatus} onChange={(e) => setForm((p) => ({ ...p, paymentStatus: e.target.value }))}>
              <option value="">—</option>
              <option value="Pending">Pending</option>
              <option value="Paid">Paid</option>
              <option value="Partial">Partial</option>
              <option value="Overdue">Overdue</option>
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 14px", borderRadius: "8px", background: "#f0fdf4", border: "1px solid #bbf7d0", fontSize: "12px", color: "#166534" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
            Changes auto-sync to Shopify, Monday &amp; Cin7
          </div>
        </div>
        <div className="fo-modal-ftr" style={{ padding: "12px 20px" }}>
          <button className="fo-btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" style={{ padding: "8px 20px", fontSize: "13px", fontWeight: 600, borderRadius: "6px", background: "#2563eb", color: "#fff", border: "none", cursor: isSaving ? "wait" : "pointer" }}
            onClick={onSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save & sync"}
          </button>
        </div>
      </div>
    </div>
  );
}
