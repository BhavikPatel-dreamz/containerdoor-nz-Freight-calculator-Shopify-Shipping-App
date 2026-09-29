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

/**
 * Historic scan: still needs shipping. Explicitly includes paid + unfulfilled.
 * Do not use status:open alone — paid unfulfilled orders must stay in the queue.
 */
export const SHOPIFY_OPEN_OPS_QUERY =
  "-status:cancelled AND (fulfillment_status:unfulfilled OR fulfillment_status:partial OR (financial_status:paid AND -fulfillment_status:fulfilled))";
