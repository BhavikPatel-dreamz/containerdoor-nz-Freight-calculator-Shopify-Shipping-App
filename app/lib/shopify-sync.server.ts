/* eslint-disable @typescript-eslint/no-explicit-any */
import { unauthenticated } from "../shopify.server";

// ─── Metafield namespace for operational data ────────────────────────────────
const OPS_NAMESPACE = "containerdoor_ops";

// ─── Push EDD back to Shopify as order metafield ─────────────────────────────

export async function pushEddToShopify(
  shop: string,
  orderId: string,
  variantId: string,
  eddDate: string,
) {
  if (!eddDate) return;

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
              key: `edd_${variantId}`,
              type: "single_line_text_field",
              value: eddDate,
            },
          ],
        },
      },
    );

    const json = await response.json();
    const errors = json?.data?.metafieldsSet?.userErrors ?? [];
    if (errors.length) {
      console.error(`[ShopifySync] EDD metafield errors for order ${orderId} variant ${variantId}:`, errors);
    }
  } catch (error) {
    console.error(`[ShopifySync] Failed to push EDD for order ${orderId} variant ${variantId}:`, error);
  }
}

// ─── Push tracking number back to Shopify as order metafield ─────────────────

export async function pushTrackingToShopify(
  shop: string,
  orderId: string,
  variantId: string,
  trackingNumber: string,
) {
  if (!trackingNumber) return;

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
              key: `tracking_${variantId}`,
              type: "single_line_text_field",
              value: trackingNumber,
            },
          ],
        },
      },
    );

    const json = await response.json();
    const errors = json?.data?.metafieldsSet?.userErrors ?? [];
    if (errors.length) {
      console.error(`[ShopifySync] Tracking metafield errors for order ${orderId} variant ${variantId}:`, errors);
    }
  } catch (error) {
    console.error(`[ShopifySync] Failed to push tracking for order ${orderId} variant ${variantId}:`, error);
  }
}

// ─── Push dispatch status back to Shopify as order metafield ─────────────────

export async function pushDispatchStatusToShopify(
  shop: string,
  orderId: string,
  variantId: string,
  dispatchStatus: string,
) {
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
              key: `dispatch_${variantId}`,
              type: "single_line_text_field",
              value: dispatchStatus,
            },
          ],
        },
      },
    );

    const json = await response.json();
    const errors = json?.data?.metafieldsSet?.userErrors ?? [];
    if (errors.length) {
      console.error(`[ShopifySync] Dispatch status metafield errors for order ${orderId}:`, errors);
    }
  } catch (error) {
    console.error(`[ShopifySync] Failed to push dispatch status for order ${orderId}:`, error);
  }
}

// ─── Push customer-facing status back to Shopify as order metafield ──────────

export async function pushCustomerStatusToShopify(
  shop: string,
  orderId: string,
  customerStatus: string,
) {
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
              key: "customer_status",
              type: "single_line_text_field",
              value: customerStatus,
            },
          ],
        },
      },
    );

    const json = await response.json();
    const errors = json?.data?.metafieldsSet?.userErrors ?? [];
    if (errors.length) {
      console.error(`[ShopifySync] Customer status metafield errors for order ${orderId}:`, errors);
    }
  } catch (error) {
    console.error(`[ShopifySync] Failed to push customer status for order ${orderId}:`, error);
  }
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
    if (changes.dispatchStatus !== undefined) {
      await pushDispatchStatusToShopify(shop, orderId, variantId, changes.dispatchStatus);
    }
  }

  // Order-level fields
  if (changes.customerStatus !== undefined) {
    await pushCustomerStatusToShopify(shop, orderId, changes.customerStatus);
  }
}
