/* eslint-disable @typescript-eslint/no-explicit-any */
// OrderLineItemIndex maintenance. One row per freight line item, holding the
// immutable order/item snapshot fields the freight-orders LIST page searches,
// filters, sorts and paginates on in the DB. Mutable status/tracking lives in
// OrderLineItemOperationalData and is joined at read time.
import prisma from "../db.server";
import { buildLineItemSnapshots, buildLineItemQuantityMap } from "./freight-orders.server";

// Re-derive the index rows for one order from its DB snapshot and sync them:
// upsert the current freight line items, then delete any stale index rows for
// the order whose variant is no longer part of the freight code (e.g. the order
// was edited to fewer freight lines). Idempotent on [shop, orderId, variantId].
export async function reindexOrderLineItems(shop: string, snap: any): Promise<number> {
  if (!snap) return 0;
  const orderId = String(snap.orderId);
  const items = buildLineItemSnapshots(snap);
  const quantityByVariant = buildLineItemQuantityMap(snap);

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
    const searchText = [
      orderFields.orderName,
      it.letterSuffix,
      // Contiguous `orderNumber + suffix` (e.g. `123456A`) so a search with the
      // line-order letter matches only that specific line.
      `${orderFields.orderName}${it.letterSuffix}`,
      orderFields.customerName,
      orderFields.email,
      orderFields.carriers,
      it.productTitle,
      it.variantTitle,
      it.sku,
      it.vendor, // supplier — enables supplier-based search/filter
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const data = {
      ...orderFields,
      letterSuffix: it.letterSuffix,
      productTitle: it.productTitle,
      productId: it.productId,
      variantTitle: it.variantTitle,
      sku: it.sku,
      vendor: it.vendor,
      company: it.company,
      boxes: it.boxes,
      // Shopify ordered quantity (units/items) — OMS Qty source of truth.
      quantity: quantityByVariant.get(it.variantId) ?? 1,
      amount: it.amount,
      searchText,
    };
    return prisma.orderLineItemIndex.upsert({
      where: { shop_orderId_variantId: { shop, orderId, variantId: it.variantId } },
      update: data,
      create: { shop, orderId, variantId: it.variantId, ...data },
    });
  });

  // Retry the transaction a few times on P2002 (rare race when concurrent
  // workers insert the same index rows). Exponential backoff between attempts.
  const maxRetries = 3;
  let attempt = 0;
  while (true) {
    try {
      await prisma.$transaction([
        prisma.orderLineItemIndex.deleteMany({
          where: { shop, orderId, variantId: { notIn: variantIds.length ? variantIds : ["__none__"] } },
        }),
        ...upserts,
      ]);
      break; // success
    } catch (error) {
      const code = (error as any)?.code;
      const message = (error as any)?.message ?? "";
      if (code === "P2002" || message.includes("Unique constraint failed")) {
        attempt++;
        if (attempt > maxRetries) {
          console.warn(`[Reindex][${orderId}] P2002 after ${attempt} attempts, giving up`);
          break;
        }
        const backoff = 100 * Math.pow(2, attempt - 1);
        console.warn(`[Reindex][${orderId}] P2002 on attempt ${attempt}, retrying after ${backoff}ms`);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((res) => setTimeout(res, backoff));
        continue;
      }
      throw error;
    }
  }

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
