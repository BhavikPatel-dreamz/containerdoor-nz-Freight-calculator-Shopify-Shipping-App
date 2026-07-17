/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
// import { companyLabels } from "../lib/freight";
import FreightDashboard from "../components/FreightDashboard";

// ─── Types ────────────────────────────────────────────────────────────────────

type ShopifyOrderNode = {
  id: string; name: string; createdAt: string; currencyCode: string;
  email?: string; phone?: string;
  displayFinancialStatus?: string; displayFulfillmentStatus?: string;
  shippingAddress?: { city?: string; zip?: string; address1?: string; province?: string; country?: string; firstName?: string; lastName?: string };
  shippingLines: { nodes: Array<{ title: string; code: string; originalPriceSet: { shopMoney: { amount: string; currencyCode: string } } }> };
  lineItems: { nodes: Array<{ id: string; title: string; quantity: number; sku?: string; variant?: { id: string; sku?: string } }> };
};

const PAGE_SIZE = 25;
const FREIGHT_SERVICE_PREFIXES = ["standard_delivery::", "depot_delivery::", "customer_pickup::"];
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const { authenticate } = await import("../shopify.server");
  const { default: prisma } = await import("../db.server");

  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const page = Math.max(Number(url.searchParams.get("page") || "1"), 1);

  const response = await admin.graphql(
    `#graphql
    query FreightOrders($first: Int!) {
      orders(first: $first, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id name createdAt currencyCode
          shippingAddress { city zip address1 province country firstName lastName }
          email phone displayFinancialStatus displayFulfillmentStatus
          shippingLines(first: 5) { nodes { title code originalPriceSet { shopMoney { amount currencyCode } } } }
          lineItems(first: 50) { nodes { id title quantity sku variant { id sku } } }
        }
      }
    }`,
    { variables: { first: 250 } }
  );

  const json = await response.json();
  const allOrders: ShopifyOrderNode[] = json.data?.orders?.nodes ?? [];

  const allOpsData = await prisma.orderLineItemOperationalData.findMany({ where: { shop } });
  const opsMap = new Map(allOpsData.map((r) => [`${r.orderId}::${r.variantId}`, r]));

  const orderOpData = await prisma.orderOperationalData.findMany({
    where: { shop },
    select: { orderId: true, cin7SalesOrderId: true },
  });
  const orderCin7Map = new Map(
    orderOpData
      .filter((row) => Boolean(row.cin7SalesOrderId && row.cin7SalesOrderId !== "pending"))
      .map((row) => [row.orderId, true])
  );

  const freightOrders = allOrders
    .map((order) => buildRow(order, opsMap, orderCin7Map))
    .filter(Boolean) as ReturnType<typeof buildRow>[];

  const total = freightOrders.length;
  const pageCount = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const paged = freightOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return { orders: paged, allOrders: freightOrders, total, page, pageCount, shop };
}

function buildRow(order: ShopifyOrderNode, opsMap: Map<string, any>, orderCin7Map: Map<string, boolean>) {
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
    return { id: `${order.id}-${idx}`, variantId, title: variantTitleMap.get(variantId), sku: variantSkuMap.get(variantId) ?? "", company: company ?? "", boxes: Number(boxesStr ?? 0), amount: Number(amountStr ?? 0), letterSuffix: LETTERS[idx % 26], customerStatus: ops?.customerStatus ?? "", trackingNumber: ops?.trackingNumber ?? "",freightRef: ops?.freightRef ?? "", eddDate: ops?.eddDate ?? "", originalEddDate: ops?.originalEddDate ?? "", cin7Exists: orderCin7Map.get(numericOrderId) ?? false };
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FreightOrdersPage() {
  const { orders, allOrders, total, page, pageCount, shop } = useLoaderData<typeof loader>();

  return (
    <FreightDashboard
      orders={orders as any}
      allOrders={allOrders as any}
      total={total}
      page={page}
      pageCount={pageCount}
      shop={shop}
      noteAuthor="SP"
      navbarRight={<div className="fo-avatar">SP</div>}
    />
  );
}