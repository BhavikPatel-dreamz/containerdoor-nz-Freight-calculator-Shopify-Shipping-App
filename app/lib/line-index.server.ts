/* eslint-disable @typescript-eslint/no-explicit-any */
// OrderLineItemIndex maintenance. One row per freight line item, holding the
// immutable order/item snapshot fields the freight-orders LIST page searches,
// filters, sorts and paginates on in the DB. Mutable status/tracking lives in
// OrderLineItemOperationalData and is joined at read time.
import prisma from "../db.server";
import { buildLineItemSnapshots } from "./freight-orders.server";

// Re-derive the index rows for one order from its DB snapshot and sync them:
// upsert the current freight line items, then delete any stale index rows for
// the order whose variant is no longer part of the freight code (e.g. the order
// was edited to fewer freight lines). Idempotent on [shop, orderId, variantId].
export async function reindexOrderLineItems(shop: string, snap: any): Promise<number> {
  if (!snap) return 0;
  const orderId = String(snap.orderId);
  const items = buildLineItemSnapshots(snap);

  const orderFields = {
    shopifyOrderId: orderId,
    gid: `gid://shopify/Order/${orderId}`,
    orderName: snap.orderName ?? "",
    customerName: `${snap.shippingFirstName ?? ""} ${snap.shippingLastName ?? ""}`.trim(),
    email: snap.email ?? "",
    phone: snap.phone ?? "",
    city: snap.shippingCity ?? "",
    zip: snap.shippingZip ?? "",
    fullAddress: [snap.shippingAddress1, snap.shippingCity, snap.shippingProvince, snap.shippingZip, snap.shippingCountry]
      .filter(Boolean)
      .join(", "),
    createdAt: snap.createdAt ?? new Date(),
    currency: snap.currencyCode ?? "NZD",
    totalFreight: Number(snap.totalFreight ?? 0),
    carriers: snap.carriers ?? "",
    shippingTitle: snap.shippingTitle ?? "",
    financialStatus: snap.financialStatus ?? "",
    fulfillmentStatus: snap.fulfillmentStatus ?? "",
  };

  const variantIds = items.map((it) => it.variantId);

  const upserts = items.map((it) => {
    const data = {
      ...orderFields,
      letterSuffix: it.letterSuffix,
      productTitle: it.productTitle,
      sku: it.sku,
      vendor: it.vendor,
      company: it.company,
      boxes: it.boxes,
      amount: it.amount,
    };
    return prisma.orderLineItemIndex.upsert({
      where: { shop_orderId_variantId: { shop, orderId, variantId: it.variantId } },
      update: data,
      create: { shop, orderId, variantId: it.variantId, ...data },
    });
  });

  await prisma.$transaction([
    prisma.orderLineItemIndex.deleteMany({
      where: { shop, orderId, variantId: { notIn: variantIds.length ? variantIds : ["__none__"] } },
    }),
    ...upserts,
  ]);

  return items.length;
}

// Convenience: load the snapshot then reindex. Used by the order webhooks after
// saveOrderSnapshot has written/updated the snapshot row.
export async function reindexOrderById(shop: string, orderId: string): Promise<number> {
  const snap = await prisma.orderSnapshot.findUnique({
    where: { shop_orderId: { shop, orderId: String(orderId) } },
  });
  if (!snap) return 0;
  return reindexOrderLineItems(shop, snap);
}
