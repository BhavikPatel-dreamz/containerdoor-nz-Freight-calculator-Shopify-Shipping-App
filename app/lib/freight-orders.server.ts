/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared freight-order row builder. Used by both the list loader
// (app.freight-orders.tsx) and the detail loader (app.freight-orders_.$orderId.tsx)
// so the FreightDashboard row shape stays identical in both places.

export type ShopifyOrderNode = {
  id: string; name: string; createdAt: string; currencyCode: string;
  email?: string; phone?: string;
  displayFinancialStatus?: string; displayFulfillmentStatus?: string;
  shippingAddress?: { city?: string; zip?: string; address1?: string; province?: string; country?: string; firstName?: string; lastName?: string };
  shippingLines: { nodes: Array<{ title: string; code: string; originalPriceSet: { shopMoney: { amount: string; currencyCode: string } } }> };
  lineItems: { nodes: Array<{ id: string; title: string; quantity: number; sku?: string; variant?: { id: string; sku?: string } }> };
};

export const FREIGHT_SERVICE_PREFIXES = ["standard_delivery::", "depot_delivery::", "customer_pickup::"];
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// GraphQL selection set that buildRow depends on. Reuse in loaders so the two
// queries can't drift from what buildRow reads.
export const FREIGHT_ORDER_FIELDS = `#graphql
  fragment FreightOrderFields on Order {
    id name createdAt currencyCode
    shippingAddress { city zip address1 province country firstName lastName }
    email phone displayFinancialStatus displayFulfillmentStatus
    shippingLines(first: 5) { nodes { title code originalPriceSet { shopMoney { amount currencyCode } } } }
    lineItems(first: 50) { nodes { id title quantity sku variant { id sku } } }
  }
`;

// Build the per-shop operational-data lookups buildRow needs.
export async function buildOpsMaps(prisma: any, shop: string) {
  const allOpsData = await prisma.orderLineItemOperationalData.findMany({ where: { shop } });
  const opsMap = new Map<string, any>(allOpsData.map((r: any) => [`${r.orderId}::${r.variantId}`, r]));

  const orderOpData = await prisma.orderOperationalData.findMany({
    where: { shop },
    select: { orderId: true, cin7SalesOrderId: true },
  });
  const orderCin7Map = new Map<string, boolean>(
    orderOpData
      .filter((row: any) => Boolean(row.cin7SalesOrderId && row.cin7SalesOrderId !== "pending"))
      .map((row: any) => [row.orderId, true] as [string, boolean])
  );

  return { opsMap, orderCin7Map };
}

export function buildRow(
  order: ShopifyOrderNode,
  opsMap: Map<string, any>,
  orderCin7Map: Map<string, boolean>,
) {
  const shippingLine = order.shippingLines.nodes.find((s) =>
    FREIGHT_SERVICE_PREFIXES.some((prefix) => s.code?.startsWith(prefix))
  );
  if (!shippingLine) return null;
  const parts = shippingLine.code.split("::");
  const carriers = parts[1]; const packageCount = parts[2]; const lineItemsRaw = parts[4];
  if (!carriers || !lineItemsRaw) return null;
  const numericOrderId = order.id.replace("gid://shopify/Order/", "");
  const variantTitleMap = new Map<string, string>();
  const variantSkuMap = new Map<string, string>();
  for (const li of order.lineItems.nodes) {
    if (li.variant?.id) {
      variantTitleMap.set(li.variant.id.replace("gid://shopify/ProductVariant/", ""), li.title);
      variantSkuMap.set(li.variant.id.replace("gid://shopify/ProductVariant/", ""), li.variant.sku || li.sku || "");
    }
  }
  const lineItems = lineItemsRaw.split("|").map((part, idx) => {
    const [variantId, rest] = part.split(":");
    const [company, boxesStr, amountStr] = (rest ?? "").split("x");
    const ops = opsMap.get(`${numericOrderId}::${variantId}`);
    return {
      id: `${order.id}-${idx}`,
      variantId,
      title: variantTitleMap.get(variantId),
      sku: variantSkuMap.get(variantId) ?? "",
      company: company ?? "",
      boxes: Number(boxesStr ?? 0),
      amount: Number(amountStr ?? 0),
      letterSuffix: LETTERS[idx % 26],
      customerStatus: ops?.customerStatus ?? "",
      trackingNumber: ops?.trackingNumber ?? "",
      freightRef: ops?.freightRef ?? "",
      eddDate: ops?.eddDate ?? "",
      originalEddDate: ops?.originalEddDate ?? "",
      cin7Exists: orderCin7Map.get(numericOrderId) ?? false,
      // Restore persisted cached statuses so the UI shows DB values after a reload
      cin7Status: typeof ops?.cin7CachedStatus === "string" && ops.cin7CachedStatus.trim()
        ? (ops.cin7CachedStatus.trim().toLowerCase() as any)
        : undefined,
      cin7Mismatches: typeof ops?.cin7CachedMismatches === "string" && ops.cin7CachedMismatches.trim()
        ? ops.cin7CachedMismatches.split(",").map((s: string) => s.trim()).filter(Boolean)
        : [],
      mondayStatus: typeof ops?.mondayCachedStatus === "string" && ops.mondayCachedStatus.trim()
        ? (ops.mondayCachedStatus.trim().toLowerCase() as any)
        : undefined,
      mondayMismatches: typeof ops?.mondayCachedMismatches === "string" && ops.mondayCachedMismatches.trim()
        ? ops.mondayCachedMismatches.split(",").map((s: string) => s.trim()).filter(Boolean)
        : [],
    };
  });
  return {
    id: order.id, shopifyOrderId: numericOrderId, shopifyOrderName: order.name, currency: order.currencyCode,
    totalFreight: Number(shippingLine.originalPriceSet.shopMoney.amount ?? 0),
    city: order.shippingAddress?.city ?? null, postalCode: order.shippingAddress?.zip ?? null,
    createdAt: order.createdAt, carriers, packageCount, shippingTitle: shippingLine.title, lineItems,
    customerName: `${order.shippingAddress?.firstName ?? ""} ${order.shippingAddress?.lastName ?? ""}`.trim() || "—",
    email: order.email ?? "—", phone: order.phone ?? "—",
    financialStatus: order.displayFinancialStatus ?? "—",
    fulfillmentStatus: order.displayFulfillmentStatus ?? "UNFULFILLED",
    fullAddress: [order.shippingAddress?.address1, order.shippingAddress?.city, order.shippingAddress?.province, order.shippingAddress?.zip, order.shippingAddress?.country].filter(Boolean).join(", "),
  };
}
