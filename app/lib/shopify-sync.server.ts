/* eslint-disable @typescript-eslint/no-explicit-any */
import { unauthenticated } from "../shopify.server";

// ─── Metafield namespace for operational data ────────────────────────────────
const OPS_NAMESPACE = "containerdoor_ops";

// ─── Generic: push a single metafield to an order ────────────────────────────

async function pushMetafield(
  shop: string,
  orderId: string,
  key: string,
  value: string,
  metafieldType = "single_line_text_field",
) {
  if (!value && value !== "0") return; // allow "0" but skip empty strings
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
      console.error(`[ShopifySync] metafield ${key} errors for order ${orderId}:`, errors);
    }
  } catch (error) {
    console.error(`[ShopifySync] Failed to push ${key} for order ${orderId}:`, error);
  }
}

// ─── Per-variant metafield keys ──────────────────────────────────────────────

function variantKey(prefix: string, variantId: string) {
  return `${prefix}_${variantId}`;
}

// ─── Individual push helpers (kept for callers that only need one field) ────

export async function pushEddToShopify(shop: string, orderId: string, variantId: string, eddDate: string) {
  await pushMetafield(shop, orderId, variantKey("edd", variantId), eddDate);
}

export async function pushTrackingToShopify(shop: string, orderId: string, variantId: string, trackingNumber: string) {
  await pushMetafield(shop, orderId, variantKey("tracking", variantId), trackingNumber);
}

export async function pushDispatchStatusToShopify(shop: string, orderId: string, variantId: string, dispatchStatus: string) {
  await pushMetafield(shop, orderId, variantKey("dispatch", variantId), dispatchStatus);
}

export async function pushWarehouseStatusToShopify(shop: string, orderId: string, variantId: string, warehouseStatus: string) {
  await pushMetafield(shop, orderId, variantKey("warehouse", variantId), warehouseStatus);
}

export async function pushDeliveryStatusToShopify(shop: string, orderId: string, variantId: string, deliveryStatus: string) {
  await pushMetafield(shop, orderId, variantKey("delivery", variantId), deliveryStatus);
}

export async function pushPortArrivalToShopify(shop: string, orderId: string, variantId: string, portArrivalDate: string) {
  await pushMetafield(shop, orderId, variantKey("port_arrival", variantId), portArrivalDate);
}

export async function pushInTransitToShopify(shop: string, orderId: string, variantId: string, inTransitDate: string) {
  await pushMetafield(shop, orderId, variantKey("in_transit", variantId), inTransitDate);
}

export async function pushSupplierContainerToShopify(shop: string, orderId: string, variantId: string, supplierContainer: string) {
  await pushMetafield(shop, orderId, variantKey("supplier_container", variantId), supplierContainer);
}

export async function pushWarehouseTagsToShopify(shop: string, orderId: string, variantId: string, warehouseTags: string) {
  await pushMetafield(shop, orderId, variantKey("warehouse_tags", variantId), warehouseTags);
}

export async function pushReceivedDateToShopify(shop: string, orderId: string, variantId: string, receivedDate: string) {
  await pushMetafield(shop, orderId, variantKey("received_date", variantId), receivedDate);
}

export async function pushDepositPaidToShopify(shop: string, orderId: string, variantId: string, depositPaid: string) {
  await pushMetafield(shop, orderId, variantKey("deposit_paid", variantId), depositPaid);
}

export async function pushBalanceDueToShopify(shop: string, orderId: string, variantId: string, balanceDue: string) {
  await pushMetafield(shop, orderId, variantKey("balance_due", variantId), balanceDue);
}

export async function pushNotesToShopify(shop: string, orderId: string, variantId: string, notes: string) {
  if (!notes) return;
  await pushMetafield(shop, orderId, variantKey("notes", variantId), notes);
}

// ─── Order-level: customer status ───────────────────────────────────────────

export async function pushCustomerStatusToShopify(shop: string, orderId: string, variantId: string, customerStatus: string) {
  await pushMetafield(shop, orderId, variantKey("customer", variantId), customerStatus);
}

// ─── Middleware: sync changed fields back to Shopify ─────────────────────────
// Call this after any operational data update. It inspects which fields
// changed and pushes only those back to Shopify — minimal API calls.

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
  notes?: string;
}

export async function syncChangesToShopify(changes: OperationalDataChanges) {
  const { shop, orderId, variantId } = changes;
  if (!shop || !orderId) return;

  // Per-variant fields require variantId
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
    if (changes.notes !== undefined) {
      await pushNotesToShopify(shop, orderId, variantId, changes.notes);
    }
  }

  // Order-level fields (none — all fields are now per-variant)
}
