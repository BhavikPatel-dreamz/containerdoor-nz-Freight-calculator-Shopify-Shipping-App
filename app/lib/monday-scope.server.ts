type MondayOrderGate = {
  name?: string;
  cancelled_at?: string | null;
  fulfillment_status?: string | null;
};

/**
 * Monday board is the operational work queue — not a historic archive.
 * Create/link pulses only for orders that still need fulfilment tracking.
 */
export function isMondayOperationalOrder(order: MondayOrderGate | null | undefined): boolean {
  if (!order) return false;
  if (order.cancelled_at) return false;
  const name = String(order.name || "").toUpperCase();
  if (name.includes("CANCELLED ORDER") && String(order.fulfillment_status || "").toLowerCase() === "fulfilled") {
    return false;
  }
  const fulfillment = String(order.fulfillment_status || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (!fulfillment) return true;
  if (fulfillment === "fulfilled" || fulfillment === "restocked") return false;
  return true;
}

export function isClosedFulfillmentStatus(status?: string | null): boolean {
  const fulfillment = String(status || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  return fulfillment === "fulfilled" || fulfillment === "restocked";
}

/** Shopify Admin search: open orders that still have work. */
export const SHOPIFY_OPEN_OPS_QUERY =
  "(fulfillment_status:unfulfilled OR fulfillment_status:partial) AND status:open";
