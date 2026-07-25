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
  [key: string]: any;
};

export async function fetchOrderStatus(
  shop: string,
  orderId: string,
  variantId: string,
): Promise<OrderStatusPayload | null> {
  const res = await fetch(
    `/api/order-status?orderId=${encodeURIComponent(orderId)}&variantId=${encodeURIComponent(variantId)}&shop=${encodeURIComponent(shop)}`,
  );
  if (!res.ok) return null;
  return res.json();
}

export function findStatusLine(
  payload: OrderStatusPayload | null | undefined,
  variantId: string,
): OrderStatusLine | undefined {
  return (payload?.lineItems ?? []).find((item) => item.variantId === variantId);
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
