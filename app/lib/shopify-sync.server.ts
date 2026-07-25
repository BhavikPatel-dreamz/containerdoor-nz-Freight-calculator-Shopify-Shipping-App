/* eslint-disable @typescript-eslint/no-explicit-any */
import { unauthenticated } from "../shopify.server";

/**
 * Shopify mirror for customer-facing OMS fields.
 *
 * Link key: shop + Shopify orderId + variantId (same row as OrderLineItemOperationalData).
 * Current EDD → order metafield `containerdoor_ops.edd_{variantId}` (per line item).
 * Internal OMS notes are NEVER written here.
 *
 * Customer Account extension also reads live OMS via `/api/order-status`;
 * this metafield keeps Shopify (Liquid / other surfaces) in sync.
 */

const OPS_NAMESPACE = "containerdoor_ops";

export type ShopifyMetafieldPushResult = {
  ok: boolean;
  key: string;
  error?: string;
};

async function pushMetafield(
  shop: string,
  orderId: string,
  key: string,
  value: string,
  metafieldType = "single_line_text_field",
): Promise<ShopifyMetafieldPushResult> {
  // Allow clearing? Skip empty for now (OMS always sends a real EDD when syncing).
  if (!value && value !== "0") {
    return { ok: true, key }; // nothing to write
  }
  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(
      `#graphql
      mutation SetOpsMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              ownerId: `gid://shopify/Order/${orderId}`,
              namespace: OPS_NAMESPACE,
              key,
              type: metafieldType,
              value,
            },
          ],
        },
      },
    );
    const json = await response.json();
    const errors = json?.data?.metafieldsSet?.userErrors ?? [];
    if (errors.length) {
      const msg = errors.map((e: { message: string }) => e.message).join("; ");
      console.error(`[ShopifySync] metafield ${key} errors for order ${orderId}:`, errors);
      return { ok: false, key, error: msg };
    }
    return { ok: true, key };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[ShopifySync] Failed to push ${key} for order ${orderId}:`, error);
    return { ok: false, key, error: msg };
  }
}

function variantKey(prefix: string, variantId: string) {
  return `${prefix}_${variantId}`;
}

/** Normalize to YYYY-MM-DD for Shopify `date` metafield type. */
export function toShopifyDateValue(raw: string): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toISOString().slice(0, 10);
}

/**
 * Push Current EDD for one OMS line item onto the linked Shopify order.
 * Metafield: containerdoor_ops.edd_{variantId}
 */
export async function pushEddToShopify(
  shop: string,
  orderId: string,
  variantId: string,
  eddDate: string,
): Promise<ShopifyMetafieldPushResult> {
  const dateVal = toShopifyDateValue(eddDate);
  const key = variantKey("edd", variantId);
  if (!dateVal) return { ok: true, key };

  // Prefer date type; if definition/type conflict, fall back to text (existing stores).
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
    const asDate = await pushMetafield(shop, orderId, key, dateVal, "date");
    if (asDate.ok) return asDate;
    console.warn(`[ShopifySync] EDD date-type failed (${asDate.error}); retrying as text`);
  }
  return pushMetafield(shop, orderId, key, dateVal, "single_line_text_field");
}

export async function pushTrackingToShopify(shop: string, orderId: string, variantId: string, trackingNumber: string) {
  return pushMetafield(shop, orderId, variantKey("tracking", variantId), trackingNumber);
}

export async function pushDispatchStatusToShopify(shop: string, orderId: string, variantId: string, dispatchStatus: string) {
  return pushMetafield(shop, orderId, variantKey("dispatch", variantId), dispatchStatus);
}

export async function pushWarehouseStatusToShopify(shop: string, orderId: string, variantId: string, warehouseStatus: string) {
  return pushMetafield(shop, orderId, variantKey("warehouse", variantId), warehouseStatus);
}

export async function pushDeliveryStatusToShopify(shop: string, orderId: string, variantId: string, deliveryStatus: string) {
  return pushMetafield(shop, orderId, variantKey("delivery", variantId), deliveryStatus);
}

export async function pushPortArrivalToShopify(shop: string, orderId: string, variantId: string, portArrivalDate: string) {
  return pushMetafield(shop, orderId, variantKey("port_arrival", variantId), portArrivalDate);
}

export async function pushInTransitToShopify(shop: string, orderId: string, variantId: string, inTransitDate: string) {
  return pushMetafield(shop, orderId, variantKey("in_transit", variantId), inTransitDate);
}

export async function pushSupplierContainerToShopify(shop: string, orderId: string, variantId: string, supplierContainer: string) {
  return pushMetafield(shop, orderId, variantKey("supplier_container", variantId), supplierContainer);
}

export async function pushWarehouseTagsToShopify(shop: string, orderId: string, variantId: string, warehouseTags: string) {
  return pushMetafield(shop, orderId, variantKey("warehouse_tags", variantId), warehouseTags);
}

export async function pushReceivedDateToShopify(shop: string, orderId: string, variantId: string, receivedDate: string) {
  return pushMetafield(shop, orderId, variantKey("received_date", variantId), receivedDate);
}

export async function pushDepositPaidToShopify(shop: string, orderId: string, variantId: string, depositPaid: string) {
  return pushMetafield(shop, orderId, variantKey("deposit_paid", variantId), depositPaid);
}

export async function pushBalanceDueToShopify(shop: string, orderId: string, variantId: string, balanceDue: string) {
  return pushMetafield(shop, orderId, variantKey("balance_due", variantId), balanceDue);
}

/** @deprecated Internal OMS notes must not sync to Shopify. No-op retained for call-site safety. */
export async function pushNotesToShopify(_shop: string, _orderId: string, _variantId: string, _notes: string) {
  console.warn("[ShopifySync] pushNotesToShopify skipped — internal notes stay OMS-only");
  return { ok: true, key: "notes" };
}

export async function pushCustomerStatusToShopify(shop: string, orderId: string, variantId: string, customerStatus: string) {
  return pushMetafield(shop, orderId, variantKey("customer", variantId), customerStatus);
}

export interface OperationalDataChanges {
  shop: string;
  orderId: string;
  variantId?: string;
  eddDate?: string;
  trackingNumber?: string;
  dispatchStatus?: string;
  customerStatus?: string;
  warehouseStatus?: string;
  warehouseTags?: string;
  deliveryStatus?: string;
  portArrivalDate?: string;
  inTransitDate?: string;
  supplierContainer?: string;
  receivedDate?: string;
  depositPaid?: string;
  balanceDue?: string;
  /** Ignored — notes never sync to Shopify */
  notes?: string;
}

export async function syncChangesToShopify(changes: OperationalDataChanges) {
  const { shop, orderId, variantId } = changes;
  if (!shop || !orderId) return;

  if (variantId) {
    if (changes.eddDate !== undefined) {
      await pushEddToShopify(shop, orderId, variantId, changes.eddDate);
    }
    if (changes.trackingNumber !== undefined) {
      await pushTrackingToShopify(shop, orderId, variantId, changes.trackingNumber);
    }
    if (changes.customerStatus !== undefined) {
      await pushCustomerStatusToShopify(shop, orderId, variantId, changes.customerStatus);
    }
    if (changes.dispatchStatus !== undefined) {
      await pushDispatchStatusToShopify(shop, orderId, variantId, changes.dispatchStatus);
    }
    if (changes.warehouseStatus !== undefined) {
      await pushWarehouseStatusToShopify(shop, orderId, variantId, changes.warehouseStatus);
    }
    if (changes.warehouseTags !== undefined) {
      await pushWarehouseTagsToShopify(shop, orderId, variantId, changes.warehouseTags);
    }
    if (changes.deliveryStatus !== undefined) {
      await pushDeliveryStatusToShopify(shop, orderId, variantId, changes.deliveryStatus);
    }
    if (changes.portArrivalDate !== undefined) {
      await pushPortArrivalToShopify(shop, orderId, variantId, changes.portArrivalDate);
    }
    if (changes.inTransitDate !== undefined) {
      await pushInTransitToShopify(shop, orderId, variantId, changes.inTransitDate);
    }
    if (changes.supplierContainer !== undefined) {
      await pushSupplierContainerToShopify(shop, orderId, variantId, changes.supplierContainer);
    }
    if (changes.receivedDate !== undefined) {
      await pushReceivedDateToShopify(shop, orderId, variantId, changes.receivedDate);
    }
    if (changes.depositPaid !== undefined) {
      await pushDepositPaidToShopify(shop, orderId, variantId, changes.depositPaid);
    }
    if (changes.balanceDue !== undefined) {
      await pushBalanceDueToShopify(shop, orderId, variantId, changes.balanceDue);
    }
    // notes intentionally omitted — internal OMS only
  }
}
