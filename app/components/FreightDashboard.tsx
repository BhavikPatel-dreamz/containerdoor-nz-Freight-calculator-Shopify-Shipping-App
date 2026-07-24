/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router";
import "../styles/freight-orders.css";

// Re-export types for backward compat
export type { FreightLineItem, FreightOrderRow, NoteItem, DashboardCounts, FreightDashboardProps } from "./freight/types";
import type { FreightLineItem, FreightOrderRow, NoteItem, FreightDashboardProps } from "./freight/types";

import { dedupeOrders, getCustomerStatusStyle, parseNotesString, serializeNotes, formatNoteDateTime, getRefPrefix } from "./freight/helpers";
import { IconCalendar } from "./freight/icons";
import { DetailPanels } from "./freight/DetailPanels";
import { NotesPanel } from "./freight/NotesPanel";
import { OrderTable } from "./freight/OrderTable";
import { TrackingModal, EddModal, BulkEddModal, NoteModal, DispatchEditModal, OpsEditModal } from "./freight/Modals";

const orderLetterColors = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];

export default function FreightDashboard({
  orders,
  allOrders,
  counts,
  suppliers = [],
  page,
  pageCount,
  shop,
  navbarRight,
  noteAuthor = "SP",
  initialDetailOrderId,
  initialDetailVariantId,
  detailBackHref,
}: FreightDashboardProps) {
  const [rows, setRows] = useState<FreightOrderRow[]>(orders);
  const [allRows, setAllRows] = useState<FreightOrderRow[] | null>(allOrders ?? null);
  useEffect(() => setRows(orders), [orders]);
  useEffect(() => { if (allOrders) setAllRows(allOrders); }, [allOrders]);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [currentPage, setCurrentPage] = useState<number>(page ?? 1);
  useEffect(() => { setCurrentPage(page ?? 1); }, [page]);

  const [detailView, setDetailView] = useState<{ order: FreightOrderRow; item: FreightLineItem } | null>(null);
  const [trackingModal, setTrackingModal] = useState<{ order: FreightOrderRow; item: FreightLineItem } | null>(null);
  const [eddModal, setEddModal] = useState<{ order: FreightOrderRow; item: FreightLineItem } | null>(null);
  const [noteModalTarget, setNoteModalTarget] = useState<{ order: FreightOrderRow; item: FreightLineItem } | null>(null);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [noteModal, setNoteModal] = useState(false);
  const [noteTab, setNoteTab] = useState("internal");
  const [noteText, setNoteText] = useState("");
  const [sendToMonday, setSendToMonday] = useState(false);
  const [sendToCin7, setSendToCin7] = useState(false);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [isSavingEdd, setIsSavingEdd] = useState(false);
  const [notesFetching, setNotesFetching] = useState(false);
  const [isSavingTracking, setIsSavingTracking] = useState(false);

  const [editDispatchModal, setEditDispatchModal] = useState(false);
  const [editOpsModal, setEditOpsModal] = useState(false);
  const [editDispatchForm, setEditDispatchForm] = useState({ eddDate: "", carrier: "", trackingNumber: "", freightRef: "" });
  const [editOpsForm, setEditOpsForm] = useState({ warehouseStatus: "", dispatchStatus: "", deliveryStatus: "", poNumber: "", depositPaid: "", balanceDue: "" });
  const [isSavingDispatch, setIsSavingDispatch] = useState(false);
  const [isSavingOps, setIsSavingOps] = useState(false);
  const [editDispatchError, setEditDispatchError] = useState("");
  const [editOpsError, setEditOpsError] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncNotification, setSyncNotification] = useState<string | null>(null);
  const [creatingCin7OrderId, setCreatingCin7OrderId] = useState<string | null>(null);
  const [cin7FixingId, setCin7FixingId] = useState<string | null>(null);
  const [mondayFixingId, setMondayFixingId] = useState<string | null>(null);
  const [isRefreshingCin7, setIsRefreshingCin7] = useState(false);
  const [isRefreshingMonday, setIsRefreshingMonday] = useState(false);
  const [allowStatusPoll] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const toggleColumn = (key: string) => setHiddenColumns((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  useEffect(() => {
    if (!initialDetailOrderId) return;
    const source = allRows ?? rows;
    const order = source.find((o) => o.shopifyOrderId === initialDetailOrderId);
    if (!order) return;
    const item = order.lineItems.find((li) => li.variantId === initialDetailVariantId) ?? order.lineItems[0];
    if (!item) return;
    setDetailView((prev) => (prev ? prev : { order, item }));
    setNotes([]);
  }, [initialDetailOrderId, initialDetailVariantId, rows, allRows]);

  const [eddError, setEddError] = useState("");
  const [trackingError, setTrackingError] = useState("");
  const [trackingForm, setTrackingForm] = useState({ carrier: "", trackingNumber: "", freightRef: "", deliveryMethod: "Standard", notifyCustomer: true });
  const [eddForm, setEddForm] = useState({ newEdd: "", reason: "", notifyCustomer: false });
  const serverDriven = Boolean(counts);
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") ?? "all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!serverDriven) return;
    const current = searchParams.get("q") ?? "";
    if (search === current) return;
    const t = setTimeout(() => {
      setSearchParams((prev) => {
        const np = new URLSearchParams(prev);
        if (search) np.set("q", search); else np.delete("q");
        np.set("page", "1");
        return np;
      }, { replace: true });
    }, 350);
    return () => clearTimeout(t);
  }, [search, serverDriven]);

  const setTab = (key: string) => {
    setActiveTab(key);
    if (!serverDriven) return;
    setSearchParams((prev) => {
      const np = new URLSearchParams(prev);
      if (key === "all") np.delete("tab"); else np.set("tab", key);
      np.set("page", "1");
      return np;
    });
  };

  const activeSupplier = searchParams.get("supplier") ?? "";
  const setSupplier = (v: string) =>
    setSearchParams((prev) => {
      const np = new URLSearchParams(prev);
      if (v) np.set("supplier", v); else np.delete("supplier");
      np.set("page", "1");
      return np;
    });

  const [bulkEddModal, setBulkEddModal] = useState(false);
  const [bulkEddForm, setBulkEddForm] = useState({ newEdd: "", notifyCustomer: false });
  const [bulkEddError, setBulkEddError] = useState("");
  const [isBulkSavingEdd, setIsBulkSavingEdd] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const activeNoteTarget = detailView ?? noteModalTarget;

  // ── Fetch notes whenever a modal that shows notes opens ──
  useEffect(() => {
    const target = detailView ?? noteModalTarget ?? eddModal ?? trackingModal;
    if (!target) return;
    const fetchNotes = async () => {
      setNotesFetching(true);
      try {
        const res = await fetch(`/api/order-status?orderId=${encodeURIComponent(target.order.shopifyOrderId)}&shop=${encodeURIComponent(shop)}`);
        if (!res.ok) return;
        const json = await res.json();
        const line = (json.lineItems ?? []).find((item: any) => item.variantId === target.item.variantId);
        setNotes(parseNotesString(line?.notes ?? ""));
      } catch (e) { console.error("Failed to load notes", e); } finally { setNotesFetching(false); }
    };
    fetchNotes();
  }, [detailView, noteModalTarget, eddModal, trackingModal]);

  useEffect(() => {
    if (!allowStatusPoll) return;
    if (!rows || rows.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/cin7-status", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop, orders: dedupeOrders(rows).map((order) => ({ orderId: order.shopifyOrderId, lineItems: order.lineItems.map((li) => ({ variantId: li.variantId, trackingNumber: li.trackingNumber, eddDate: li.eddDate, company: li.company })) })) }),
        });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const ordersResult: Record<string, { results: any[] }> = json.orders ?? {};
        setRows((prev) => prev.map((o) => {
          const result = ordersResult[o.shopifyOrderId]?.results;
          if (!result) return o;
          return { ...o, lineItems: o.lineItems.map((li) => { const m = result.find((r: any) => r.variantId === li.variantId); return m ? { ...li, cin7Status: m.status, cin7Mismatches: m.mismatches } : li; }) };
        }));
      } catch (e) { console.error("Failed to fetch Cin7 status", e); }
    })();
    return () => { cancelled = true; };
  }, [allowStatusPoll, rows.map((o) => o.id).join(","), shop]);

  useEffect(() => {
    if (!allowStatusPoll) return;
    if (!rows || rows.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/monday-status", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop, orders: dedupeOrders(rows).map((order) => ({ orderId: order.shopifyOrderId, lineItems: order.lineItems.map((li) => ({ variantId: li.variantId })) })) }),
        });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const ordersResult: Record<string, { results: any[] }> = json.orders ?? {};
        setRows((prev) => prev.map((o) => {
          const result = ordersResult[o.shopifyOrderId]?.results;
          if (!result) return o;
          return { ...o, lineItems: o.lineItems.map((li) => { const m = result.find((r: any) => r.variantId === li.variantId); return m ? { ...li, mondayStatus: m.status, mondayMismatches: m.mismatches } : li; }) };
        }));
      } catch (e) { console.error("Failed to fetch Monday status", e); }
    })();
    return () => { cancelled = true; };
  }, [allowStatusPoll, rows.map((o) => o.id).join(","), shop]);

  // ── Polling for field changes pushed via webhook ──
  useEffect(() => {
    if (!rows || rows.length === 0) return;
    let cancelled = false;
    const pollFieldUpdates = async () => {
      try {
        const results = await Promise.all(dedupeOrders(rows).map(async (order) => {
          try {
            const res = await fetch(`/api/order-status?orderId=${encodeURIComponent(order.shopifyOrderId)}&shop=${encodeURIComponent(shop)}`);
            if (!res.ok) return null;
            const json = await res.json();
            return { orderId: order.shopifyOrderId, lineItems: json.lineItems ?? [] };
          } catch { return null; }
        }));
        if (cancelled) return;
        const byOrder: Record<string, any[]> = {};
        for (const r of results) { if (r) byOrder[r.orderId] = r.lineItems; }
        if (Object.keys(byOrder).length === 0) return;
        const applyLatest = (o: FreightOrderRow): FreightOrderRow => {
          const updates = byOrder[o.shopifyOrderId];
          if (!updates) return o;
          return { ...o, lineItems: o.lineItems.map((li) => {
            const match = updates.find((u: any) => u.variantId === li.variantId);
            if (!match) return li;
            return { ...li, eddDate: match.eddDate || li.eddDate, originalEddDate: match.originalEddDate || li.originalEddDate, trackingNumber: match.trackingNumber || li.trackingNumber, freightRef: match.freightRef || li.freightRef, customerStatus: match.customerStatus || li.customerStatus, company: match.carrier || li.company };
          }) };
        };
        setRows((prev) => prev.map(applyLatest));
        if (allRows) setAllRows((prev) => (prev ? prev.map(applyLatest) : prev));
        setDetailView((prev) => {
          if (!prev) return prev;
          const updates = byOrder[prev.order.shopifyOrderId];
          const match = updates?.find((u: any) => u.variantId === prev.item.variantId);
          if (!match) return prev;
          return { ...prev, item: { ...prev.item, eddDate: match.eddDate || prev.item.eddDate, originalEddDate: match.originalEddDate || prev.item.originalEddDate, trackingNumber: match.trackingNumber || prev.item.trackingNumber, freightRef: match.freightRef || prev.item.freightRef, customerStatus: match.customerStatus || prev.item.customerStatus, company: match.carrier || prev.item.company } };
        });
      } catch (e) { console.error("Failed to poll line item field updates", e); }
    };
    const interval = setInterval(pollFieldUpdates, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [rows.map((o) => o.id).join(","), shop]);

  const baseFilteredOrders = serverDriven
    ? (rows || [])
    : (rows || []).filter((o) => {
        if (activeTab !== "all") {
          const hasMatch = o.lineItems.some((li) => {
            const s = (li.customerStatus || "").toLowerCase();
            if (activeTab === "awaiting") return s === "confirmed";
            if (activeTab === "dispatch") return s === "dispatched";
            if (activeTab === "complete") return s === "delivered";
            return true;
          });
          if (!hasMatch) return false;
        }
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          o.shopifyOrderName.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          o.email.toLowerCase().includes(q) ||
          (o.city ?? "").toLowerCase().includes(q) ||
          o.carriers.toLowerCase().includes(q)
        );
      });

  const filteredOrders = statusFilter
    ? baseFilteredOrders
        .map((o) => ({ ...o, lineItems: o.lineItems.filter((li) => (li.customerStatus || "").toLowerCase() === statusFilter) }))
        .filter((o) => o.lineItems.length > 0)
    : baseFilteredOrders;

  const selectableIds = filteredOrders.flatMap((o) => o.lineItems.map((li) => li.id));
  const toggleSelectAll = () => setSelected(selected.size === selectableIds.length && selectableIds.length > 0 ? new Set() : new Set(selectableIds));
  const toggleSelect = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const allLineItems = (rows || []).flatMap((o) => o.lineItems);
  const totalLineItems = counts?.totalLineItems ?? allLineItems.length;
  const awaitingCount = counts?.awaitingCount ?? allLineItems.filter((li) => (li.customerStatus || "").toLowerCase() === "confirmed").length;
  const dispatchedCount = counts?.dispatchedCount ?? allLineItems.filter((li) => (li.customerStatus || "").toLowerCase() === "dispatched").length;
  const pendingNotifyCount = counts?.pendingNotifyCount ?? allLineItems.filter((li) => !li.trackingNumber && (li.customerStatus || "").toLowerCase() === "dispatched").length;
  const completedCount = counts?.completedCount ?? allLineItems.filter((li) => (li.customerStatus || "").toLowerCase() === "delivered").length;

  const TABS = [
    { key: "all", label: "All orders", count: null, color: "#2563eb" },
    { key: "awaiting", label: "Awaiting dispatch", count: awaitingCount, color: "#d97706" },
    { key: "dispatch", label: "Dispatched", count: dispatchedCount, color: "#2563eb" },
    { key: "complete", label: "Completed", count: completedCount, color: "#6b7280" },
  ];

  // ── EDD save ──
  const handleEddSave = async () => {
    if (!eddModal || !eddForm.newEdd) { setEddError("Please select a date before saving"); return; }
    setEddError(""); setIsSavingEdd(true);
    const oldEdd = eddModal.item.eddDate;
    const newEdd = eddForm.newEdd;
    const fmt = (d: string) => new Date(d).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
    const systemNote: NoteItem = { author: "SY", role: "system", scheme: "system", time: formatNoteDateTime(), text: oldEdd ? `EDD changed from ${fmt(oldEdd)} to ${fmt(newEdd)}.` : `EDD set to ${fmt(newEdd)}.` };
    const nextNotes = [...notes, systemNote];
    setNotes(nextNotes);
    try {
      const response = await fetch("/api/order-status", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop, orderId: eddModal.order.shopifyOrderId, variantId: eddModal.item.variantId, data: { eddDate: newEdd, originalEddDate: eddModal.item.originalEddDate || oldEdd || newEdd, notes: serializeNotes(nextNotes) }, newNotes: [systemNote.text] }),
      });
      if (!response.ok) { const e = await response.json(); throw new Error(e.error || `API error: ${response.status}`); }
      const payload = await response.json();
      const cin7Exists = Boolean(payload.cin7Exists);
      setDetailView((prev) => prev ? { ...prev, item: { ...prev.item, eddDate: newEdd, originalEddDate: eddModal.item.originalEddDate || oldEdd || newEdd, cin7Exists } } : prev);
      const applyEdd = (o: FreightOrderRow): FreightOrderRow => o.id !== eddModal.order.id ? o : { ...o, lineItems: o.lineItems.map((li) => li.variantId !== eddModal.item.variantId ? li : { ...li, eddDate: newEdd, originalEddDate: eddModal.item.originalEddDate || oldEdd || newEdd, cin7Exists }) };
      setRows((prevRows = []) => prevRows.map(applyEdd));
      if (allRows) setAllRows((prev) => prev ? prev.map(applyEdd) : prev);
      setEddModal(null); setEddForm({ newEdd: "", reason: "", notifyCustomer: false });
      if (detailView) {
        const res = await fetch(`/api/order-status?orderId=${encodeURIComponent(detailView.order.shopifyOrderId)}&shop=${encodeURIComponent(shop)}`);
        if (res.ok) { const j = await res.json(); const l = (j.lineItems ?? []).find((it: any) => it.variantId === detailView.item.variantId); setNotes(parseNotesString(l?.notes ?? "")); }
      }
    } catch (e) { setEddError(e instanceof Error ? e.message : "Failed to save EDD"); } finally { setIsSavingEdd(false); }
  };

  const selectedTargets = (rows || []).flatMap((o) => o.lineItems.filter((li) => selected.has(li.id)).map((li) => ({ order: o, item: li })));

  // ── Bulk EDD update ──
  const handleBulkEddSave = async () => {
    if (!bulkEddForm.newEdd) { setBulkEddError("Please select a date before saving"); return; }
    if (selectedTargets.length === 0) { setBulkEddError("No line items selected"); return; }
    setBulkEddError(""); setIsBulkSavingEdd(true);
    const newEdd = bulkEddForm.newEdd;
    const fmt = (d: string) => new Date(d).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
    let done = 0; setBulkProgress({ done: 0, total: selectedTargets.length });
    const succeeded = new Set<string>();
    try {
      for (const t of selectedTargets) {
        const note: NoteItem = { author: "SY", role: "system", scheme: "system", time: formatNoteDateTime(), text: t.item.eddDate ? `EDD changed from ${fmt(t.item.eddDate)} to ${fmt(newEdd)} (bulk).` : `EDD set to ${fmt(newEdd)} (bulk).` };
        try {
          const res = await fetch("/api/order-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop, orderId: t.order.shopifyOrderId, variantId: t.item.variantId, data: { eddDate: newEdd, originalEddDate: t.item.originalEddDate || t.item.eddDate || newEdd }, newNotes: [note.text] }) });
          if (res.ok) succeeded.add(t.item.id);
        } catch { /* keep going */ }
        done++; setBulkProgress({ done, total: selectedTargets.length });
      }
      const apply = (o: FreightOrderRow): FreightOrderRow => ({ ...o, lineItems: o.lineItems.map((li) => succeeded.has(li.id) ? { ...li, eddDate: newEdd, originalEddDate: li.originalEddDate || li.eddDate || newEdd } : li) });
      setRows((prev = []) => prev.map(apply));
      if (allRows) setAllRows((prev) => (prev ? prev.map(apply) : prev));
      const failed = selectedTargets.length - succeeded.size;
      setSyncNotification(`Bulk EDD: ${succeeded.size} updated${failed ? `, ${failed} failed` : ""}`);
      window.setTimeout(() => setSyncNotification(null), 4500);
      setSelected(new Set()); setBulkEddModal(false); setBulkEddForm({ newEdd: "", notifyCustomer: false });
    } finally { setIsBulkSavingEdd(false); setBulkProgress(null); }
  };

  // ── Tracking save ──
  const handleTrackingSave = async () => {
    if (!trackingModal || !trackingForm.trackingNumber) { setTrackingError("Please enter a tracking number before saving"); return; }
    setTrackingError(""); setIsSavingTracking(true);
    const oldTracking = trackingModal.item.trackingNumber;
    const oldFreightRef = trackingModal.item.freightRef ?? "";
    const newFreightRef = trackingForm.freightRef.trim();
    const trackingNote: NoteItem = { author: "SY", role: "system", scheme: "system", time: formatNoteDateTime(), text: oldTracking ? `Tracking number updated from ${oldTracking} to ${trackingForm.trackingNumber}.` : `Tracking number set to ${trackingForm.trackingNumber}.` };
    const notesToAdd = [trackingNote];
    if (newFreightRef && newFreightRef !== oldFreightRef) {
      notesToAdd.push({ author: "SY", role: "system", scheme: "system", time: formatNoteDateTime(), text: oldFreightRef ? `Freight ref updated from ${oldFreightRef} to ${newFreightRef}.` : `Freight ref set to ${newFreightRef}.` });
    }
    const nextNotes = [...notes, ...notesToAdd]; setNotes(nextNotes);
    try {
      const response = await fetch("/api/order-status", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop, orderId: trackingModal.order.shopifyOrderId, variantId: trackingModal.item.variantId, data: { trackingNumber: trackingForm.trackingNumber, carrier: trackingForm.carrier, freightRef: newFreightRef, notes: serializeNotes(nextNotes) }, newNotes: notesToAdd.map((n) => n.text) }),
      });
      if (!response.ok) { const e = await response.json(); throw new Error(e.error || `API error: ${response.status}`); }
      const payload = await response.json();
      const cin7Exists = Boolean(payload.cin7Exists);
      setDetailView((prev) => prev ? { ...prev, item: { ...prev.item, trackingNumber: trackingForm.trackingNumber, company: trackingForm.carrier || prev.item.company, freightRef: newFreightRef, cin7Exists } } : prev);
      const applyTrack = (o: FreightOrderRow): FreightOrderRow => o.id !== trackingModal.order.id ? o : { ...o, lineItems: o.lineItems.map((li) => li.variantId !== trackingModal.item.variantId ? li : { ...li, trackingNumber: trackingForm.trackingNumber, company: trackingForm.carrier || li.company, freightRef: newFreightRef, cin7Exists }) };
      setRows((prevRows = []) => prevRows.map(applyTrack));
      if (allRows) setAllRows((prev) => prev ? prev.map(applyTrack) : prev);
      setTrackingModal(null); setTrackingForm({ carrier: "", trackingNumber: "", freightRef: "", deliveryMethod: "Standard", notifyCustomer: true });
      if (detailView) {
        const res = await fetch(`/api/order-status?orderId=${encodeURIComponent(detailView.order.shopifyOrderId)}&shop=${encodeURIComponent(shop)}`);
        if (res.ok) { const j = await res.json(); const l = (j.lineItems ?? []).find((it: any) => it.variantId === detailView.item.variantId); setNotes(parseNotesString(l?.notes ?? "")); }
      }
    } catch (e) { setTrackingError(e instanceof Error ? e.message : "Failed to save tracking"); } finally { setIsSavingTracking(false); }
  };

  // ── Dispatch & Freight save ──
  const handleDispatchEdit = () => {
    if (!detailView) return;
    setEditDispatchForm({ eddDate: detailView.item.eddDate ? detailView.item.eddDate.slice(0, 10) : "", carrier: detailView.item.company || "", trackingNumber: detailView.item.trackingNumber || "", freightRef: detailView.item.freightRef || "" });
    setEditDispatchError(""); setEditDispatchModal(true);
  };
  const handleDispatchSave = async () => {
    if (!detailView) return;
    setIsSavingDispatch(true); setEditDispatchError("");
    try {
      const data: Record<string, string> = {};
      if (editDispatchForm.eddDate !== (detailView.item.eddDate ? detailView.item.eddDate.slice(0, 10) : "")) { data.eddDate = editDispatchForm.eddDate; data.originalEddDate = detailView.item.originalEddDate || detailView.item.eddDate || editDispatchForm.eddDate; }
      if (editDispatchForm.carrier !== (detailView.item.company || "")) data.carrier = editDispatchForm.carrier;
      if (editDispatchForm.trackingNumber !== (detailView.item.trackingNumber || "")) data.trackingNumber = editDispatchForm.trackingNumber;
      if (editDispatchForm.freightRef !== (detailView.item.freightRef || "")) data.freightRef = editDispatchForm.freightRef;
      if (Object.keys(data).length === 0) { setEditDispatchModal(false); return; }
      const res = await fetch("/api/order-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop, orderId: detailView.order.shopifyOrderId, variantId: detailView.item.variantId, data }) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `API error: ${res.status}`); }
      const payload = await res.json(); const cin7Exists = Boolean(payload.cin7Exists);
      const apply = (o: FreightOrderRow): FreightOrderRow => o.id !== detailView.order.id ? o : { ...o, lineItems: o.lineItems.map((li) => li.variantId !== detailView.item.variantId ? li : { ...li, eddDate: data.eddDate || li.eddDate, originalEddDate: data.originalEddDate || li.originalEddDate, company: data.carrier || li.company, trackingNumber: data.trackingNumber || li.trackingNumber, freightRef: data.freightRef || li.freightRef, cin7Exists }) };
      setRows((prev) => prev.map(apply));
      if (allRows) setAllRows((prev) => prev ? prev.map(apply) : prev);
      setDetailView((prev) => prev ? { ...prev, item: { ...prev.item, eddDate: data.eddDate || prev.item.eddDate, originalEddDate: data.originalEddDate || prev.item.originalEddDate, company: data.carrier || prev.item.company, trackingNumber: data.trackingNumber || prev.item.trackingNumber, freightRef: data.freightRef || prev.item.freightRef, cin7Exists } } : prev);
      setEditDispatchModal(false); setSyncNotification("Dispatch & Freight updated & synced"); window.setTimeout(() => setSyncNotification(null), 4500);
    } catch (e) { setEditDispatchError(e instanceof Error ? e.message : "Failed to save"); } finally { setIsSavingDispatch(false); }
  };

  // ── Operational save ──
  const handleOpsEdit = () => {
    if (!detailView) return;
    setEditOpsForm({ warehouseStatus: detailView.item.warehouseStatus || "", dispatchStatus: detailView.item.dispatchStatus || "", deliveryStatus: detailView.item.deliveryStatus || "", poNumber: detailView.item.poNumber || "", depositPaid: detailView.item.depositPaid || "", balanceDue: detailView.item.balanceDue || "" });
    setEditOpsError(""); setEditOpsModal(true);
  };
  const handleOpsSave = async () => {
    if (!detailView) return;
    setIsSavingOps(true); setEditOpsError("");
    try {
      const data: Record<string, string> = {};
      if (editOpsForm.warehouseStatus !== (detailView.item.warehouseStatus || "")) data.warehouseStatus = editOpsForm.warehouseStatus;
      if (editOpsForm.dispatchStatus !== (detailView.item.dispatchStatus || "")) data.dispatchStatus = editOpsForm.dispatchStatus;
      if (editOpsForm.deliveryStatus !== (detailView.item.deliveryStatus || "")) data.deliveryStatus = editOpsForm.deliveryStatus;
      if (editOpsForm.poNumber !== (detailView.item.poNumber || "")) data.poNumber = editOpsForm.poNumber;
      if (editOpsForm.depositPaid !== (detailView.item.depositPaid || "")) data.depositPaid = editOpsForm.depositPaid;
      if (editOpsForm.balanceDue !== (detailView.item.balanceDue || "")) data.balanceDue = editOpsForm.balanceDue;
      if (Object.keys(data).length === 0) { setEditOpsModal(false); return; }
      const res = await fetch("/api/order-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop, orderId: detailView.order.shopifyOrderId, variantId: detailView.item.variantId, data }) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `API error: ${res.status}`); }
      const apply = (o: FreightOrderRow): FreightOrderRow => o.id !== detailView.order.id ? o : { ...o, lineItems: o.lineItems.map((li) => li.variantId !== detailView.item.variantId ? li : { ...li, warehouseStatus: data.warehouseStatus ?? li.warehouseStatus, dispatchStatus: data.dispatchStatus ?? li.dispatchStatus, deliveryStatus: data.deliveryStatus ?? li.deliveryStatus, poNumber: data.poNumber ?? li.poNumber, depositPaid: data.depositPaid ?? li.depositPaid, balanceDue: data.balanceDue ?? li.balanceDue }) };
      setRows((prev) => prev.map(apply));
      if (allRows) setAllRows((prev) => prev ? prev.map(apply) : prev);
      setDetailView((prev) => prev ? { ...prev, item: { ...prev.item, warehouseStatus: data.warehouseStatus ?? prev.item.warehouseStatus, dispatchStatus: data.dispatchStatus ?? prev.item.dispatchStatus, deliveryStatus: data.deliveryStatus ?? prev.item.deliveryStatus, poNumber: data.poNumber ?? prev.item.poNumber, depositPaid: data.depositPaid ?? prev.item.depositPaid, balanceDue: data.balanceDue ?? prev.item.balanceDue } } : prev);
      setEditOpsModal(false); setSyncNotification("Operational data updated & synced"); window.setTimeout(() => setSyncNotification(null), 4500);
    } catch (e) { setEditOpsError(e instanceof Error ? e.message : "Failed to save"); } finally { setIsSavingOps(false); }
  };

  const handleFixCin7Mismatch = async (order: FreightOrderRow, item: FreightLineItem) => {
    const key = `${order.id}-${item.variantId}`;
    if (cin7FixingId) return; setCin7FixingId(key);
    try {
      const res = await fetch("/api/cin7-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop, orderId: order.shopifyOrderId, variantId: item.variantId, trackingNumber: item.trackingNumber, eddDate: item.eddDate, carrier: item.company, fields: item.cin7Mismatches }) });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.ok) throw new Error(payload.error || "Failed to sync mismatched fields to Cin7");
      const pulled = payload.updated || {};
      const applyMatch = (o: FreightOrderRow): FreightOrderRow => o.id !== order.id ? o : { ...o, lineItems: o.lineItems.map((li) => li.variantId !== item.variantId ? li : { ...li, trackingNumber: pulled.trackingNumber ?? li.trackingNumber, eddDate: pulled.eddDate ?? li.eddDate, company: pulled.carrier ?? li.company, cin7Status: "match" as const, cin7Mismatches: [] }) };
      setRows((prev) => prev.map(applyMatch));
      if (allRows) setAllRows((prev) => prev ? prev.map(applyMatch) : prev);
      setSyncNotification(payload.direction === "pulled" ? "Pulled latest from Cin7" : "Cin7 fields updated");
    } catch (e) { setSyncNotification(e instanceof Error ? e.message : "Failed to update Cin7"); } finally { setCin7FixingId(null); window.setTimeout(() => setSyncNotification(null), 4500); }
  };

  const handleSyncMondayItem = async (order: FreightOrderRow, item: FreightLineItem) => {
    const key = `${order.id}-${item.variantId}-monday`;
    if (mondayFixingId) return; setMondayFixingId(key);
    try {
      const res = await fetch("/api/monday-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop, orderId: order.shopifyOrderId, variantId: item.variantId, itemName: `${order.shopifyOrderName}${item.letterSuffix}`, row: { customerName: order.customerName, email: order.email, carriers: item.company, trackingNumber: item.trackingNumber, eddDate: item.eddDate, originalEddDate: item.originalEddDate, productTitle: item.title ?? "", sku: item.sku ?? "", boxes: item.boxes ?? "", customerStatus: item.customerStatus } }) });
      if (!res.ok) throw new Error("Failed to sync Monday");
      const json = await res.json();
      const updated = json.updated || {};
      const applyRow = (o: FreightOrderRow): FreightOrderRow => o.id !== order.id ? o : { ...o, lineItems: o.lineItems.map((li) => li.variantId !== item.variantId ? li : { ...li, ...updated, mondayStatus: "match", mondayMismatches: [] }) };
      setRows((prev) => prev.map(applyRow));
      if (allRows) setAllRows((prev) => prev ? prev.map(applyRow) : prev);
      if (detailView?.order.id === order.id && detailView.item.variantId === item.variantId) {
        setDetailView((prev) => prev ? { ...prev, item: { ...prev.item, ...updated, mondayStatus: "match", mondayMismatches: [] } } : prev);
      }
      setSyncNotification(json.syncStatus === "created" ? "Created in Monday" : "Monday fields updated");
    } catch (e) { setSyncNotification(e instanceof Error ? e.message : "Failed to sync Monday"); } finally { setMondayFixingId(null); window.setTimeout(() => setSyncNotification(null), 4500); }
  };

  const handleRefreshCin7Status = async (ordersArg?: FreightOrderRow[]) => {
    const useOrders = dedupeOrders(ordersArg ?? rows);
    if (isRefreshingCin7 || useOrders.length === 0) return; setIsRefreshingCin7(true);
    try {
      const res = await fetch("/api/cin7-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop, force: true, orders: useOrders.map((order) => ({ orderId: order.shopifyOrderId, lineItems: order.lineItems.map((li) => ({ variantId: li.variantId, trackingNumber: li.trackingNumber, eddDate: li.eddDate, company: li.company })) })) }) });
      if (!res.ok) return;
      const json = await res.json();
      const ordersResult: Record<string, { results: any[] }> = json.orders ?? {};
      const applyResults = (o: FreightOrderRow): FreightOrderRow => { const result = ordersResult[o.shopifyOrderId]?.results; if (!result) return o; return { ...o, lineItems: o.lineItems.map((li) => { const m = result.find((r: any) => r.variantId === li.variantId); return m ? { ...li, cin7Status: m.status, cin7Mismatches: m.mismatches } : li; }) }; };
      setRows((prev) => prev.map(applyResults));
      if (allRows) setAllRows((prev) => prev ? prev.map(applyResults) : prev);
    } catch (e) { console.error("Failed to force-refresh Cin7 status", e); } finally { setIsRefreshingCin7(false); }
  };

  const handleRefreshMondayStatus = async (ordersArg?: FreightOrderRow[]) => {
    const useOrders = dedupeOrders(ordersArg ?? rows);
    if (isRefreshingMonday || useOrders.length === 0) return; setIsRefreshingMonday(true);
    try {
      const res = await fetch("/api/monday-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop, force: true, orders: useOrders.map((order) => ({ orderId: order.shopifyOrderId, lineItems: order.lineItems.map((li) => ({ variantId: li.variantId })) })) }) });
      if (!res.ok) return;
      const json = await res.json();
      const ordersResult: Record<string, { results: any[] }> = json.orders ?? {};
      const applyResults = (o: FreightOrderRow): FreightOrderRow => { const result = ordersResult[o.shopifyOrderId]?.results; if (!result) return o; return { ...o, lineItems: o.lineItems.map((li) => { const m = result.find((r: any) => r.variantId === li.variantId); return m ? { ...li, mondayStatus: m.status, mondayMismatches: m.mismatches } : li; }) }; };
      setRows((prev) => prev.map(applyResults));
      if (allRows) setAllRows((prev) => prev ? prev.map(applyResults) : prev);
    } catch (e) { console.error("Failed to force-refresh Monday status", e); } finally { setIsRefreshingMonday(false); }
  };

  const handleRefreshStatuses = async () => {
    const source = dedupeOrders(allRows ?? rows);
    const ordersToCheck = source.slice(0, 100);
    if (ordersToCheck.length === 0) return;
    await Promise.allSettled([handleRefreshCin7Status(ordersToCheck), handleRefreshMondayStatus(ordersToCheck)]);
  };

  const handleCreateCin7Order = async (order: FreightOrderRow) => {
    if (creatingCin7OrderId) return; setCreatingCin7OrderId(order.id);
    try {
      const response = await fetch("/api/cin7-create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop, orderId: order.shopifyOrderId }) });
      if (!response.ok) { const errorJson = await response.json().catch(() => null); throw new Error(errorJson?.error || `Failed to create Cin7 order (${response.status})`); }
      const payload = await response.json();
      if (!payload.ok) throw new Error(payload.error || "Failed to create Cin7 order");
      const cin7Exists = Boolean(payload.cin7SalesOrderId && payload.cin7SalesOrderId !== "pending");
      const applyCin7 = (o: FreightOrderRow): FreightOrderRow => o.id !== order.id ? o : { ...o, lineItems: o.lineItems.map((li: any) => ({ ...li, cin7Exists, cin7Status: cin7Exists ? "match" : "missing", cin7Mismatches: [] })) };
      setRows((prevRows = []) => prevRows.map(applyCin7));
      if (allRows) setAllRows((prev) => prev ? prev.map(applyCin7) : prev);
      if (detailView?.order.id === order.id) setDetailView((prev) => prev ? { ...prev, item: { ...prev.item, cin7Exists } } : prev);
      setSyncNotification("Cin7 order created successfully");
    } catch (e) { setSyncNotification(e instanceof Error ? e.message : "Failed to create Cin7 order"); } finally { setCreatingCin7OrderId(null); window.setTimeout(() => setSyncNotification(null), 4500); }
  };

  const handleSync = async () => {
    if (!detailView) return; setIsSyncing(true);
    try {
      const res = await fetch("/api/monday-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop, orderId: detailView.order.shopifyOrderId, variantId: detailView.item.variantId, itemName: `${detailView.order.shopifyOrderName}${detailView.item.letterSuffix}`, row: { customerName: detailView.order.customerName, email: detailView.order.email, carriers: detailView.item.company, trackingNumber: detailView.item.trackingNumber, eddDate: detailView.item.eddDate, originalEddDate: detailView.item.originalEddDate, productTitle: detailView.item.title ?? "", sku: detailView.item.sku ?? "", boxes: detailView.item.boxes ?? "", customerStatus: detailView.item.customerStatus } }) });
      if (!res.ok) throw new Error("Sync failed");
      const json = await res.json();
      const applySync = (o: FreightOrderRow): FreightOrderRow => o.id !== detailView.order.id ? o : { ...o, lineItems: o.lineItems.map((li: any) => li.variantId !== detailView.item.variantId ? li : { ...li, ...json.updated }) };
      setDetailView((prev) => prev ? { ...prev, item: { ...prev.item, ...json.updated } } : prev);
      setRows((prevRows = []) => prevRows.map(applySync));
      if (allRows) setAllRows((prev) => prev ? prev.map(applySync) : prev);
      // Cin7 sync
      try {
        if (!detailView.item.cin7Exists) {
          const cin7Res = await fetch("/api/cin7-create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop, orderId: detailView.order.shopifyOrderId }) });
          if (cin7Res.ok) {
            const cin7Payload = await cin7Res.json();
            const cin7Exists = Boolean(cin7Payload.cin7SalesOrderId && cin7Payload.cin7SalesOrderId !== "pending");
            const applyCin7Created = (o: FreightOrderRow): FreightOrderRow => o.id !== detailView.order.id ? o : { ...o, lineItems: o.lineItems.map((li) => ({ ...li, cin7Exists, cin7Status: cin7Exists ? "match" as const : "missing" as const, cin7Mismatches: [] })) };
            setRows((prev) => prev.map(applyCin7Created));
            if (allRows) setAllRows((prev) => prev ? prev.map(applyCin7Created) : prev);
            setDetailView((prev) => prev ? { ...prev, item: { ...prev.item, cin7Exists } } : prev);
          }
        } else {
          const cin7Res = await fetch("/api/cin7-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop, orderId: detailView.order.shopifyOrderId, variantId: detailView.item.variantId, trackingNumber: detailView.item.trackingNumber, eddDate: detailView.item.eddDate, carrier: detailView.item.company, fields: ["trackingNumber", "eddDate", "carrier"], forceCarrier: true }) });
          const cin7Payload = await cin7Res.json().catch(() => ({}));
          if (cin7Res.ok && cin7Payload.ok) {
            const pulled = cin7Payload.updated || {};
            const applyCin7Updated = (o: FreightOrderRow): FreightOrderRow => o.id !== detailView.order.id ? o : { ...o, lineItems: o.lineItems.map((li) => li.variantId !== detailView.item.variantId ? li : { ...li, trackingNumber: pulled.trackingNumber ?? li.trackingNumber, eddDate: pulled.eddDate ?? li.eddDate, company: pulled.carrier ?? li.company, cin7Status: "match" as const, cin7Mismatches: [] }) };
            setRows((prev) => prev.map(applyCin7Updated));
            if (allRows) setAllRows((prev) => prev ? prev.map(applyCin7Updated) : prev);
            setDetailView((prev) => prev ? { ...prev, item: { ...prev.item, trackingNumber: pulled.trackingNumber ?? prev.item.trackingNumber, eddDate: pulled.eddDate ?? prev.item.eddDate, company: pulled.carrier ?? prev.item.company, cin7Status: "match", cin7Mismatches: [] } } : prev);
          }
        }
      } catch (cin7Err) { console.error("Cin7 sync failed", cin7Err); }
      // Refresh notes
      const notesRes = await fetch(`/api/order-status?orderId=${encodeURIComponent(detailView.order.shopifyOrderId)}&shop=${encodeURIComponent(shop)}`);
      if (notesRes.ok) { const notesJson = await notesRes.json(); const line = (notesJson.lineItems ?? []).find((it: any) => it.variantId === detailView.item.variantId); setNotes(parseNotesString(line?.notes ?? "")); }
    } catch (e) { console.error("Monday sync failed", e); } finally { setIsSyncing(false); }
  };

  return (
    <>
      <div className="fo-root">
        {/* Navbar */}
        <nav className="fo-nav">
          <div className="fo-nav-left">
            <div className="fo-logo-box">F</div>
            <span className="fo-nav-title">Freight OMS</span>
            <div className="fo-nav-search-wrap">
              <span className="fo-nav-search-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <input className="fo-nav-search" placeholder="Search by order #, customer, carrier…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="fo-nav-right">{navbarRight}</div>
        </nav>

        <div className="fo-body">
          {/* Stat cards */}
          {!detailView && (
            <div className="fo-stats">
              {[
                { label: "Total line orders", value: totalLineItems, color: "#111827" },
                { label: "Awaiting dispatch", value: awaitingCount, color: "#d97706" },
                { label: "Dispatched today", value: dispatchedCount, color: "#2563eb" },
                { label: "Pending notify", value: pendingNotifyCount, color: "#dc2626" },
              ].map(({ label, value, color }) => (
                <div className="fo-stat" key={label}>
                  <div className="fo-stat-label">{label}</div>
                  <div className="fo-stat-value" style={{ color }}>{value}</div>
                </div>
              ))}
            </div>
          )}

          <div className="fo-card">
            {/* Tabs */}
            {!detailView && (
              <div className="fo-tabs">
                {TABS.map((tab) => (
                  <button key={tab.key} className={`fo-tab${activeTab === tab.key ? " active" : ""}`} onClick={() => setTab(tab.key)}>
                    {tab.label}
                    <span className="fo-tab-pill" style={activeTab === tab.key ? { background: tab.color, color: "#fff" } : {}}>
                      {tab.key === "all" ? totalLineItems : tab.count}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Toolbar */}
            {!detailView && (
              <div className="fo-toolbar">
                <label className="fo-select-label">
                  <input type="checkbox" className="fo-checkbox" checked={selected.size === selectableIds.length && selectableIds.length > 0} onChange={toggleSelectAll} />
                  {selected.size > 0 ? `${selected.size} selected` : "0 selected"}
                </label>
                {selected.size > 0 && (
                  <button className="fo-tool-btn" style={{ background: "#2563eb", color: "#fff", borderColor: "#2563eb" }} onClick={() => { setBulkEddError(""); setBulkEddForm({ newEdd: "", notifyCustomer: false }); setBulkEddModal(true); }}>
                    <IconCalendar /> Bulk update EDD ({selected.size})
                  </button>
                )}
                <div className="fo-toolbar-right" style={{ alignItems: "flex-end" }}>
                  {serverDriven && (
                    <select className="fo-status-select" value={activeSupplier} onChange={(e) => setSupplier(e.target.value)} title="Filter by supplier (Shopify Vendor)">
                      <option value="">All suppliers</option>
                      {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "6px" }}>
                    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "8px" }}>
                      <button className="fo-tool-btn" onClick={handleRefreshStatuses} disabled={(isRefreshingCin7 || isRefreshingMonday) || (allRows ?? rows).length === 0}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                        {(isRefreshingCin7 || isRefreshingMonday) ? "Checking statuses..." : "Refresh status"}
                      </button>
                    </div>
                  </div>
                  <div style={{ position: "relative" }}>
                    <button className="fo-tool-btn" onClick={() => { setShowFilterMenu((v) => !v); setShowColumnsMenu(false); }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="11" y1="18" x2="13" y2="18" /></svg>
                      Filter{statusFilter ? " (1)" : ""}
                    </button>
                    {showFilterMenu && (
                      <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 20, background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: "8px", minWidth: "180px" }}>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: "#6b7280", padding: "4px 8px" }}>Customer status</div>
                        {["", "confirmed", "dispatched", "delivered", "cancelled", "pending"].map((s) => (
                          <label key={s || "all"} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 8px", fontSize: "13px", cursor: "pointer" }}>
                            <input type="radio" name="statusFilter" checked={statusFilter === s} onChange={() => { setStatusFilter(s); setShowFilterMenu(false); }} />
                            {s ? s.charAt(0).toUpperCase() + s.slice(1) : "All statuses"}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ position: "relative" }}>
                    <button className="fo-tool-btn" onClick={() => { setShowColumnsMenu((v) => !v); setShowFilterMenu(false); }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
                      Columns
                    </button>
                    {showColumnsMenu && (
                      <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 20, background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: "8px", minWidth: "180px" }}>
                        {[
                          { key: "supplier", label: "Supplier" },
                          { key: "warehouse", label: "Warehouse" },
                          { key: "payment", label: "Payment status" },
                          { key: "carrier", label: "Carrier" },
                          { key: "tracking", label: "Tracking #" },
                          { key: "freightRef", label: "Freight ref" },
                          { key: "cin7", label: "Cin7" },
                          { key: "monday", label: "Monday" },
                        ].map(({ key, label }) => (
                          <label key={key} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 8px", fontSize: "13px", cursor: "pointer" }}>
                            <input type="checkbox" checked={!hiddenColumns.has(key)} onChange={() => toggleColumn(key)} />
                            {label}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {syncNotification && (
              <div className="fo-sync-progress" style={{ marginTop: "14px", padding: "16px", border: "1px solid #d1fae5", borderRadius: "12px", background: "#ecfdf5", color: "#065f46" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700 }}>{syncNotification}</span>
                </div>
              </div>
            )}

            {/* Detail View */}
            {detailView ? (
              <div className="fo-detail-wrap">
                <div className="fo-detail-bar">
                  <div className="fo-detail-bar-left">
                    <button className="fo-icon-btn" onClick={() => { if (detailBackHref) { navigate(detailBackHref); } else { setDetailView(null); } }} title="Back">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                    </button>
                    <span style={{ fontWeight: 700, fontSize: "14px", color: "#111827" }}>{detailView.order.shopifyOrderName}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 700, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe" }}>
                      #{detailView.order.shopifyOrderName} <span style={{ background: "#bfdbfe", borderRadius: "3px", padding: "0 4px" }}>{detailView.item.letterSuffix}</span>
                    </span>
                    <span className="fo-detail-badge" style={{ background: getCustomerStatusStyle(detailView.item.customerStatus).bg, color: getCustomerStatusStyle(detailView.item.customerStatus).text }}>
                      {getCustomerStatusStyle(detailView.item.customerStatus).label || "Not set"}
                    </span>
                    <span style={{ fontSize: "12px", color: "#6b7280", width: "100%", marginTop: "4px" }}>
                      Parent order {detailView.order.shopifyOrderName} · {detailView.order.customerName} · {new Date(detailView.order.createdAt).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </div>
                  <div className="fo-detail-bar-actions">
                    <button className="fo-detail-action-btn" onClick={() => { setNoteModal(true); setNoteTab("internal"); setNoteText(""); setSendToMonday(false); }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                      Add note
                    </button>
                    <button className="fo-detail-action-btn" onClick={() => { setEddModal({ order: detailView.order, item: detailView.item }); setEddForm({ newEdd: detailView.item.eddDate, reason: "", notifyCustomer: false }); }}>
                      <IconCalendar /> Update EDD
                    </button>
                    <button className="fo-detail-action-btn" onClick={() => { setTrackingModal({ order: detailView.order, item: detailView.item }); setTrackingForm({ carrier: detailView.item.company || "", trackingNumber: "", freightRef: "", deliveryMethod: "Standard", notifyCustomer: true }); }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>
                      Tracking
                    </button>
                    <button className="fo-detail-action-btn">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                      Notify
                    </button>
                    <button className="fo-detail-action-btn sync-btn" onClick={handleSync} disabled={isSyncing}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                      {isSyncing ? "Syncing..." : "Sync"}
                    </button>
                  </div>
                </div>

                <div className="fo-detail-content">
                  <DetailPanels order={detailView.order} item={detailView.item} onEditDispatch={handleDispatchEdit} onEditOps={handleOpsEdit} />
                  <NotesPanel notes={notes} notesFetching={notesFetching} onAddNote={() => { setNoteModal(true); setNoteTab("internal"); setNoteText(""); setSendToMonday(false); }} />
                </div>
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="fo-empty">
                <div className="fo-empty-icon">📦</div>
                <div className="fo-empty-title">No freight orders found</div>
                <div className="fo-empty-sub">{search ? "Try a different search term." : "Orders appear here after checkout completes."}</div>
              </div>
            ) : (
              <OrderTable
                filteredOrders={filteredOrders}
                selected={selected}
                orderLetterColors={orderLetterColors}
                selectableIds={selectableIds}
                toggleSelectAll={toggleSelectAll}
                toggleSelect={toggleSelect}
                onOpenDetail={(order, item) => navigate(`/app/freight-orders/${order.shopifyOrderId}?variantId=${encodeURIComponent(item.variantId)}`)}
                onOpenNotes={(order, item) => { setNoteModalTarget({ order, item }); setNoteModal(true); setNoteTab("internal"); setNoteText(""); setSendToMonday(false); }}
                onOpenEdd={(order, item) => { setEddModal({ order, item }); setEddForm({ newEdd: item.eddDate, reason: "", notifyCustomer: false }); }}
                onOpenTracking={(order, item) => { setTrackingModal({ order, item }); setTrackingForm({ carrier: item.company || "", trackingNumber: "", freightRef: getRefPrefix(item.company || ""), deliveryMethod: "Standard", notifyCustomer: true }); }}
                onFixCin7={handleFixCin7Mismatch}
                onSyncMonday={handleSyncMondayItem}
                onCreateCin7={handleCreateCin7Order}
                cin7FixingId={cin7FixingId}
                mondayFixingId={mondayFixingId}
                creatingCin7OrderId={creatingCin7OrderId}
                hiddenColumns={hiddenColumns}
                navigate={navigate}
              />
            )}

            {/* Pagination */}
            {pageCount > 1 && (
              <div className="fo-pagination">
                <button className="fo-page-btn" disabled={currentPage <= 1}
                  onClick={() => {
                    const newPage = Math.max(1, currentPage - 1);
                    if (!serverDriven && allRows) { setCurrentPage(newPage); setRows(allRows.slice((newPage - 1) * 25, newPage * 25)); return; }
                    const np = new URLSearchParams(Array.from(searchParams.entries())); np.set("page", String(newPage)); setSearchParams(np);
                  }}>← Previous</button>
                <span className="fo-page-info">Page {currentPage} of {pageCount}</span>
                <button className="fo-page-btn" disabled={currentPage >= pageCount}
                  onClick={() => {
                    const newPage = Math.min(pageCount, currentPage + 1);
                    if (!serverDriven && allRows) { setCurrentPage(newPage); setRows(allRows.slice((newPage - 1) * 25, newPage * 25)); return; }
                    const np = new URLSearchParams(Array.from(searchParams.entries())); np.set("page", String(newPage)); setSearchParams(np);
                  }}>Next →</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {trackingModal && (
        <TrackingModal trackingModal={trackingModal} trackingForm={trackingForm} trackingError={trackingError} isSavingTracking={isSavingTracking} setTrackingForm={setTrackingForm} setTrackingModal={setTrackingModal} setTrackingError={setTrackingError} onSave={handleTrackingSave} />
      )}
      {eddModal && (
        <EddModal eddModal={eddModal} eddForm={eddForm} eddError={eddError} isSavingEdd={isSavingEdd} setEddForm={setEddForm} setEddModal={setEddModal} setEddError={setEddError} onSave={handleEddSave} />
      )}
      {bulkEddModal && (
        <BulkEddModal selectedCount={selectedTargets.length} bulkEddForm={bulkEddForm} bulkEddError={bulkEddError} isBulkSavingEdd={isBulkSavingEdd} bulkProgress={bulkProgress} setBulkEddForm={setBulkEddForm} setBulkEddModal={setBulkEddModal} setBulkEddError={setBulkEddError} onSave={handleBulkEddSave} />
      )}
      {noteModal && activeNoteTarget && (
        <NoteModal target={activeNoteTarget} noteTab={noteTab} noteText={noteText} sendToMonday={sendToMonday} sendToCin7={sendToCin7} isSavingNote={isSavingNote} noteAuthor={noteAuthor} setNoteTab={setNoteTab} setNoteText={setNoteText} setSendToMonday={setSendToMonday} setSendToCin7={setSendToCin7} setNoteModal={setNoteModal} setNoteModalTarget={setNoteModalTarget}
          onSave={async (text, tab, pushMonday, pushCin7) => {
            setIsSavingNote(true);
            const newNoteEntry: NoteItem = { author: noteAuthor, role: tab === "internal" ? "internal" : "customer", scheme: tab, time: formatNoteDateTime(), text, pushToMonday: pushMonday };
            const nextNotes = [...notes, newNoteEntry];
            try {
              const res = await fetch("/api/order-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop, orderId: activeNoteTarget.order.shopifyOrderId, variantId: activeNoteTarget.item.variantId, data: { notes: serializeNotes(nextNotes) }, newNotes: [text], newCin7Notes: pushCin7 ? [text] : [] }) });
              if (!res.ok) return;
              setNotes(nextNotes); setNoteText(""); setSendToMonday(false); setSendToCin7(false); setNoteModal(false); setNoteModalTarget(null);
            } catch (error) { console.error("Failed to save note", error); } finally { setIsSavingNote(false); }
          }}
        />
      )}
      {editDispatchModal && detailView && (
        <DispatchEditModal order={detailView.order} item={detailView.item} form={editDispatchForm} error={editDispatchError} isSaving={isSavingDispatch} setForm={setEditDispatchForm} onClose={() => { setEditDispatchModal(false); setEditDispatchError(""); }} onSave={handleDispatchSave} />
      )}
      {editOpsModal && detailView && (
        <OpsEditModal order={detailView.order} item={detailView.item} form={editOpsForm} error={editOpsError} isSaving={isSavingOps} setForm={setEditOpsForm} onClose={() => { setEditOpsModal(false); setEditOpsError(""); }} onSave={handleOpsSave} />
      )}
    </>
  );
}
