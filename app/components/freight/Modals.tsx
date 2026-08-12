/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import type { FreightOrderRow, FreightLineItem } from "./types";
import { companyLabels, getCarrierLabel } from "../../lib/freight";
import {
  CUSTOMER_STATUS_OPTIONS,
  WAREHOUSE_STATUS_OPTIONS,
  DISPATCH_STATUS_OPTIONS,
  DELIVERY_STATUS_OPTIONS,
  PAYMENT_STATUS_OPTIONS,
  optionsWithCurrent,
} from "../../lib/status-options";
import "../../styles/freight-orders.css";

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
          {tm.item.company ? (
            <div style={{ fontSize: "13px", color: "#475569" }}>
              Carrier: <strong style={{ color: "#2563eb" }}>{getCarrierLabel(tm.item.company, Boolean(tm.item.depotAddress1 || tm.item.depotCity || tm.item.depotZip)) ?? tm.item.company}</strong>
              <span style={{ display: "block", fontSize: "11px", marginTop: "4px" }}>Set at checkout — not editable here</span>
            </div>
          ) : null}
          {/* Carrier edit — future phase
          <div>
            <label className="fo-field-label" htmlFor="t-carrier">Carrier</label>
            ...
          </div>
          */}
          <div>
            <label className="fo-field-label" htmlFor="t-num">Tracking number</label>
            <input id="t-num" className="fo-input" placeholder="e.g. MF8821003" value={trackingForm.trackingNumber} onChange={(e) => setTrackingForm((p) => ({ ...p, trackingNumber: e.target.value }))} />
          </div>
          <div>
            <label className="fo-field-label" htmlFor="t-ref">Freight / consignment reference</label>
            <input id="t-ref" className="fo-input" placeholder="Optional" value={trackingForm.freightRef} onChange={(e) => setTrackingForm((p) => ({ ...p, freightRef: e.target.value }))} />
          </div>
          {/* Delivery method edit — future phase */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "14px 16px", borderRadius: "8px", background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827" }}>Queue customer email</div>
              <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "3px" }}>Adds to email queue (cron sends) — {tm.order.email}</div>
            </div>
            <button type="button" onClick={() => setTrackingForm((p) => ({ ...p, notifyCustomer: !p.notifyCustomer }))}
              style={{ flexShrink: 0, width: "44px", height: "24px", borderRadius: "12px", background: trackingForm.notifyCustomer ? "#2563eb" : "#d1d5db", border: "none", cursor: "pointer", position: "relative", transition: "background 0.2s" }}>
              <span style={{ position: "absolute", top: "2px", left: trackingForm.notifyCustomer ? "22px" : "2px", width: "20px", height: "20px", borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
            </button>
          </div>
        </div>
        <div className="fo-modal-ftr" style={{ padding: "12px 20px" }}>
          <button className="fo-btn-ghost" onClick={close}>Cancel</button>
          <button type="button" style={{ padding: "8px 20px", fontSize: "13px", fontWeight: 600, borderRadius: "6px", background: "#2563eb", color: "#fff", border: "none", cursor: isSavingTracking ? "wait" : "pointer" }}
            onClick={onSave} disabled={isSavingTracking}>
            {isSavingTracking ? "Saving..." : "Save & sync"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Bulk actions (EDD / notify / payment / supplier / notes) live in
// BulkActionsWorkspace.tsx — single workspace, not separate modals.
// ═══════════════════════════════════════════════════════════════════════════════

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
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827" }}>Queue customer email</div>
              <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "3px" }}>Adds to email queue (cron sends) — {em.order.email}</div>
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

// ─── Note Modal ──────────────────────────────────────────────────────────────

type NoteModalProps = {
  target: { order: FreightOrderRow; item: FreightLineItem };
  noteTab: string;
  noteText: string;
  noteSubject: string;
  sendToMonday: boolean;
  sendToCin7: boolean;
  sendToShopify: boolean;
  isSavingNote: boolean;
  noteAuthor: string;
  setNoteTab: (v: string) => void;
  setNoteText: (v: string) => void;
  setNoteSubject: (v: string) => void;
  setSendToMonday: (v: boolean) => void;
  setSendToCin7: (v: boolean) => void;
  setSendToShopify: (v: boolean) => void;
  setNoteModal: (v: boolean) => void;
  setNoteModalTarget: (v: null) => void;
  onSave: (payload: {
    text: string;
    tab: string;
    subject: string;
    pushMonday: boolean;
    pushCin7: boolean;
    pushShopify: boolean;
  }) => void;
};

export function NoteModal({
  target, noteTab, noteText, noteSubject, sendToMonday, sendToCin7, sendToShopify, isSavingNote, noteAuthor,
  setNoteTab, setNoteText, setNoteSubject, setSendToMonday, setSendToCin7, setSendToShopify, setNoteModal, setNoteModalTarget, onSave,
}: NoteModalProps) {
  const close = () => { setNoteModal(false); setNoteModalTarget(null); };
  const isEmail = noteTab === "customer";
  const defaultSubject = `Update on your order ${target.order.shopifyOrderName}`;
  const canSubmit = noteText.trim() && !isSavingNote;

  return (
    <div className="fo-overlay" onClick={close}>
      <div className="fo-modal" style={{ width: "min(560px, 95vw)" }} onClick={(e) => e.stopPropagation()}>
        <div className="fo-modal-hdr">
          <div className="fo-modal-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "6px" }}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {isEmail ? "Queue customer email" : "Add note"} — <span style={{ fontWeight: 400, color: "#6b7280" }}>#{target.order.shopifyOrderName}{target.item.letterSuffix}</span>
          </div>
          <button className="fo-modal-close" onClick={close}>✕</button>
        </div>
        <div style={{ padding: "12px", background: "#f3f4f6", borderBottom: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#111827" }}>
            {target.item.title ?? `#${target.item.variantId}`}
            {target.item.variantId && <span style={{ fontWeight: 400, color: "#6b7280", marginLeft: "4px" }}>— VAR-{target.item.variantId.slice(-6)}</span>}
          </div>
          {isEmail ? (
            <div style={{ fontSize: "11px", color: "#6b7280", marginTop: 4 }}>
              To: {target.order.email || "—"} · Saved to email queue · Cron sends later
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: "8px", padding: "12px", borderBottom: "1px solid #e5e7eb" }}>
          {(["internal", "customer"] as const).map((tab) => (
            <button key={tab} onClick={() => setNoteTab(tab)}
              style={{ padding: "5px 14px", fontSize: "12px", fontWeight: 600, borderRadius: "5px", border: "1px solid", borderColor: noteTab === tab ? "#1d4ed8" : "#e5e7eb", background: noteTab === tab ? "#eff6ff" : "#fff", color: noteTab === tab ? "#1d4ed8" : "#6b7280", cursor: "pointer" }}>
              {tab === "internal" ? "Internal note" : "Customer email"}
            </button>
          ))}
        </div>
        <div style={{ padding: "12px", background: "#fff", display: "flex", flexDirection: "column", gap: "10px" }}>
          {isEmail ? (
            <div>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>Subject (email header)</label>
              <input
                value={noteSubject}
                onChange={(e) => setNoteSubject(e.target.value)}
                placeholder={defaultSubject}
                style={{ width: "100%", padding: "8px 12px", border: "1px solid #e5e7eb", borderRadius: "8px", fontSize: "13px", outline: "none", fontFamily: "inherit", color: "#111827" }}
              />
            </div>
          ) : null}
          <div>
            {isEmail ? (
              <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>Body</label>
            ) : null}
            <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
              placeholder={isEmail ? "Write the email body… Use {name}, {order}, {edd}, {tracking}" : "Write an internal note…"}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: "8px", fontSize: "13px", outline: "none", fontFamily: "inherit", color: "#111827", resize: "vertical", minHeight: "100px" }}
              autoFocus />
          </div>
        </div>
        {!isEmail ? (
          <div style={{ padding: "0 12px 12px", background: "#fff", display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#374151", cursor: "pointer" }}>
              <input type="checkbox" checked={sendToMonday} onChange={(e) => setSendToMonday(e.target.checked)} />
              Send to Monday.com
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#9ca3af", cursor: "not-allowed" }}>
              <input type="checkbox" checked={sendToCin7} disabled onChange={(e) => setSendToCin7(e.target.checked)} />
              Send to Cin7 <span style={{ fontSize: "10px", fontWeight: 700, background: "#f3f4f6", padding: "1px 6px", borderRadius: "999px" }}>Coming Soon</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#374151", cursor: "pointer" }}>
              <input type="checkbox" checked={sendToShopify} onChange={(e) => setSendToShopify(e.target.checked)} />
              Add to Shopify order timeline
            </label>
          </div>
        ) : (
          <div style={{ padding: "0 12px 12px", fontSize: "11px", color: "#6b7280", background: "#fff" }}>
            Saves one BulkEmailJob + BulkEmailRecipient row and a pending Activity Log entry.
            Cron reads subject + body from that job and sends — nothing is emailed on this click.
          </div>
        )}
        <div style={{ display: "flex", gap: "8px", padding: "12px", borderTop: "1px solid #e5e7eb", justifyContent: "flex-end" }}>
          <button style={{ padding: "6px 16px", fontSize: "13px", fontWeight: 500, borderRadius: "6px", border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", cursor: "pointer" }}
            onClick={close}>Cancel</button>
          <button style={{ padding: "6px 16px", fontSize: "13px", fontWeight: 500, borderRadius: "6px", border: "none", background: "#2563eb", color: "#fff", cursor: "pointer", opacity: canSubmit ? 1 : 0.8 }}
            onClick={() => {
              if (!canSubmit) return;
              onSave({
                text: noteText.trim(),
                tab: noteTab,
                subject: (noteSubject.trim() || defaultSubject),
                pushMonday: isEmail ? false : sendToMonday,
                pushCin7: isEmail ? false : sendToCin7,
                pushShopify: isEmail ? false : sendToShopify,
              });
            }}
            disabled={!canSubmit}>
            {isSavingNote ? (isEmail ? "Queuing…" : "Saving…") : isEmail ? "Queue email" : "Save note"}
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
              Edit Tracking &amp; Freight ref — <span style={{ color: "#2563eb" }}>{order.shopifyOrderName}</span>{item.letterSuffix}
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
          {item.company ? (
            <div style={{ fontSize: "13px", color: "#475569" }}>
              Carrier: <strong style={{ color: "#2563eb" }}>{getCarrierLabel(item.company, Boolean(item.depotAddress1 || item.depotCity || item.depotZip)) ?? item.company}</strong>
            </div>
          ) : null}
          {/* EDD + carrier edit — future phase */}
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

type OpsEditForm = {
  customerStatus: string;
  warehouseStatus: string;
  dispatchStatus: string;
  deliveryStatus: string;
  poNumber: string;
  depositPaid: string;
  balanceDue: string;
  paymentStatus: string;
  supplierContainer: string;
  receivedDate: string;
  portArrivalDate: string;
  inTransitDate: string;
};

type OpsEditModalProps = {
  order: FreightOrderRow;
  item: FreightLineItem;
  form: OpsEditForm;
  error: string;
  isSaving: boolean;
  setForm: React.Dispatch<React.SetStateAction<OpsEditForm>>;
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
              <label className="fo-field-label" htmlFor="ops-customer-status">Customer status</label>
              <select
                id="ops-customer-status"
                className="fo-input"
                value={form.customerStatus}
                onChange={(e) => setForm((p) => ({ ...p, customerStatus: e.target.value }))}
              >
                {optionsWithCurrent(CUSTOMER_STATUS_OPTIONS, form.customerStatus).map((o) => (
                  <option key={o.value || "__empty"} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="fo-field-label" htmlFor="ops-warehouse">Warehouse status</label>
              <select
                id="ops-warehouse"
                className="fo-input"
                value={form.warehouseStatus}
                onChange={(e) => setForm((p) => ({ ...p, warehouseStatus: e.target.value }))}
              >
                {optionsWithCurrent(WAREHOUSE_STATUS_OPTIONS, form.warehouseStatus).map((o) => (
                  <option key={o.value || "__empty"} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="fo-field-label" htmlFor="ops-received">Received</label>
            <input id="ops-received" type="date" className="fo-input" value={form.receivedDate} onChange={(e) => setForm((p) => ({ ...p, receivedDate: e.target.value }))} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label className="fo-field-label" htmlFor="ops-dispatch">Dispatch status</label>
              <select
                id="ops-dispatch"
                className="fo-input"
                value={form.dispatchStatus}
                onChange={(e) => setForm((p) => ({ ...p, dispatchStatus: e.target.value }))}
              >
                {optionsWithCurrent(DISPATCH_STATUS_OPTIONS, form.dispatchStatus).map((o) => (
                  <option key={o.value || "__empty"} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="fo-field-label" htmlFor="ops-delivery">Delivery status</label>
              <select
                id="ops-delivery"
                className="fo-input"
                value={form.deliveryStatus}
                onChange={(e) => setForm((p) => ({ ...p, deliveryStatus: e.target.value }))}
              >
                {optionsWithCurrent(DELIVERY_STATUS_OPTIONS, form.deliveryStatus).map((o) => (
                  <option key={o.value || "__empty"} value={o.value}>{o.label}</option>
                ))}
              </select>
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
              {optionsWithCurrent(PAYMENT_STATUS_OPTIONS, form.paymentStatus).map((o) => (
                <option key={o.value || "__empty"} value={o.value}>{o.label}</option>
              ))}
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

// ─── Order Amendment Modal (contact / address / instructions / cancel) ───────

export type AmendDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  zip: string;
  country: string;
  deliveryInstructions: string;
};

type AmendOrderModalProps = {
  orderName: string;
  variantId: string;
  form: AmendDraft;
  error: string;
  isSaving: boolean;
  setForm: React.Dispatch<React.SetStateAction<AmendDraft>>;
  onClose: () => void;
  onSave: (opts: { cancelLineItem?: boolean; cancelOrder?: boolean }) => void;
};

export function AmendOrderModal({
  orderName,
  form,
  error,
  isSaving,
  setForm,
  onClose,
  onSave,
}: AmendOrderModalProps) {
  const set = (key: keyof AmendDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [key]: e.target.value }));

  return (
    <div className="fo-amend-overlay" role="dialog" aria-modal="true" aria-labelledby="fo-amend-title">
      <div className="fo-amend-screen" onClick={(e) => e.stopPropagation()}>
        <header className="fo-amend-hdr">
          <div>
            <div id="fo-amend-title" className="fo-amend-title">Amend order</div>
            <div className="fo-amend-sub">{orderName} · syncs to Shopify &amp; Monday · audit logged</div>
          </div>
          <button type="button" className="fo-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {error ? <div className="fo-amend-error">{error}</div> : null}

        <div className="fo-amend-grid">
          <section className="fo-amend-card">
            <h3 className="fo-amend-card-title">Contact</h3>
            <div className="fo-amend-fields">
              <div className="fo-amend-row-2">
                <div>
                  <label className="fo-field-label">First name</label>
                  <input className="fo-input" value={form.firstName} onChange={set("firstName")} />
                </div>
                <div>
                  <label className="fo-field-label">Last name</label>
                  <input className="fo-input" value={form.lastName} onChange={set("lastName")} />
                </div>
              </div>
              <div>
                <label className="fo-field-label">Email</label>
                <input className="fo-input" type="email" value={form.email} onChange={set("email")} />
              </div>
              <div>
                <label className="fo-field-label">Phone</label>
                <input className="fo-input" value={form.phone} onChange={set("phone")} />
              </div>
            </div>
          </section>

          <section className="fo-amend-card">
            <h3 className="fo-amend-card-title">Delivery address</h3>
            <div className="fo-amend-fields">
              <div>
                <label className="fo-field-label">Address line 1</label>
                <input className="fo-input" value={form.address1} onChange={set("address1")} />
              </div>
              <div>
                <label className="fo-field-label">Address line 2</label>
                <input className="fo-input" value={form.address2} onChange={set("address2")} />
              </div>
              <div className="fo-amend-row-2">
                <div>
                  <label className="fo-field-label">City</label>
                  <input className="fo-input" value={form.city} onChange={set("city")} />
                </div>
                <div>
                  <label className="fo-field-label">Province / region</label>
                  <input className="fo-input" value={form.province} onChange={set("province")} />
                </div>
              </div>
              <div className="fo-amend-row-2">
                <div>
                  <label className="fo-field-label">Postcode</label>
                  <input className="fo-input" value={form.zip} onChange={set("zip")} />
                </div>
                <div>
                  <label className="fo-field-label">Country</label>
                  <input className="fo-input" value={form.country} onChange={set("country")} />
                </div>
              </div>
            </div>
          </section>

          <section className="fo-amend-card fo-amend-card-side">
            <h3 className="fo-amend-card-title">Instructions</h3>
            <textarea
              className="fo-input fo-amend-instructions"
              value={form.deliveryInstructions}
              onChange={set("deliveryInstructions")}
              placeholder="Gate code, leave with neighbour…"
            />
            <h3 className="fo-amend-card-title" style={{ marginTop: 12 }}>Cancel</h3>
            <div className="fo-amend-cancel-stack">
              <button
                type="button"
                className="fo-amend-cancel-btn"
                disabled={isSaving}
                onClick={() => onSave({ cancelLineItem: true })}
              >
                Cancel this line item
              </button>
              <button
                type="button"
                className="fo-amend-cancel-btn fo-amend-cancel-btn-order"
                disabled={isSaving}
                onClick={() => onSave({ cancelOrder: true })}
              >
                Cancel entire order
              </button>
            </div>
          </section>
        </div>

        <footer className="fo-amend-ftr">
          <button type="button" className="fo-btn-ghost" onClick={onClose} disabled={isSaving}>Close</button>
          <button
            type="button"
            className="fo-amend-save"
            onClick={() => onSave({})}
            disabled={isSaving}
          >
            {isSaving ? "Saving…" : "Save & sync"}
          </button>
        </footer>
      </div>
    </div>
  );
}
