/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Cin7 integration adapter.
 *
 * OMS business logic always operates on Operational Line Items (A/B/C…).
 * This adapter decides how those lines map to Cin7 Sales Orders.
 *
 * Strategy (env `CIN7_SO_STRATEGY`):
 *   - `per_line` (default, preferred) — one Cin7 SO per operational line item
 *     (mirrors Monday pulse-per-line). Required because Cin7 allows only one
 *     `trackingCode` per Sales Order.
 *   - `grouped` (legacy) — one Cin7 SO for the whole Shopify order. Kept only
 *     for backwards compatibility with existing linked orders; do not hardcode
 *     this into OMS domain logic.
 *
 * Relationship model:
 *   Shopify Order ──1:N── Operational Line Item
 *        │                      ├── Monday pulse (mondayItemId)
 *        │                      └── Cin7 Sales Order (cin7SalesOrderId) [per_line]
 *        └── OrderOperationalData.cin7SalesOrderId [legacy grouped only]
 *
 * See `.cursor/rules/oms-cin7-architecture.mdc`.
 */
import prisma from "../db.server";
import { buildMondayPulseName } from "./monday.server";

export type Cin7SoStrategy = "per_line" | "grouped";

/** Cin7 `reference` max length (API SalesOrder model). */
export const CIN7_REFERENCE_MAX = 30;

export function getCin7SoStrategy(): Cin7SoStrategy {
  const raw = String(process.env.CIN7_SO_STRATEGY || "per_line")
    .trim()
    .toLowerCase();
  return raw === "grouped" ? "grouped" : "per_line";
}

/**
 * Unique Cin7 `reference` for one operational line (≤30 chars).
 * Prefer same shape as Monday pulse: `#CDL215347A`.
 * Falls back to truncated `Shopify-{order}{letter}` if needed.
 */
export function buildCin7SalesOrderReference(input: {
  orderName?: string | null;
  letterSuffix?: string | null;
  orderId?: string | null;
  variantId?: string | null;
}): string {
  const pulse = buildMondayPulseName(
    input.orderName,
    input.letterSuffix,
    input.orderId,
  );
  if (pulse.length <= CIN7_REFERENCE_MAX) return pulse;

  // Shorten: drop leading # if still too long, then hard-truncate.
  let ref = pulse.startsWith("#") ? pulse.slice(1) : pulse;
  if (ref.length <= CIN7_REFERENCE_MAX) return ref;

  const vid = String(input.variantId || "").slice(-6);
  const letter = String(input.letterSuffix || "").trim().toUpperCase();
  const oid = String(input.orderId || "").slice(-8);
  ref = `SO-${oid}${letter || vid}`.slice(0, CIN7_REFERENCE_MAX);
  return ref;
}

/**
 * Shared Shopify order key on every split SO (`customerOrderNo`).
 * Multiple Cin7 Sales Orders may share the same customerOrderNo.
 */
export function buildCin7CustomerOrderNo(orderName?: string | null, orderId?: string | null): string {
  const name = String(orderName || "").trim();
  if (name) return name.startsWith("#") ? name : `#${name}`;
  return String(orderId || "").trim();
}

export type ResolvedCin7Link = {
  salesOrderId: string;
  /** Where the id was read from */
  source: "line" | "order_legacy" | "none";
  strategy: Cin7SoStrategy;
};

/**
 * Resolve Cin7 Sales Order id for an operational line item.
 * Always prefer line-level link; fall back to order-level only for legacy
 * grouped creates (so existing orders keep syncing until migrated).
 */
export async function resolveCin7SalesOrderId(args: {
  shop: string;
  orderId: string;
  variantId: string;
}): Promise<ResolvedCin7Link> {
  const strategy = getCin7SoStrategy();
  const { shop, orderId, variantId } = args;

  const line = await prisma.orderLineItemOperationalData.findUnique({
    where: { shop_orderId_variantId: { shop, orderId, variantId } },
    select: { cin7SalesOrderId: true },
  });
  const lineId = String(line?.cin7SalesOrderId || "").trim();
  if (lineId && lineId !== "pending" && lineId !== "duplicate") {
    return { salesOrderId: lineId, source: "line", strategy };
  }

  // Legacy fallback: order-level SO (grouped era)
  const orderOps = await prisma.orderOperationalData.findUnique({
    where: { shop_orderId: { shop, orderId } },
    select: { cin7SalesOrderId: true },
  });
  const orderIdLink = String(orderOps?.cin7SalesOrderId || "").trim();
  if (orderIdLink && orderIdLink !== "pending" && orderIdLink !== "duplicate") {
    return { salesOrderId: orderIdLink, source: "order_legacy", strategy };
  }

  return { salesOrderId: "", source: "none", strategy };
}

export function isLinkedCin7Id(id?: string | null): boolean {
  const v = String(id || "").trim();
  return Boolean(v && v !== "pending" && v !== "duplicate");
}

/** Build a clickable Cin7 Sales Order URL for UI badges. */
export function buildCin7SalesOrderUrl(salesOrderId?: string | null): string | null {
  const id = String(salesOrderId || "").trim();
  if (!isLinkedCin7Id(id)) return null;

  // Preferred: full template, e.g. https://app.example/orders/{id}
  const template = String(process.env.CIN7_SALES_ORDER_URL_TEMPLATE || "").trim();
  if (template) {
    return template.includes("{id}") ? template.replace("{id}", encodeURIComponent(id)) : `${template.replace(/\/$/, "")}/${encodeURIComponent(id)}`;
  }

  // Fallback: Cin7 API order endpoint (JSON view, still useful for direct access).
  const apiBase = String(process.env.CIN7_SYNC_URL || "").trim() || `${String(process.env.CIN7_BASE_URL || "").trim().replace(/\/$/, "")}/SalesOrders`;
  if (!apiBase) return null;
  const normalized = apiBase.replace(/\/\d+$/, "");
  return `${normalized.replace(/\/$/, "")}/${encodeURIComponent(id)}`;
}

/**
 * Persist Cin7 link on the operational line (canonical).
 * Optionally mirrors first linked id onto order-level for legacy UI that still
 * reads `OrderOperationalData.cin7SalesOrderId` as "order has any Cin7 link".
 */
export async function saveCin7LineLink(args: {
  shop: string;
  orderId: string;
  variantId: string;
  salesOrderId: string;
  salesOrderCode?: string;
  salesOrderRef?: string;
  mirrorToOrder?: boolean;
}): Promise<void> {
  const {
    shop,
    orderId,
    variantId,
    salesOrderId,
    salesOrderCode = "",
    salesOrderRef = "",
    mirrorToOrder = true,
  } = args;

  await prisma.orderLineItemOperationalData.update({
    where: { shop_orderId_variantId: { shop, orderId, variantId } },
    data: {
      cin7SalesOrderId: salesOrderId,
      ...(salesOrderCode ? { cin7SalesOrderCode: salesOrderCode } : {}),
      ...(salesOrderRef ? { cin7SalesOrderRef: salesOrderRef } : {}),
    },
  });

  if (!mirrorToOrder) return;

  const existing = await prisma.orderOperationalData.findUnique({
    where: { shop_orderId: { shop, orderId } },
    select: { cin7SalesOrderId: true },
  });
  const cur = String(existing?.cin7SalesOrderId || "").trim();
  // Only set order-level if empty/pending — never overwrite a real legacy grouped id
  // with a different line's id when one already exists as a real link... actually for
  // per_line we want "any linked" marker. Prefer first successful link.
  if (!cur || cur === "pending") {
    await prisma.orderOperationalData.upsert({
      where: { shop_orderId: { shop, orderId } },
      create: { shop, orderId, cin7SalesOrderId: salesOrderId },
      update: { cin7SalesOrderId: salesOrderId },
    });
  }
}
