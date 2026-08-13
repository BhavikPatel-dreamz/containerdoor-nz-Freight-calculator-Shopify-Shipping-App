/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FreightLineItem, FreightOrderRow, NoteItem } from "./types";

export function getCustomerStatusStyle(status: string, colorHex?: string): { bg: string; text: string; label: string } {
  if (colorHex && colorHex.trim()) {
    return { bg: colorHex.trim(), text: "#ffffff", label: status || "—" };
  }
  switch ((status || "").toLowerCase()) {
    case "dispatched": return { bg: "#e8697d", text: "#ffffff", label: "Dispatched" };
    case "delivered": return { bg: "#339ecd", text: "#ffffff", label: "Delivered" };
    case "confirmed": return { bg: "#33d391", text: "#ffffff", label: "Confirmed" };
    case "cancelled": return { bg: "#b57de3", text: "#ffffff", label: "Cancelled" };
    case "pending": return { bg: "#fdbc64", text: "#ffffff", label: "Pending" };
    default: return { bg: "#c4c4c4", text: "#ffffff", label: status || "—" };
  }
}

export function getPaymentStatusStyle(status: string, colorHex?: string): { bg: string; text: string; label: string } {
  if (colorHex && colorHex.trim()) {
    return { bg: colorHex.trim(), text: "#ffffff", label: status || "—" };
  }
  switch ((status || "").toLowerCase()) {
    case "paid":
    case "fully_paid":
    case "authorized":
    case "captured":
    case "complete":
      return { bg: "#fdbc64", text: "#ffffff", label: "Paid" };
    case "partial":
    case "partially_paid":
    case "partially_refunded":
      return { bg: "#33d391", text: "#ffffff", label: "Partial" };
    case "pending":
    case "pending_payment":
    case "unpaid":
    case "authorized_pending_capture":
    case "outstanding":
      return { bg: "#e8697d", text: "#ffffff", label: "Pending" };
    case "overdue": return { bg: "#339ecd", text: "#ffffff", label: "Overdue" };
    case "refunded": return { bg: "#c4c4c4", text: "#ffffff", label: "Refunded" };
    default: return { bg: "#c4c4c4", text: "#ffffff", label: status || "—" };
  }
}


export function getWarehouseStatusStyle(status: string): { bg: string; text: string; label: string } {
  switch ((status || "").toLowerCase()) {
    case "received": return { bg: "#33d391", text: "#ffffff", label: "Received" };
    case "not received": return { bg: "#fdbc64", text: "#ffffff", label: "Not received" };
    case "processing": return { bg: "#e8697d", text: "#ffffff", label: "Processing" };
    case "ready to dispatch": return { bg: "#339ecd", text: "#ffffff", label: "Ready to dispatch" };
    case "dispatched": return { bg: "#b57de3", text: "#ffffff", label: "Dispatched" };
    default: return { bg: "#c4c4c4", text: "#ffffff", label: status || "—" };
  }
}

export function getDispatchStatusStyle(status: string): { bg: string; text: string; label: string } {
  switch ((status || "").toLowerCase()) {
    case "booked": return { bg: "#33d391", text: "#ffffff", label: "Booked" };
    case "not dispatched": return { bg: "#fdbc64", text: "#ffffff", label: "Not dispatched" };
    case "dispatched": return { bg: "#e8697d", text: "#ffffff", label: "Dispatched" };
    case "failed": return { bg: "#339ecd", text: "#ffffff", label: "Failed" };
    default: return { bg: "#c4c4c4", text: "#ffffff", label: status || "—" };
  }
}


export function getDeliveryStatusStyle(status: string): { bg: string; text: string; label: string } {
  switch ((status || "").toLowerCase()) {
    case "in transit": return { bg: "#33d391", text: "#ffffff", label: "In transit" };
    case "pending": return { bg: "#fdbc64", text: "#ffffff", label: "Pending" };
    case "out for delivery": return { bg: "#e8697d", text: "#ffffff", label: "Out for delivery" };
    case "delivered": return { bg: "#339ecd", text: "#ffffff", label: "Delivered" };
    case "failed": return { bg: "#b57de3", text: "#ffffff", label: "Failed" };
    default: return { bg: "#c4c4c4", text: "#ffffff", label: status || "—" };
  }
}

export function getCarrierStatusStyle(label: string, colorHex?: string): { bg: string; text: string } {
  if (colorHex && colorHex.trim()) {
    return { bg: colorHex.trim(), text: "#ffffff" };
  }
  switch ((label || "").toLowerCase()) {
    case "fliway - midsize": return { bg: "#33d391", text: "#ffffff" };
    case "fliway - linehaul": return { bg: "#fdbc64", text: "#ffffff" };
    case "nzp": return { bg: "#e8697d", text: "#ffffff" };
    case "nzp - age restricted": return { bg: "#339ecd", text: "#ffffff" };
    case "mainfreight": return { bg: "#79affd", text: "#ffffff" };
    case "castle": return { bg: "#b57de3", text: "#ffffff" };
    case "m2h": return { bg: "#ff8358", text: "#ffffff" };
    case "team global express": return { bg: "#797e93", text: "#ffffff" };
    default: return { bg: "#c4c4c4", text: "#ffffff" };
  }
}

export function parseNotesString(raw: string): NoteItem[] {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  const blocks = text.split(/\r?\n\r?\n/).filter(Boolean);
  const allTagged = blocks.every((block) => /^\s*\[(internal|customer|system)(:monday)?[\]|]/i.test(block));
  if (!allTagged) {
    return [{ author: "SP", role: "internal", scheme: "internal", time: "", text }];
  }
  return blocks.reverse().map((block) => {
    const trimmed = block.trim();
    const richMatch = trimmed.match(/^\[([^|]+)\|([^|]*)\|([^\]]*)\]\s*(.*)$/i);
    if (richMatch) {
      const rawScheme = richMatch[1].toLowerCase();
      const pushToMonday = rawScheme.endsWith(":monday");
      const scheme = rawScheme.replace(":monday", "");
      return {
        author: richMatch[2] || (scheme === "system" ? "SY" : "SP"),
        role: scheme === "customer" ? "customer" : scheme === "system" ? "system" : "internal",
        scheme,
        time: richMatch[3] || "",
        text: richMatch[4].trim(),
        pushToMonday,
      };
    }
    const match = trimmed.match(/^\[(internal|customer|system)(:monday)?\]\s*(.*)$/i);
    if (!match) return { author: "SP", role: "internal", scheme: "internal", time: "", text: trimmed };
    const scheme = match[1].toLowerCase();
    return {
      author: scheme === "customer" ? "Customer" : scheme === "system" ? "SY" : "SP",
      role: scheme === "customer" ? "customer" : scheme === "system" ? "system" : "internal",
      scheme,
      time: "",
      text: match[3].trim(),
      pushToMonday: Boolean(match[2]),
    };
  });
}

export function serializeNotes(notes: NoteItem[]): string {
  return [...notes].reverse().map((note) => `[${note.scheme}${note.pushToMonday ? ":monday" : ""}|${note.author}|${note.time}] ${note.text}`).join("\n\n");
}

export function formatNoteDateTime(d = new Date()): string {
  return `${d.toLocaleDateString("en-NZ", { day: "numeric", month: "short" })} ${d.toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" })}`;
}

export function getCin7CellStatus(item: { cin7Status?: string; cin7Exists?: boolean }): "match" | "mismatch" | "missing" | "error" {
  if (item.cin7Status) return item.cin7Status as any;
  return item.cin7Exists ? "match" : "missing";
}

export function getRefPrefix(carrier: string): string {
  if (!carrier) return "";
  return `${carrier}-REF-`;
}

export function dedupeOrders<T extends { shopifyOrderId: string }>(list: T[]): T[] {
  return Array.from(new Map(list.map((o) => [o.shopifyOrderId, o])).values());
}

/** Normalise URL/list id → OMS OrderSnapshot.orderId (Shopify numeric). */
export function normalizeShopifyOrderId(raw?: string | null): string {
  return String(raw || "")
    .replace(/^gid:\/\/shopify\/Order\//, "")
    .trim();
}

/** Resolve order + line for `/app/order/:id` — sync, no flash. */
export function resolveDetailTarget(
  orders: FreightOrderRow[],
  orderId?: string | null,
  variantId?: string | null,
): { order: FreightOrderRow; item: FreightLineItem } | null {
  if (!orderId) return null;
  const want = normalizeShopifyOrderId(orderId);

  // Match by line-index cuid, snapshot cuid, Shopify order id, or GID.
  let order =
    orders.find((o) => o.lineItems.some((li) => li.lineIndexId && li.lineIndexId === want)) ??
    orders.find(
      (o) =>
        (o.snapshotId && o.snapshotId === want) ||
        normalizeShopifyOrderId(o.shopifyOrderId) === want ||
        normalizeShopifyOrderId(o.id) === want,
    );
  if (!order) return null;

  const item =
    (want
      ? order.lineItems.find((li) => li.lineIndexId === want)
      : undefined) ??
    (variantId ? order.lineItems.find((li) => li.variantId === variantId) : undefined) ??
    order.lineItems[0];
  if (!item) return null;
  return { order, item };
}

/** Patch one line item inside an order list (immutable). */
export function patchOrderLineItem(
  orders: FreightOrderRow[],
  orderId: string,
  variantId: string,
  patch: Partial<FreightLineItem> | ((li: FreightLineItem) => FreightLineItem),
): FreightOrderRow[] {
  return orders.map((o) => {
    if (o.shopifyOrderId !== orderId && o.id !== orderId) return o;
    return {
      ...o,
      lineItems: o.lineItems.map((li) => {
        if (li.variantId !== variantId) return li;
        return typeof patch === "function" ? patch(li) : { ...li, ...patch };
      }),
    };
  });
}
