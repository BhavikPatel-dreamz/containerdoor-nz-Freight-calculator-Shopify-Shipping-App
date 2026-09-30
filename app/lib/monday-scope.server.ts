type MondayOrderGate = {
  name?: string;
  cancelled_at?: string | null;
  fulfillment_status?: string | null;
  financial_status?: string | null;
};

function norm(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

/**
 * Monday board is the operational work queue — not a historic archive.
 * Paid + unfulfilled (and partial) orders MUST get a pulse.
 * Skip only cancelled / fully fulfilled / restocked.
 */
export function isMondayOperationalOrder(order: MondayOrderGate | null | undefined): boolean {
  if (!order) return false;
  if (order.cancelled_at) return false;

  const fulfillment = norm(order.fulfillment_status);
  const financial = norm(order.financial_status);

  if (fulfillment === "fulfilled" || fulfillment === "restocked") return false;

  const stillShipping =
    !fulfillment ||
    fulfillment === "unfulfilled" ||
    fulfillment === "partial" ||
    fulfillment === "partially_fulfilled" ||
    fulfillment === "in_progress" ||
    fulfillment === "on_hold" ||
    fulfillment === "scheduled" ||
    fulfillment === "pending_fulfillment" ||
    fulfillment === "open";

  const paidOpen = financial === "paid" || financial === "partially_paid" || financial === "partial";
  if (paidOpen && stillShipping) return true;
  return stillShipping;
}

export function isClosedFulfillmentStatus(status?: string | null): boolean {
  const fulfillment = norm(status);
  return fulfillment === "fulfilled" || fulfillment === "restocked";
}

/** True = pulse should leave the live Monday queue (keep pending / unfulfilled / paid+unfulfilled). */
export function shouldPruneMondayPulse(input: {
  fulfillmentStatus?: string | null;
  financialStatus?: string | null;
  customerStatus?: string | null;
}): boolean {
  const customer = norm(input.customerStatus);
  if (customer === "cancelled" || customer === "canceled" || customer === "delivered") return true;

  const financial = norm(input.financialStatus);
  if (
    financial === "cancelled" ||
    financial === "canceled" ||
    financial === "voided" ||
    financial === "expired"
  ) {
    return true;
  }

  return isClosedFulfillmentStatus(input.fulfillmentStatus);
}

/**
 * Historic scan: still needs shipping. Explicitly includes paid + unfulfilled.
 * Do not use status:open alone — paid unfulfilled orders must stay in the queue.
 */
export const SHOPIFY_OPEN_OPS_QUERY =
  "-status:cancelled AND (fulfillment_status:unfulfilled OR fulfillment_status:partial OR (financial_status:paid AND -fulfillment_status:fulfilled))";

/** All non-cancelled Shopify orders — Cin7 catch-up (~214k). Monday is gated separately. */
export const SHOPIFY_ALL_NON_CANCELLED_QUERY = "-status:cancelled";

/** Shopify Admin search: unfulfilled only (~2293). */
export const SHOPIFY_UNFULFILLED_QUERY = "fulfillment_status:unfulfilled AND -status:cancelled";

export function shopifyOrderSyncQuery(): string {
  const fromEnv = String(process.env.ORDER_SYNC_SHOPIFY_QUERY || "").trim();
  if (fromEnv) return fromEnv;
  return SHOPIFY_ALL_NON_CANCELLED_QUERY;
}

export function orderSyncSkipCin7(): boolean {
  const v = String(process.env.ORDER_SYNC_SKIP_CIN7 || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
