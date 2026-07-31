/* eslint-disable @typescript-eslint/no-explicit-any */
/** Shared client fetch helpers for list + detail OMS screens. */

export type OrderStatusLine = {
  variantId: string;
  notes?: string;
  [key: string]: any;
};

export type OrderStatusPayload = {
  lineItems?: OrderStatusLine[];
  communications?: any[];
  lineIndexId?: string;
  orderId?: string;
  variantId?: string;
  [key: string]: any;
};

/** Prefer lineIndexId (single OMS id). Falls back to orderId+variantId. */
export async function fetchOrderStatus(
  shop: string,
  orderId: string,
  variantId: string,
  lineIndexId?: string,
): Promise<OrderStatusPayload | null> {
  const qs = new URLSearchParams({ shop });
  if (lineIndexId) {
    qs.set("lineIndexId", lineIndexId);
  } else {
    qs.set("orderId", orderId);
    if (variantId) qs.set("variantId", variantId);
  }
  const res = await fetch(`/api/order-status?${qs}`);
  if (!res.ok) return null;
  return res.json();
}

export function findStatusLine(
  payload: OrderStatusPayload | null | undefined,
  variantId: string,
): OrderStatusLine | undefined {
  const items = payload?.lineItems ?? [];
  if (variantId) return items.find((item) => item.variantId === variantId);
  return items[0];
}

/** Map /api/order-status line → FreightLineItem ops fields (detail UI). */
export function mergeStatusLineIntoItem<T extends Record<string, any>>(
  item: T,
  line: OrderStatusLine | undefined | null,
): T {
  if (!line) return item;
  return {
    ...item,
    customerStatus: line.customerStatus ?? item.customerStatus,
    paymentStatus: line.paymentStatus || item.paymentStatus,
    warehouseStatus: line.warehouseStatus ?? item.warehouseStatus,
    dispatchStatus: line.dispatchStatus ?? item.dispatchStatus,
    deliveryStatus: line.deliveryStatus ?? item.deliveryStatus,
    trackingNumber: line.trackingNumber ?? item.trackingNumber,
    freightRef: line.freightRef ?? item.freightRef,
    eddDate: line.eddDate ?? item.eddDate,
    originalEddDate: line.originalEddDate ?? item.originalEddDate,
    supplierContainer: line.supplierContainer ?? item.supplierContainer,
    receivedDate: line.receivedDate ?? item.receivedDate,
    portArrivalDate: line.portArrivalDate ?? item.portArrivalDate,
    inTransitDate: line.inTransitDate ?? item.inTransitDate,
    depositPaid: line.depositPaid ?? item.depositPaid,
    balanceDue: line.balanceDue ?? item.balanceDue,
    company: (line.carrier && String(line.carrier).trim()) || item.company,
    mondayItemId: line.mondayItemId ?? item.mondayItemId,
    mondayItemName: line.mondayItemName ?? item.mondayItemName,
    mondayItemUrl: line.mondayItemUrl ?? item.mondayItemUrl,
  };
}

export async function postOrderStatus(body: {
  shop: string;
  orderId: string;
  variantId: string;
  data: Record<string, any>;
  performedBy?: string;
}): Promise<{ ok: boolean; json: any }> {
  const res = await fetch("/api/order-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

export async function fetchOrderAmendments(shop: string, orderId: string): Promise<any | null> {
  const res = await fetch(
    `/api/order-amendments?shop=${encodeURIComponent(shop)}&orderId=${encodeURIComponent(orderId)}`,
  );
  if (!res.ok) return null;
  return res.json();
}

export async function postOrderAmendments(body: Record<string, any>): Promise<{ ok: boolean; json: any }> {
  const res = await fetch("/api/order-amendments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}
