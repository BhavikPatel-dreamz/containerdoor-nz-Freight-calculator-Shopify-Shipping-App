/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NoteItem } from "./types";

export function getCustomerStatusStyle(status: string): { bg: string; text: string; label: string } {
  switch ((status || "").toLowerCase()) {
    case "dispatched": return { bg: "#dcfce7", text: "#15803d", label: "Dispatched" };
    case "delivered": return { bg: "#d1fae5", text: "#065f46", label: "Delivered" };
    case "confirmed": return { bg: "#dbeafe", text: "#1d4ed8", label: "Confirmed" };
    case "cancelled": return { bg: "#fee2e2", text: "#b91c1c", label: "Cancelled" };
    case "pending": return { bg: "#fef3c7", text: "#92400e", label: "Pending" };
    default: return { bg: "#f3f4f6", text: "#6b7280", label: status || "—" };
  }
}

export function getPaymentStatusStyle(status: string): { bg: string; text: string; label: string } {
  switch ((status || "").toLowerCase()) {
    case "paid":
    case "fully_paid":
    case "authorized":
    case "captured":
    case "complete":
      return { bg: "#dcfce7", text: "#15803d", label: "Paid" };
    case "partial":
    case "partially_paid":
    case "partially_refunded":
      return { bg: "#fef3c7", text: "#92400e", label: "Partial" };
    case "pending":
    case "pending_payment":
    case "unpaid":
    case "authorized_pending_capture":
    case "outstanding":
      return { bg: "#f3f4f6", text: "#6b7280", label: "Pending" };
    case "overdue": return { bg: "#fee2e2", text: "#b91c1c", label: "Overdue" };
    case "refunded": return { bg: "#f3f4f6", text: "#6b7280", label: "Refunded" };
    default: return { bg: "#f3f4f6", text: "#6b7280", label: status || "—" };
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
  return blocks.map((block) => {
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
  return notes.map((note) => `[${note.scheme}${note.pushToMonday ? ":monday" : ""}|${note.author}|${note.time}] ${note.text}`).join("\n\n");
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
