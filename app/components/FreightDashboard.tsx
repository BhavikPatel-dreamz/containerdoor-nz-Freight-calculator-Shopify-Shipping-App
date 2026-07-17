/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { companyLabels } from "../lib/freight";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import "../styles/freight-orders.css";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FreightLineItem = {
  id: string;
  variantId: string;
  title?: string;
  sku?: string;
  company: string;
  boxes: number;
  amount: number;
  letterSuffix: string;
  customerStatus: string;
  trackingNumber: string;
  freightRef?: string;   // NEW
  eddDate: string;
  originalEddDate: string;
  cin7Exists?: boolean;
  cin7Status?: "match" | "mismatch" | "missing" | "error";
  cin7Mismatches?: string[];
};

export type FreightOrderRow = {
  id: string;
  shopifyOrderId: string;
  shopifyOrderName: string;
  currency: string;
  totalFreight: number;
  city: string | null;
  postalCode: string | null;
  createdAt: string;
  carriers: string;
  packageCount: string;
  lineItems: FreightLineItem[];
  shippingTitle: string;
  customerName: string;
  email: string;
  phone: string;
  financialStatus: string;
  fulfillmentStatus: string;
  fullAddress: string;
};

type NoteItem = {
  author: string;
  role: string;
  scheme: string;
  time: string;
  text: string;
  isSystem?: boolean;
};

type SyncProgressEntry = {
  id: string;
  label: string;
  status: "created" | "updated" | "already-there" | "failed";
  message: string;
};

type SyncProgressState = {
  total: number;
  completed: number;
  created: number;
  updated: number;
  already: number;
  failed: number;
  entries: SyncProgressEntry[];
  startedAt: number;
  estimatedSecondsLeft: number;
};

// ─── Props ────────────────────────────────────────────────────────────────────

export type FreightDashboardProps = {
  orders: FreightOrderRow[];
  allOrders?: FreightOrderRow[];
  total: number;
  page: number;
  pageCount: number;
  shop: string;
  /** Displayed in the navbar right slot. Pass your avatar/logout UI here. */
  navbarRight: React.ReactNode;
  /**
   * Author string used when saving a new note.
   * Defaults to "SP" if not provided.
   */
  noteAuthor?: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCustomerStatusStyle(status: string): { bg: string; text: string; label: string } {
  switch ((status || "").toLowerCase()) {
    case "dispatched": return { bg: "#dcfce7", text: "#15803d", label: "Dispatched" };
    case "delivered": return { bg: "#d1fae5", text: "#065f46", label: "Delivered" };
    case "confirmed": return { bg: "#dbeafe", text: "#1d4ed8", label: "Confirmed" };
    case "cancelled": return { bg: "#fee2e2", text: "#b91c1c", label: "Cancelled" };
    case "pending": return { bg: "#fef3c7", text: "#92400e", label: "Pending" };
    default: return { bg: "#f3f4f6", text: "#6b7280", label: status || "—" };
  }
}

function formatSeconds(seconds: number): string {
  if (seconds <= 0) return "0m";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function formatRelativeTime(diffMs: number): string {
  const seconds = Math.max(0, Math.round(diffMs / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function parseNotesString(raw: string): NoteItem[] {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  const blocks = text.split(/\r?\n\r?\n/).filter(Boolean);
  const allTagged = blocks.every((block) => /^\s*\[(internal|customer|system)[\]|]/i.test(block));
  if (!allTagged) {
    return [{ author: "SP", role: "internal", scheme: "internal", time: "", text }];
  }
  return blocks.map((block) => {
    const trimmed = block.trim();
    // Format: [scheme|author|time] text
    const richMatch = trimmed.match(/^\[([^|]+)\|([^|]*)\|([^\]]*)\]\s*(.*)$/i);
    if (richMatch) {
      const scheme = richMatch[1].toLowerCase();
      return {
        author: richMatch[2] || (scheme === "system" ? "SY" : "SP"),
        role: scheme === "customer" ? "customer" : scheme === "system" ? "system" : "internal",
        scheme,
        time: richMatch[3] || "",
        text: richMatch[4].trim(),
      };
    }
    // Legacy format: [scheme] text
    const match = trimmed.match(/^\[(internal|customer|system)\]\s*(.*)$/i);
    if (!match) return { author: "SP", role: "internal", scheme: "internal", time: "", text: trimmed };
    const scheme = match[1].toLowerCase();
    return {
      author: scheme === "customer" ? "Customer" : scheme === "system" ? "SY" : "SP",
      role: scheme === "customer" ? "customer" : scheme === "system" ? "system" : "internal",
      scheme,
      time: "",
      text: match[2].trim(),
    };
  });
}

function serializeNotes(notes: NoteItem[]): string {
  return notes.map((note) => `[${note.scheme}|${note.author}|${note.time}] ${note.text}`).join("\n\n");
}

function formatNoteDateTime(d = new Date()): string {
  return `${d.toLocaleDateString("en-NZ", { day: "numeric", month: "short" })} ${d.toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" })}`;
}

function getCin7CellStatus(item: FreightLineItem): "match" | "mismatch" | "missing" | "error" {
  if (item.cin7Status) return item.cin7Status;
  return item.cin7Exists ? "match" : "missing";
}

function getRefPrefix(carrier: string): string {
  if (!carrier) return "";
  return `${carrier}-REF-`;
}

// ─── Tab definitions ──────────────────────────────────────────────────────────


// ─── SVG Icons ────────────────────────────────────────────────────────────────

const IconEye = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
  </svg>
);
const IconChat = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const IconCalendar = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);
const IconPlus = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

// ─── Component ────────────────────────────────────────────────────────────────

export default function FreightDashboard({
  orders,
  allOrders,
  total,
  page,
  pageCount,
  shop,
  navbarRight,
  noteAuthor = "SP",
}: FreightDashboardProps) {
  const [rows, setRows] = useState<FreightOrderRow[]>(orders);
  const [allRows, setAllRows] = useState<FreightOrderRow[] | null>(allOrders ?? null);
  useEffect(() => setRows(orders), [orders]);
  useEffect(() => { if (allOrders) setAllRows(allOrders); }, [allOrders]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [currentPage, setCurrentPage] = useState<number>(page ?? 1);

  useEffect(() => {
    // keep currentPage in sync when the route changes server-side
    setCurrentPage(page ?? 1);
  }, [page]);
  const [detailView, setDetailView] = useState<{ order: FreightOrderRow; item: FreightLineItem } | null>(null);
  const [trackingModal, setTrackingModal] = useState<{ order: FreightOrderRow; item: FreightLineItem } | null>(null);
  const [eddModal, setEddModal] = useState<{ order: FreightOrderRow; item: FreightLineItem } | null>(null);
  const [noteModalTarget, setNoteModalTarget] = useState<{ order: FreightOrderRow; item: FreightLineItem } | null>(null);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [noteModal, setNoteModal] = useState(false);
  const [noteTab, setNoteTab] = useState("internal");
  const [noteText, setNoteText] = useState("");
  const [isSavingEdd, setIsSavingEdd] = useState(false);
  const [notesFetching, setNotesFetching] = useState(false);
  const [isSavingTracking, setIsSavingTracking] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgressState | null>(null);
  const [syncProgressOpen, setSyncProgressOpen] = useState(false);
  const [syncNotification, setSyncNotification] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [creatingCin7OrderId, setCreatingCin7OrderId] = useState<string | null>(null);
  const [cin7FixingId, setCin7FixingId] = useState<string | null>(null);
  const [, setTimeTick] = useState(0);
  const [eddError, setEddError] = useState("");
  const [trackingError, setTrackingError] = useState("");
  const [trackingForm, setTrackingForm] = useState({ carrier: "", trackingNumber: "", freightRef: "", deliveryMethod: "Standard", notifyCustomer: true });
  const [eddForm, setEddForm] = useState({ newEdd: "", reason: "", notifyCustomer: false });
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const activeNoteTarget = detailView ?? noteModalTarget;

  useEffect(() => {
    if (!lastSyncAt) return;
    const timer = window.setInterval(() => setTimeTick((n) => n + 1), 60000);
    return () => window.clearInterval(timer);
  }, [lastSyncAt]);

  // ── Fetch notes whenever a modal that shows notes opens ───────────────────
  useEffect(() => {
    const target = detailView ?? noteModalTarget ?? eddModal ?? trackingModal;
    if (!target) return;
    const fetchNotes = async () => {
      setNotesFetching(true);
      try {
        const res = await fetch(
          `/api/order-status?orderId=${encodeURIComponent(target.order.shopifyOrderId)}&shop=${encodeURIComponent(shop)}`
        );
        if (!res.ok) return;
        const json = await res.json();
        const line = (json.lineItems ?? []).find((item: any) => item.variantId === target.item.variantId);
        setNotes(parseNotesString(line?.notes ?? ""));
      } catch (e) {
        console.error("Failed to load notes", e);
      } finally {
        setNotesFetching(false);
      }
    };
    fetchNotes();
  }, [detailView, noteModalTarget, eddModal, trackingModal]);

  useEffect(() => {
    if (!rows || rows.length === 0) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/cin7-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shop,
            orders: rows.map((order) => ({
              orderId: order.shopifyOrderId,
              lineItems: order.lineItems.map((li) => ({
                variantId: li.variantId, trackingNumber: li.trackingNumber, eddDate: li.eddDate, company: li.company,
              })),
            })),
          }),
        });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const ordersResult: Record<string, { results: any[] }> = json.orders ?? {};
        setRows((prev) => prev.map((o) => {
          const result = ordersResult[o.shopifyOrderId]?.results;
          if (!result) return o;
          return {
            ...o,
            lineItems: o.lineItems.map((li) => {
              const m = result.find((r: any) => r.variantId === li.variantId);
              return m ? { ...li, cin7Status: m.status, cin7Mismatches: m.mismatches } : li;
            }),
          };
        }));
      } catch (e) { console.error("Failed to fetch Cin7 status", e); }
    })();

    return () => { cancelled = true; };
  }, [rows.map((o) => o.id).join(","), shop]);

  const filteredOrders = (rows || []).filter((o) => {
    // Tab filter — keep orders that have at least one matching line item
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
    // Search filter
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

  const toggleSelectAll = () =>
    setSelected(selected.size === filteredOrders.length
      ? new Set()
      : new Set(filteredOrders.map((o) => o.id)));

  const toggleSelect = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const orderLetterColors = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];
  const allLineItems = (rows || []).flatMap((o) => o.lineItems);
  const totalLineItems = allLineItems.length;
  const awaitingCount = allLineItems.filter((li) => (li.customerStatus || "").toLowerCase() === "confirmed").length;
  const dispatchedCount = allLineItems.filter((li) => (li.customerStatus || "").toLowerCase() === "dispatched").length;
  const pendingNotifyCount = allLineItems.filter((li) => !li.trackingNumber && (li.customerStatus || "").toLowerCase() === "dispatched").length;
  const completedCount = allLineItems.filter((li) => (li.customerStatus || "").toLowerCase() === "delivered").length;

  const TABS = [
    { key: "all", label: "All orders", count: null, color: "#2563eb" },
    { key: "awaiting", label: "Awaiting dispatch", count: awaitingCount, color: "#d97706" },
    { key: "dispatch", label: "Dispatched", count: dispatchedCount, color: "#2563eb" },
    { key: "complete", label: "Completed", count: completedCount, color: "#6b7280" },
  ];



  // ── EDD save ──────────────────────────────────────────────────────────────
  const handleEddSave = async () => {
    if (!eddModal || !eddForm.newEdd) { setEddError("Please select a date before saving"); return; }
    setEddError("");
    setIsSavingEdd(true);
    const oldEdd = eddModal.item.eddDate;
    const newEdd = eddForm.newEdd;
    const fmt = (d: string) => new Date(d).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
    const systemNote: NoteItem = {
      author: "SY", role: "system", scheme: "system", time: formatNoteDateTime(),
      text: oldEdd ? `EDD changed from ${fmt(oldEdd)} to ${fmt(newEdd)}.` : `EDD set to ${fmt(newEdd)}.`,
    };
    const nextNotes = [...notes, systemNote];
    setNotes(nextNotes);
    try {
      const response = await fetch("/api/order-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop, orderId: eddModal.order.shopifyOrderId, variantId: eddModal.item.variantId,
          data: { eddDate: newEdd, originalEddDate: eddModal.item.originalEddDate || oldEdd || newEdd, notes: serializeNotes(nextNotes) },
        }),
      });
      if (!response.ok) { const e = await response.json(); throw new Error(e.error || `API error: ${response.status}`); }
      const payload = await response.json();
      const cin7Exists = Boolean(payload.cin7Exists);
      setDetailView((prev) => prev ? { ...prev, item: { ...prev.item, eddDate: newEdd, originalEddDate: eddModal.item.originalEddDate || oldEdd || newEdd, cin7Exists } } : prev);
      setRows((prevRows = []) => prevRows.map((o: any) => o.id !== eddModal.order.id ? o : {
        ...o, lineItems: o.lineItems.map((li: any) => li.variantId !== eddModal.item.variantId ? li : {
          ...li, eddDate: newEdd, originalEddDate: eddModal.item.originalEddDate || oldEdd || newEdd, cin7Exists,
        }),
      }));
      if (allRows) {
        setAllRows((prev) => prev ? prev.map((o) => o.id !== eddModal.order.id ? o : {
          ...o, lineItems: o.lineItems.map((li: any) => li.variantId !== eddModal.item.variantId ? li : {
            ...li, eddDate: newEdd, originalEddDate: eddModal.item.originalEddDate || oldEdd || newEdd, cin7Exists,
          }),
        }) : prev);
      }
      setEddModal(null);
      setEddForm({ newEdd: "", reason: "", notifyCustomer: false });
      if (detailView) {
        const res = await fetch(`/api/order-status?orderId=${encodeURIComponent(detailView.order.shopifyOrderId)}&shop=${encodeURIComponent(shop)}`);
        if (res.ok) { const j = await res.json(); const l = (j.lineItems ?? []).find((it: any) => it.variantId === detailView.item.variantId); setNotes(parseNotesString(l?.notes ?? "")); }
      }
    } catch (e) {
      setEddError(e instanceof Error ? e.message : "Failed to save EDD");
    } finally {
      setIsSavingEdd(false);
    }
  };

  // ── Tracking save ─────────────────────────────────────────────────────────
  const handleTrackingSave = async () => {
    if (!trackingModal || !trackingForm.trackingNumber) { setTrackingError("Please enter a tracking number before saving"); return; }
    setTrackingError("");
    setIsSavingTracking(true);
    const oldTracking = trackingModal.item.trackingNumber;
    const oldFreightRef = trackingModal.item.freightRef ?? "";
    const newFreightRef = trackingForm.freightRef.trim();

    const trackingNote: NoteItem = {
      author: "SY", role: "system", scheme: "system", time: formatNoteDateTime(),
      text: oldTracking
        ? `Tracking number updated from ${oldTracking} to ${trackingForm.trackingNumber}.`
        : `Tracking number set to ${trackingForm.trackingNumber}.`,
    };
    const notesToAdd = [trackingNote];
    if (newFreightRef && newFreightRef !== oldFreightRef) {
      notesToAdd.push({
        author: "SY", role: "system", scheme: "system", time: formatNoteDateTime(),
        text: oldFreightRef
          ? `Freight ref updated from ${oldFreightRef} to ${newFreightRef}.`
          : `Freight ref set to ${newFreightRef}.`,
      });
    }
    const nextNotes = [...notes, ...notesToAdd];
    setNotes(nextNotes);
    try {
      const response = await fetch("/api/order-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop, orderId: trackingModal.order.shopifyOrderId, variantId: trackingModal.item.variantId,
          data: {
            trackingNumber: trackingForm.trackingNumber,
            carrier: trackingForm.carrier,
            freightRef: newFreightRef,
            notes: serializeNotes(nextNotes),
          },
        }),
      });
      if (!response.ok) { const e = await response.json(); throw new Error(e.error || `API error: ${response.status}`); }
      const payload = await response.json();
      const cin7Exists = Boolean(payload.cin7Exists);
      setDetailView((prev) => prev ? { ...prev, item: { ...prev.item, trackingNumber: trackingForm.trackingNumber, company: trackingForm.carrier || prev.item.company, freightRef: newFreightRef, cin7Exists } } : prev);
      setRows((prevRows = []) => prevRows.map((o: any) => o.id !== trackingModal.order.id ? o : {
        ...o, lineItems: o.lineItems.map((li: any) => li.variantId !== trackingModal.item.variantId ? li : {
          ...li, trackingNumber: trackingForm.trackingNumber, company: trackingForm.carrier || li.company, freightRef: newFreightRef, cin7Exists,
        }),
      }));
      if (allRows) {
        setAllRows((prev) => prev ? prev.map((o) => o.id !== trackingModal.order.id ? o : {
          ...o, lineItems: o.lineItems.map((li: any) => li.variantId !== trackingModal.item.variantId ? li : {
            ...li, trackingNumber: trackingForm.trackingNumber, company: trackingForm.carrier || li.company, freightRef: newFreightRef, cin7Exists,
          }),
        }) : prev);
      }
      setTrackingModal(null);
      setTrackingForm({ carrier: "", trackingNumber: "", freightRef: "", deliveryMethod: "Standard", notifyCustomer: true });
      if (detailView) {
        const res = await fetch(`/api/order-status?orderId=${encodeURIComponent(detailView.order.shopifyOrderId)}&shop=${encodeURIComponent(shop)}`);
        if (res.ok) { const j = await res.json(); const l = (j.lineItems ?? []).find((it: any) => it.variantId === detailView.item.variantId); setNotes(parseNotesString(l?.notes ?? "")); }
      }
    } catch (e) {
      setTrackingError(e instanceof Error ? e.message : "Failed to save tracking");
    } finally {
      setIsSavingTracking(false);
    }
  };

  const handleFixCin7Mismatch = async (order: FreightOrderRow, item: FreightLineItem) => {
    const key = `${order.id}-${item.variantId}`;
    if (cin7FixingId) return;
    setCin7FixingId(key);
    try {
      const res = await fetch("/api/cin7-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop, orderId: order.shopifyOrderId,
          trackingNumber: item.trackingNumber, eddDate: item.eddDate, carrier: item.company,
          fields: item.cin7Mismatches,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.ok) throw new Error(payload.error || "Failed to sync mismatched fields to Cin7");

      const applyMatch = (o: FreightOrderRow): FreightOrderRow => o.id !== order.id ? o : {
        ...o,
        lineItems: o.lineItems.map((li) =>
          li.variantId !== item.variantId ? li : { ...li, cin7Status: "match" as const, cin7Mismatches: [] }
        ),
      };
      setRows((prev) => prev.map(applyMatch));
      if (allRows) setAllRows((prev) => prev ? prev.map(applyMatch) : prev);
      setSyncNotification("Cin7 fields updated");
    } catch (e) {
      setSyncNotification(e instanceof Error ? e.message : "Failed to update Cin7");
    } finally {
      setCin7FixingId(null);
      window.setTimeout(() => setSyncNotification(null), 4500);
    }
  };

  const handleCreateCin7Order = async (order: FreightOrderRow) => {
    if (creatingCin7OrderId) return;
    setCreatingCin7OrderId(order.id);
    try {
      const response = await fetch("/api/cin7-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop, orderId: order.shopifyOrderId }),
      });
      if (!response.ok) {
        const errorJson = await response.json().catch(() => null);
        throw new Error(errorJson?.error || `Failed to create Cin7 order (${response.status})`);
      }
      const payload = await response.json();
      if (!payload.ok) {
        throw new Error(payload.error || "Failed to create Cin7 order");
      }

      const cin7Exists = Boolean(payload.cin7SalesOrderId && payload.cin7SalesOrderId !== "pending");
      setRows((prevRows = []) => prevRows.map((o: any) => o.id !== order.id ? o : {
        ...o,
        lineItems: o.lineItems.map((li: any) => ({ ...li, cin7Exists, cin7Status: cin7Exists ? "match" : "missing", cin7Mismatches: [] })),
      }));
      if (allRows) {
        setAllRows((prev) => prev ? prev.map((o) => o.id !== order.id ? o : {
          ...o,
          lineItems: o.lineItems.map((li: any) => ({ ...li, cin7Exists, cin7Status: cin7Exists ? "match" : "missing", cin7Mismatches: [] })),
        }) : prev);
      }
      if (detailView?.order.id === order.id) {
        setDetailView((prev) => prev ? { ...prev, item: { ...prev.item, cin7Exists } } : prev);
      }
      setSyncNotification("Cin7 order created successfully");
    } catch (e) {
      setSyncNotification(e instanceof Error ? e.message : "Failed to create Cin7 order");
    } finally {
      setCreatingCin7OrderId(null);
      window.setTimeout(() => setSyncNotification(null), 4500);
    }
  };

  const handleBulkSync = async () => {
    const syncOrders = allRows ?? rows;
    const totalItems = syncOrders.reduce((count, order) => count + order.lineItems.length, 0);
    if (totalItems === 0) return;

    const startAt = Date.now();
    setSyncProgress({
      total: totalItems,
      completed: 0,
      created: 0,
      updated: 0,
      already: 0,
      failed: 0,
      entries: [],
      startedAt: startAt,
      estimatedSecondsLeft: 0,
    });
    setSyncProgressOpen(false);
    setSyncNotification(null);
    setIsSyncing(true);

    const updateProgress = (update: (prev: SyncProgressState) => SyncProgressState) => {
      setSyncProgress((prev) => {
        if (!prev) return prev;
        const next = update(prev);
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - prev.startedAt) / 1000));
        const remaining = next.completed > 0
          ? Math.round((elapsedSeconds / next.completed) * (next.total - next.completed))
          : Math.round((next.total - next.completed) * 2);
        return { ...next, estimatedSecondsLeft: remaining };
      });
    };

    const itemsToSync = syncOrders.flatMap((order) =>
      order.lineItems.map((item) => ({ order, item }))
    );

    const processItem = async (order: FreightOrderRow, item: FreightLineItem) => {
      const entry: SyncProgressEntry = {
        id: `${order.shopifyOrderId}-${item.variantId}`,
        label: `${order.shopifyOrderName}${item.letterSuffix}`,
        status: "failed",
        message: "Failed to sync",
      };

      try {
        const res = await fetch("/api/monday-sync-create-or-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shop,
            orderId: order.shopifyOrderId,
            variantId: item.variantId,
            itemName: `${order.shopifyOrderName}${item.letterSuffix}`,
            row: {
              customerName: order.customerName,
              email: order.email,
              carriers: item.company,
              trackingNumber: item.trackingNumber,
              eddDate: item.eddDate,
              originalEddDate: item.originalEddDate,
              productTitle: item.title ?? "",
              sku: item.sku ?? "",
              boxes: item.boxes ?? "",
              customerStatus: item.customerStatus,
            },
          }),
        });

        if (!res.ok) {
          updateProgress((prev) => ({
            ...prev,
            completed: prev.completed + 1,
            failed: prev.failed + 1,
            entries: [...prev.entries, entry],
          }));
          return;
        }

        const json = await res.json();
        const status: SyncProgressEntry["status"] =
          json.syncStatus === "created" ? "created" :
            json.syncStatus === "updated" ? "updated" :
              "already-there";
        entry.status = status;
        entry.message =
          status === "created" ? "Created in Monday" :
            status === "updated" ? "Updated in Monday" :
              "Already in Monday";

        const updatedLineItem = {
          ...item,
          ...json.updated,
          trackingNumber: json.updated?.trackingNumber ?? item.trackingNumber ?? "",
          eddDate: json.updated?.eddDate ?? item.eddDate ?? "",
          originalEddDate: json.updated?.originalEddDate ?? item.originalEddDate ?? "",
          customerStatus: json.updated?.customerStatus ?? item.customerStatus ?? "",
          company: json.updated?.carrier ?? item.company ?? "",
          title: json.updated?.productTitle ?? item.title ?? "",
        };

        updateProgress((prev) => ({
          ...prev,
          completed: prev.completed + 1,
          created: prev.created + (status === "created" ? 1 : 0),
          updated: prev.updated + (status === "updated" ? 1 : 0),
          already: prev.already + (status === "already-there" ? 1 : 0),
          entries: [...prev.entries, entry],
        }));

        setRows((prevRows = []) => prevRows.map((o: any) => o.id !== order.id ? o : {
          ...o,
          lineItems: o.lineItems.map((li: any) => li.variantId !== item.variantId ? li : { ...li, ...updatedLineItem }),
        }));

        if (allRows) {
          setAllRows((prev) => prev ? prev.map((o) => o.id !== order.id ? o : {
            ...o,
            lineItems: o.lineItems.map((li: any) => li.variantId !== item.variantId ? li : { ...li, ...updatedLineItem }),
          }) : prev);
        }

        setDetailView((prev) => prev && prev.order.shopifyOrderId === order.shopifyOrderId && prev.item.variantId === item.variantId
          ? { ...prev, item: { ...prev.item, ...updatedLineItem } }
          : prev);
      } catch (error) {
        console.error("Monday bulk sync failed", error);
        updateProgress((prev) => ({
          ...prev,
          completed: prev.completed + 1,
          failed: prev.failed + 1,
          entries: [...prev.entries, entry],
        }));
      }
    };

    const concurrency = 3;
    const queue = itemsToSync.slice();
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0) {
        const job = queue.shift();
        if (!job) break;
        await processItem(job.order, job.item);
      }
    });

    try {
      await Promise.all(workers);
      setLastSyncAt(Date.now());
      setSyncNotification("Sync completed successfully");
      setSyncProgressOpen(false);
      window.setTimeout(() => {
        setSyncProgress(null);
        setSyncNotification(null);
      }, 5500);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSync = async () => {
    if (!detailView) return;
    setIsSyncing(true);
    try {
      const res = await fetch("/api/monday-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop,
          orderId: detailView.order.shopifyOrderId,
          variantId: detailView.item.variantId,
          itemName: `${detailView.order.shopifyOrderName}${detailView.item.letterSuffix}`,
          row: {
            customerName: detailView.order.customerName,
            email: detailView.order.email,
            carriers: detailView.item.company,
            trackingNumber: detailView.item.trackingNumber,
            eddDate: detailView.item.eddDate,
            originalEddDate: detailView.item.originalEddDate,
            productTitle: detailView.item.title ?? "",
            sku: detailView.item.sku ?? "",
            boxes: detailView.item.boxes ?? "",
            customerStatus: detailView.item.customerStatus,
          },
        }),
      });
      if (!res.ok) throw new Error("Sync failed");
      const json = await res.json();
      setDetailView((prev) => prev ? { ...prev, item: { ...prev.item, ...json.updated } } : prev);
      setRows((prevRows = []) => prevRows.map((o: any) => o.id !== detailView.order.id ? o : {
        ...o, lineItems: o.lineItems.map((li: any) => li.variantId !== detailView.item.variantId ? li : { ...li, ...json.updated }),
      }));
      if (allRows) {
        setAllRows((prev) => prev ? prev.map((o) => o.id !== detailView.order.id ? o : {
          ...o, lineItems: o.lineItems.map((li: any) => li.variantId !== detailView.item.variantId ? li : { ...li, ...json.updated }),
        }) : prev);
      }
      // ── NEW: refresh notes — sync may have pulled in new Monday comments
      const notesRes = await fetch(`/api/order-status?orderId=${encodeURIComponent(detailView.order.shopifyOrderId)}&shop=${encodeURIComponent(shop)}`);
      if (notesRes.ok) {
        const notesJson = await notesRes.json();
        const line = (notesJson.lineItems ?? []).find((it: any) => it.variantId === detailView.item.variantId);
        setNotes(parseNotesString(line?.notes ?? ""));
      }
    } catch (e) {
      console.error("Monday sync failed", e);
    } finally {
      setIsSyncing(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="fo-root">
        {/* ── Navbar ── */}
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
              <input
                className="fo-nav-search"
                placeholder="Search by order #, customer, carrier…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          {/* Slot: each route passes its own avatar/menu/logout here */}
          <div className="fo-nav-right">{navbarRight}</div>
        </nav>

        <div className="fo-body">
          {/* ── Stat cards ── */}
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

          {/* ── Main card ── */}
          <div className="fo-card">
            {/* Tabs */}
            <div className="fo-tabs">
              {TABS.map((tab) => (
                <button key={tab.key} className={`fo-tab${activeTab === tab.key ? " active" : ""}`} onClick={() => setActiveTab(tab.key)}>
                  {tab.label}
                  <span className="fo-tab-pill" style={activeTab === tab.key ? { background: tab.color, color: "#fff" } : {}}>
                    {tab.key === "all" ? totalLineItems : tab.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Toolbar */}
            <div className="fo-toolbar">
              <label className="fo-select-label">
                <input type="checkbox" className="fo-checkbox"
                  checked={selected.size === filteredOrders.length && filteredOrders.length > 0}
                  onChange={toggleSelectAll}
                />
                {selected.size > 0 ? `${selected.size} selected` : "0 selected"}
              </label>
              <div className="fo-toolbar-right" style={{ alignItems: "flex-end" }}>
                <select className="fo-status-select">
                  <option>All statuses</option><option>Paid</option><option>Pending</option><option>Authorized</option>
                </select>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "6px" }}>
                  {lastSyncAt && !isSyncing && (
                    <div style={{ fontSize: "12px", color: "#6b7280" }}>
                      Last sync: {formatRelativeTime(Date.now() - lastSyncAt)}
                    </div>
                  )}
                  <button className="fo-tool-btn" onClick={handleBulkSync} disabled={isSyncing || (allRows ?? rows).length === 0}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                    {isSyncing ? "Syncing all pages..." : "Sync all pages"}
                  </button>
                </div>
                <button className="fo-tool-btn">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="11" y1="18" x2="13" y2="18" /></svg>
                  Filter
                </button>
                <button className="fo-tool-btn">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
                  Columns
                </button>
              </div>
            </div>
            {syncNotification ? (
              <div className="fo-sync-progress" style={{ marginTop: "14px", padding: "16px", border: "1px solid #d1fae5", borderRadius: "12px", background: "#ecfdf5", color: "#065f46" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700 }}>
                    {syncNotification}
                  </span>
                  <span style={{ fontSize: "12px", color: "#065f46" }}>
                    {syncProgress ? `${syncProgress.completed} / ${syncProgress.total} line items processed` : ""}
                  </span>
                </div>
              </div>
            ) : syncProgress && (
              <div className="fo-sync-progress" style={{ marginTop: "14px", padding: "16px", border: "1px solid #e5e7eb", borderRadius: "12px", background: "#f8fafc" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "#111827" }}>Monday bulk sync progress</div>
                    <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>
                      {syncProgress.completed} / {syncProgress.total} line items processed · Created {syncProgress.created} · Updated {syncProgress.updated} · Already there {syncProgress.already} · Failed {syncProgress.failed}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
                    <span style={{ fontSize: "12px", color: "#2563eb", fontWeight: 700 }}>Background sync running</span>
                    <span style={{ fontSize: "11px", color: "#6b7280" }}>
                      Estimated remaining: {formatSeconds(syncProgress.estimatedSecondsLeft)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSyncProgressOpen((open) => !open)}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "#2563eb",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      fontSize: "12px",
                      fontWeight: 700,
                      padding: "6px 8px",
                      borderRadius: "8px",
                    }}
                  >
                    {syncProgressOpen ? "Hide details" : "Show details"}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: syncProgressOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                </div>
                <div style={{ marginTop: "12px", minHeight: "8px" }}>
                  <div style={{ height: "8px", borderRadius: "999px", background: "#e2e8f0", overflow: "hidden" }}>
                    <div style={{ width: `${Math.round((syncProgress.completed / syncProgress.total) * 100)}%`, height: "100%", background: "#2563eb" }} />
                  </div>
                </div>
                {syncProgressOpen && (
                  <div style={{ marginTop: "12px", display: "grid", gap: "8px" }}>
                    {syncProgress.entries.slice(-5).map((entry) => (
                      <div key={entry.id} style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", fontSize: "12px", color: "#374151" }}>
                        <span>{entry.label}</span>
                        <span style={{
                          color:
                            entry.status === "created" ? "#15803d" :
                              entry.status === "updated" ? "#7c3aed" :
                                entry.status === "already-there" ? "#1d4ed8" :
                                  "#b91c1c",
                          fontWeight: 700,
                        }}>
                          {entry.message}
                        </span>
                      </div>
                    ))}
                    {syncProgress.entries.length > 5 && (
                      <div style={{ fontSize: "11px", color: "#6b7280" }}>Showing last 5 entries</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Detail View ── */}
            {detailView ? (
              <div className="fo-detail-wrap">
                <div className="fo-detail-bar">
                  <div className="fo-detail-bar-left">
                    <button className="fo-icon-btn" onClick={() => setDetailView(null)} title="Back">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
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
                    <button className="fo-detail-action-btn" onClick={() => { setNoteModal(true); setNoteTab("internal"); setNoteText(""); }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                      Add note
                    </button>
                    <button className="fo-detail-action-btn"
                      onClick={() => { setEddModal({ order: detailView.order, item: detailView.item }); setEddForm({ newEdd: detailView.item.eddDate, reason: "", notifyCustomer: false }); }}>
                      <IconCalendar /> Update EDD
                    </button>
                    <button className="fo-detail-action-btn"
                      onClick={() => { setTrackingModal({ order: detailView.order, item: detailView.item }); setTrackingForm({ carrier: detailView.item.company || "", trackingNumber: "", freightRef: "", deliveryMethod: "Standard", notifyCustomer: true }); }}>
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
                  {/* LEFT */}
                  <div className="fo-detail-left">
                    <div className="fo-detail-panel">
                      <div className="fo-detail-panel-hdr">Line Item Order</div>
                      <div className="fo-detail-row">
                        <span className="fo-detail-label">Line order #</span>
                        <span className="fo-detail-value">
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 8px", borderRadius: "5px", background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", fontSize: "11px", fontWeight: 700 }}>
                            #{detailView.order.shopifyOrderName} <span style={{ background: "#bfdbfe", borderRadius: "3px", padding: "0 4px", fontSize: "10px" }}>{detailView.item.letterSuffix}</span>
                          </span>
                        </span>
                      </div>
                      <div className="fo-detail-row"><span className="fo-detail-label">Parent order #</span><span className="fo-detail-value">{detailView.order.shopifyOrderName}</span></div>
                      <div className="fo-detail-row"><span className="fo-detail-label">Product</span><span className="fo-detail-value">{detailView.item.title ?? "—"}</span></div>
                      <div className="fo-detail-row">
                        <span className="fo-detail-label">SKU</span>
                        <span className="fo-detail-value" style={{ fontFamily: "monospace", fontSize: "12px" }}>{detailView.item.variantId ? `VAR-${detailView.item.variantId.slice(-6)}` : "—"}</span>
                      </div>
                      <div className="fo-detail-row"><span className="fo-detail-label">Quantity</span><span className="fo-detail-value">{detailView.item.boxes || 1}</span></div>
                      <div className="fo-detail-row">
                        <span className="fo-detail-label">Order date</span>
                        <span className="fo-detail-value">{new Date(detailView.order.createdAt).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}</span>
                      </div>
                    </div>

                    <div className="fo-detail-panel">
                      <div className="fo-detail-panel-hdr">Customer</div>
                      <div className="fo-detail-row"><span className="fo-detail-label">Name</span><span className="fo-detail-value">{detailView.order.customerName || "—"}</span></div>
                      <div className="fo-detail-row"><span className="fo-detail-label">Email</span><span className="fo-detail-value"><a href={`mailto:${detailView.order.email}`} style={{ color: "#2563eb", textDecoration: "none", fontSize: "12px" }}>{detailView.order.email || "—"}</a></span></div>
                      <div className="fo-detail-row"><span className="fo-detail-label">Phone</span><span className="fo-detail-value">{detailView.order.phone || "—"}</span></div>
                      <div className="fo-detail-row">
                        <span className="fo-detail-label">Customer status</span>
                        <span className="fo-detail-value">
                          <span style={{ padding: "2px 10px", borderRadius: "9px", fontSize: "11px", fontWeight: 600, background: getCustomerStatusStyle(detailView.item.customerStatus).bg, color: getCustomerStatusStyle(detailView.item.customerStatus).text }}>
                            {getCustomerStatusStyle(detailView.item.customerStatus).label || "—"}
                          </span>
                        </span>
                      </div>
                    </div>

                    <div className="fo-detail-panel">
                      <div className="fo-detail-panel-hdr">Dispatch & Freight</div>
                      <div className="fo-detail-row">
                        <span className="fo-detail-label">Current EDD</span>
                        <span className="fo-detail-value" style={{ color: "#166534" }}>
                          {detailView.item.eddDate ? new Date(detailView.item.eddDate).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                        </span>
                      </div>
                      <div className="fo-detail-row">
                        <span className="fo-detail-label">Original EDD</span>
                        <span className="fo-detail-value">
                          {detailView.item.originalEddDate && detailView.item.originalEddDate !== detailView.item.eddDate
                            ? <span style={{ textDecoration: "line-through", color: "#b91c1c" }}>{new Date(detailView.item.originalEddDate).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}</span>
                            : "—"}
                        </span>
                      </div>
                      <div className="fo-detail-row"><span className="fo-detail-label">Carrier</span><span className="fo-detail-value" style={{ color: "#2563eb" }}>{companyLabels[detailView.item.company as keyof typeof companyLabels] ?? detailView.item.company ?? "—"}</span></div>
                      <div className="fo-detail-row"><span className="fo-detail-label">Tracking #</span><span className="fo-detail-value">{detailView.item.trackingNumber ? <span style={{ color: "#2563eb" }}>{detailView.item.trackingNumber}</span> : "—"}</span></div>
                      <div className="fo-detail-row"><span className="fo-detail-label">Freight ref</span><span className="fo-detail-value">{detailView.item.freightRef || "—"}</span></div>
                      <div className="fo-detail-row"><span className="fo-detail-label">Delivery method</span><span className="fo-detail-value">Standard</span></div>
                    </div>

                    <div className="fo-detail-panel">
                      <div className="fo-detail-panel-hdr">Sync Status</div>
                      {(["Cin7", "Shopify"] as const).map((lbl) => {
                        const isCin7 = lbl === "Cin7";
                        const isOk = isCin7 ? Boolean(detailView.item.cin7Exists) : true;
                        return (
                          <div className="fo-detail-row" key={lbl}>
                            <span className="fo-detail-label">{lbl}</span>
                            <span style={{ color: isOk ? "#16a34a" : "#dc2626" }}>
                              {isOk ? (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="9 12 11 14 15 10" /></svg>
                              ) : (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="8" y1="8" x2="16" y2="16" /><line x1="16" y1="8" x2="8" y2="16" /></svg>
                              )}
                            </span>
                          </div>
                        );
                      })}
                      <div className="fo-detail-row">
                        <span className="fo-detail-label">Last updated</span>
                        <span className="fo-detail-value">Today 09:41 · {detailView.order.customerName.split(" ")[0]}</span>
                      </div>
                    </div>
                  </div>

                  {/* RIGHT — Notes */}
                  <div className="fo-detail-right">
                    <div className="fo-notes-hdr">
                      Notes & Customer History
                      <button className="fo-notes-add-btn" onClick={() => { setNoteModal(true); setNoteTab("internal"); setNoteText(""); }}>
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
                </div>
              </div>

            ) : filteredOrders.length === 0 ? (
              <div className="fo-empty">
                <div className="fo-empty-icon">📦</div>
                <div className="fo-empty-title">No freight orders found</div>
                <div className="fo-empty-sub">{search ? "Try a different search term." : "Orders appear here after checkout completes."}</div>
              </div>
            ) : (
              <div className="fo-table-scroll">
                <table className="fo-table">
                  <thead>
                    <tr>
                      <th><input type="checkbox" className="fo-checkbox" checked={selected.size === filteredOrders.length && filteredOrders.length > 0} onChange={toggleSelectAll} /></th>
                      <th>Line order #</th><th>Customer</th><th>Product / SKU</th><th>Qty</th>
                      <th>EDD (current / orig)</th><th>Customer status</th><th>Carrier</th>
                      <th>Tracking #</th><th>Freight ref</th><th>Cin7</th><th>Shopify</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.flatMap((order, idx) => {
                      const isSelected = selected.has(order.id);
                      const chipColor = orderLetterColors[idx % orderLetterColors.length];
                      const carrierList = order.carriers.split(",").map((c) => c.trim()).filter(Boolean);

                      return order.lineItems.map((item, liIdx) => {
                        const isFirstItem = liIdx === 0;
                        const { bg: stBg, text: stText, label: stLabel } = getCustomerStatusStyle(item.customerStatus);
                        const statusClass = item.customerStatus ? `fo-fulfil ${item.customerStatus.toLowerCase()}` : "fo-fulfil none";

                        return (
                          <tr key={item.id} style={{ background: isSelected ? "#eff6ff" : undefined }}>
                            <td className="fo-td">
                              <input type="checkbox" className="fo-checkbox" checked={isSelected} onChange={() => toggleSelect(order.id)} />
                            </td>
                            <td className="fo-td">
                              {isFirstItem ? (
                                <span className="fo-order-chip">
                                  <span className="fo-order-letter" style={{ background: chipColor + "33", color: chipColor }}>{item.letterSuffix}</span>
                                  {order.shopifyOrderName}
                                </span>
                              ) : (
                                <span className="fo-line-chip">
                                  <span className="fo-order-letter" style={{ background: chipColor + "22", color: chipColor }}>{item.letterSuffix}</span>
                                  {order.shopifyOrderName}
                                </span>
                              )}
                            </td>
                            <td className="fo-td">
                              <div className="fo-cust-name">{order.customerName}</div>
                              <div className="fo-cust-email">{order.email}</div>
                            </td>
                            <td className="fo-td">
                              <div className="fo-prod-name">{item.title ?? <span style={{ fontFamily: "monospace", fontSize: "11px", color: "#9ca3af" }}>#{item.variantId}</span>}</div>
                              {item.variantId && <div className="fo-prod-sku">VAR-{item.variantId.slice(-6)}</div>}
                            </td>
                            <td className="fo-td"><span className="fo-qty-cell">{item.boxes || 1}</span></td>
                            <td className="fo-td">
                              <div className="fo-edd-wrap">
                                {item.eddDate ? (
                                  <>
                                    <div style={{ display: "grid", gap: "4px", marginBottom: "6px" }}>
                                      <div className="fo-edd-current" style={{ color: "#166534", fontWeight: 600 }}>
                                        {new Date(item.eddDate).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}
                                      </div>
                                      {item.originalEddDate && item.originalEddDate !== item.eddDate && (
                                        <div style={{ color: "#b91c1c", textDecoration: "line-through", fontSize: "12px" }}>
                                          {new Date(item.originalEddDate).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}
                                        </div>
                                      )}
                                    </div>
                                    <button style={{ display: "flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: 0, color: "#9ca3af" }}
                                      onClick={() => { setEddModal({ order, item }); setEddForm({ newEdd: item.eddDate, reason: "", notifyCustomer: false }); }}>
                                      <IconCalendar />
                                    </button>
                                  </>
                                ) : (
                                  <button style={{ display: "flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: 0, color: "#9ca3af" }}
                                    onClick={() => { setEddModal({ order, item }); setEddForm({ newEdd: "", reason: "", notifyCustomer: false }); }}>
                                    <IconCalendar />
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="fo-td"><span className="fo-cust-status" style={{ background: stBg, color: stText }}>{stLabel || "—"}</span></td>
                            <td className="fo-td">
                              {isFirstItem ? (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                                  {carrierList.map((c) => <span key={c} className="fo-carrier-badge">{companyLabels[c as keyof typeof companyLabels] ?? c}</span>)}
                                </div>
                              ) : (
                                <span className="fo-carrier-badge">{companyLabels[item.company as keyof typeof companyLabels] ?? item.company}</span>
                              )}
                            </td>
                            <td className="fo-td">
                              {item.trackingNumber ? (
                                <button
                                  className="fo-tracking-num"
                                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit" }}
                                  onClick={() => {
                                    setTrackingModal({ order, item });
                                    setTrackingForm({
                                      carrier: item.company || "",
                                      trackingNumber: item.trackingNumber,
                                      freightRef: item.freightRef || getRefPrefix(item.company || ""),
                                      deliveryMethod: "Standard",
                                      notifyCustomer: true,
                                    });
                                  }}
                                >
                                  {item.trackingNumber}
                                </button>
                              ) : (
                                <button className="fo-tracking-add"
                                  onClick={() => { setTrackingModal({ order, item }); setTrackingForm({ carrier: item.company || "", trackingNumber: "", freightRef: getRefPrefix(item.company || ""), deliveryMethod: "Standard", notifyCustomer: true }); }}>
                                  <IconPlus /> Add
                                </button>
                              )}
                            </td>
                            <td className="fo-td" style={{ fontSize: "12px", color: "#6b7280" }}>
                              {item.freightRef || "—"}
                            </td>
                            <td className="fo-td">
                              {(() => {
                                const status = getCin7CellStatus(item);
                                const cellKey = `${order.id}-${item.variantId}`;

                                if (status === "match") {
                                  return <span className="fo-circle green">✓</span>;
                                }
                                if (status === "error") {
                                  return (
                                    <span
                                      className="fo-circle"
                                      title="Order is voided or duplicated in Cin7 — cannot sync"
                                      style={{ color: "#f59e0b", background: "#fffbeb", border: "none", padding: 0, minWidth: "24px", minHeight: "24px", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}
                                    >
                                      ⚠️
                                    </span>
                                  );
                                }
                                if (status === "mismatch") {
                                  return (
                                    <button
                                      type="button"
                                      className="fo-circle"
                                      title={`Out of sync: ${(item.cin7Mismatches ?? []).join(", ")}. Click to update Cin7.`}
                                      onClick={() => handleFixCin7Mismatch(order, item)}
                                      disabled={cin7FixingId === cellKey}
                                      style={{ color: "#92400e", background: "#fef3c7", border: "none", padding: 0, minWidth: "24px", minHeight: "24px", cursor: cin7FixingId === cellKey ? "wait" : "pointer" }}
                                    >
                                      !
                                    </button>
                                  );
                                }
                                return (
                                  <button
                                    type="button"
                                    className="fo-circle"
                                    title="Create order in Cin7"
                                    onClick={() => handleCreateCin7Order(order)}
                                    disabled={creatingCin7OrderId === order.id}
                                    style={{
                                      color: "#dc2626",
                                      background: "#fee2e2",
                                      border: "none",
                                      padding: 0,
                                      minWidth: "24px",
                                      minHeight: "24px",
                                      cursor: creatingCin7OrderId === order.id ? "wait" : "pointer",
                                    }}
                                  >
                                    ✕
                                  </button>
                                );
                              })()}
                            </td>
                            <td className="fo-td"><span className="fo-circle green">✓</span></td>
                            <td className="fo-td">
                              <div className="fo-act-wrap">
                                <div className="fo-act-row">
                                  <button className="fo-icon-btn" title="View order" onClick={() => { setDetailView({ order, item }); setNotes([]); }}><IconEye /></button>
                                  <button className="fo-icon-btn" title="Notes" onClick={() => { setNoteModalTarget({ order, item }); setNoteModal(true); setNoteTab("internal"); setNoteText(""); }}><IconChat /></button>
                                </div>
                                <span className={statusClass} style={{ background: stBg, color: stText }}>{stLabel.toUpperCase() || "NOT SET"}</span>
                              </div>
                            </td>
                          </tr>
                        );
                      });
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {pageCount > 1 && (
              <div className="fo-pagination">
                <button
                  className="fo-page-btn"
                  disabled={currentPage <= 1}
                  onClick={() => {
                    const newPage = Math.max(1, currentPage - 1);
                    if (allRows) {
                      setCurrentPage(newPage);
                      setRows(allRows.slice((newPage - 1) * 25, newPage * 25));
                      return;
                    }
                    const np = new URLSearchParams(Array.from(searchParams.entries()));
                    np.set("page", String(newPage));
                    setSearchParams(np);
                  }}
                >← Previous</button>
                <span className="fo-page-info">Page {currentPage} of {pageCount}</span>
                <button
                  className="fo-page-btn"
                  disabled={currentPage >= pageCount}
                  onClick={() => {
                    const newPage = Math.min(pageCount, currentPage + 1);
                    if (allRows) {
                      setCurrentPage(newPage);
                      setRows(allRows.slice((newPage - 1) * 25, newPage * 25));
                      return;
                    }
                    const np = new URLSearchParams(Array.from(searchParams.entries()));
                    np.set("page", String(newPage));
                    setSearchParams(np);
                  }}
                >Next →</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Tracking Modal ── */}
      {trackingModal && (
        <div className="fo-overlay" onClick={() => { setTrackingModal(null); setTrackingError(""); }}>
          <div className="fo-modal" style={{ width: "560px", maxWidth: "95vw" }} onClick={(e) => e.stopPropagation()}>
            <div className="fo-modal-hdr" style={{ borderBottom: "1px solid #e5e7eb", padding: "16px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "18px" }}>🚛</span>
                <span className="fo-modal-title" style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>
                  Add / edit tracking — <span style={{ color: "#2563eb" }}>{trackingModal.order.shopifyOrderName}</span> {trackingModal.item.letterSuffix}
                </span>
              </div>
              <button className="fo-modal-close" onClick={() => { setTrackingModal(null); setTrackingError(""); }}>✕</button>
            </div>
            <div style={{ padding: "12px 20px", borderBottom: "1px solid #e5e7eb" }}>
              <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "6px", padding: "12px 16px" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>{trackingModal.item.title ?? `#${trackingModal.item.variantId}`}</div>
                {trackingModal.item.variantId && <div style={{ fontSize: "12px", color: "#475569", marginTop: "3px" }}>— VAR-{trackingModal.item.variantId.slice(-6)}</div>}
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
                  <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "3px" }}>Sends dispatch email to {trackingModal.order.email}</div>
                </div>
                <button type="button" onClick={() => setTrackingForm((p) => ({ ...p, notifyCustomer: !p.notifyCustomer }))}
                  style={{ flexShrink: 0, width: "44px", height: "24px", borderRadius: "12px", background: trackingForm.notifyCustomer ? "#2563eb" : "#d1d5db", border: "none", cursor: "pointer", position: "relative", transition: "background 0.2s" }}>
                  <span style={{ position: "absolute", top: "2px", left: trackingForm.notifyCustomer ? "22px" : "2px", width: "20px", height: "20px", borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                </button>
              </div>
            </div>
            <div className="fo-modal-ftr" style={{ padding: "12px 20px" }}>
              <button className="fo-btn-ghost" onClick={() => { setTrackingModal(null); setTrackingError(""); }}>Cancel</button>
              <button type="button" style={{ padding: "8px 20px", fontSize: "13px", fontWeight: 600, borderRadius: "6px", background: "#111827", color: "#fff", border: "none", cursor: "pointer" }}
                onClick={handleTrackingSave} disabled={isSavingTracking}>
                {isSavingTracking ? "Saving..." : "Save & mark dispatched"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDD Modal ── */}
      {eddModal && (
        <div className="fo-overlay" onClick={() => { setEddModal(null); setEddError(""); }}>
          <div style={{ background: "#fff", borderRadius: "10px", width: "500px", maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #e5e7eb" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "16px" }}>📅</span>
                <span style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>
                  Update EDD — <span style={{ color: "#2563eb" }}>{eddModal.order.shopifyOrderName}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "20px", height: "20px", borderRadius: "4px", background: "#dbeafe", color: "#1d4ed8", fontSize: "10px", fontWeight: 700, marginLeft: "6px" }}>{eddModal.item.letterSuffix}</span>
                </span>
              </div>
              <button className="fo-modal-close" onClick={() => { setEddModal(null); setEddError(""); }}>✕</button>
            </div>
            <div style={{ padding: "10px 20px", borderBottom: "1px solid #e5e7eb" }}>
              <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "6px", padding: "10px 14px", fontSize: "13px", fontWeight: 600, color: "#1e40af" }}>
                {eddModal.item.title ?? `#${eddModal.item.variantId}`}
                {eddModal.item.variantId && <span style={{ color: "#3b82f6", marginLeft: "8px", fontWeight: 500 }}>— VAR-{eddModal.item.variantId.slice(-6)}</span>}
              </div>
            </div>
            <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
              {eddError && <div style={{ padding: "10px 12px", borderRadius: "6px", background: "#fee2e2", border: "1px solid #fecaca", color: "#991b1b", fontSize: "13px" }}>{eddError}</div>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "#374151", marginBottom: "6px" }}>Original EDD</label>
                  <input type="text" readOnly
                    value={(() => { const d = eddModal.item.originalEddDate || eddModal.item.eddDate; if (!d) return eddForm.newEdd ? new Date(eddForm.newEdd).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : "Not set"; return new Date(d).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }); })()}
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
                  <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "3px" }}>Toggle on to send EDD update to {eddModal.order.email}</div>
                </div>
                <button type="button" onClick={() => setEddForm((p) => ({ ...p, notifyCustomer: !p.notifyCustomer }))}
                  style={{ flexShrink: 0, width: "44px", height: "24px", borderRadius: "12px", background: eddForm.notifyCustomer ? "#2563eb" : "#d1d5db", border: "none", cursor: "pointer", position: "relative", transition: "background 0.2s" }}>
                  <span style={{ position: "absolute", top: "2px", left: eddForm.notifyCustomer ? "22px" : "2px", width: "20px", height: "20px", borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                </button>
              </div>
            </div>
            <div style={{ padding: "12px 20px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button className="fo-btn-ghost" onClick={() => { setEddModal(null); setEddError(""); }}>Cancel</button>
              <button type="button" style={{ padding: "8px 20px", fontSize: "13px", fontWeight: 600, borderRadius: "6px", background: "#2563eb", color: "#fff", border: "none", cursor: "pointer" }}
                onClick={handleEddSave} disabled={isSavingEdd}>
                {isSavingEdd ? "Saving…" : "Update EDD"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Note Modal ── */}
      {noteModal && activeNoteTarget && (
        <div className="fo-overlay" onClick={() => { setNoteModal(false); setNoteModalTarget(null); }}>
          <div className="fo-modal" style={{ width: "min(560px, 95vw)" }} onClick={(e) => e.stopPropagation()}>
            <div className="fo-modal-hdr">
              <div className="fo-modal-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "6px" }}>
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                Add note — <span style={{ fontWeight: 400, color: "#6b7280" }}>#{activeNoteTarget.order.shopifyOrderName}{activeNoteTarget.item.letterSuffix}</span>
              </div>
              <button className="fo-modal-close" onClick={() => { setNoteModal(false); setNoteModalTarget(null); }}>✕</button>
            </div>
            <div style={{ padding: "12px", background: "#f3f4f6", borderBottom: "1px solid #e5e7eb" }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#111827" }}>
                {activeNoteTarget.item.title ?? `#${activeNoteTarget.item.variantId}`}
                {activeNoteTarget.item.variantId && <span style={{ fontWeight: 400, color: "#6b7280", marginLeft: "4px" }}>— VAR-{activeNoteTarget.item.variantId.slice(-6)}</span>}
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
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
                placeholder={noteTab === "internal" ? "Write an internal note…" : "Write a message for the customer…"}
                style={{ width: "100%", padding: "10px 12px", border: "1px solid #e5e7eb", borderRadius: "8px", fontSize: "13px", outline: "none", fontFamily: "inherit", color: "#111827", resize: "vertical", minHeight: "100px" }}
                autoFocus />
            </div>
            <div style={{ display: "flex", gap: "8px", padding: "12px", borderTop: "1px solid #e5e7eb", justifyContent: "flex-end" }}>
              <button style={{ padding: "6px 16px", fontSize: "13px", fontWeight: 500, borderRadius: "6px", border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", cursor: "pointer" }}
                onClick={() => { setNoteModal(false); setNoteModalTarget(null); }}>Cancel</button>
              <button style={{ padding: "6px 16px", fontSize: "13px", fontWeight: 500, borderRadius: "6px", border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}
                onClick={async () => {
                  if (!noteText.trim() || !activeNoteTarget) return;
                  const newNoteEntry: NoteItem = {
                    author: noteAuthor,
                    role: noteTab === "internal" ? "internal" : "customer",
                    scheme: noteTab,
                    time: formatNoteDateTime(),
                    text: noteText.trim(),
                  };
                  const nextNotes = [...notes, newNoteEntry];
                  try {
                    const res = await fetch("/api/order-status", {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ shop, orderId: activeNoteTarget.order.shopifyOrderId, variantId: activeNoteTarget.item.variantId, data: { notes: serializeNotes(nextNotes) } }),
                    });
                    if (!res.ok) {
                      const e = await res.json().catch(() => ({}));
                      console.error("Failed to save note:", e);
                      return; // don't close modal on failure
                    }
                    setNotes(nextNotes);
                    setNoteText("");
                    setNoteModal(false);
                    setNoteModalTarget(null);
                  } catch (error) {
                    console.error("Failed to save note", error);
                  }
                }}
              >
                Save note
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}