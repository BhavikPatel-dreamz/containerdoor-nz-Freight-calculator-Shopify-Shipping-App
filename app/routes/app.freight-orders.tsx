/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
// import { companyLabels } from "../lib/freight";
import FreightDashboard from "../components/FreightDashboard";
import { buildRow, buildOpsMaps, type ShopifyOrderNode } from "../lib/freight-orders.server";

const PAGE_SIZE = 25;

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

  const { opsMap, orderCin7Map } = await buildOpsMaps(prisma, shop);

  const freightOrders = allOrders
    .map((order) => buildRow(order, opsMap, orderCin7Map))
    .filter(Boolean) as ReturnType<typeof buildRow>[];

  const total = freightOrders.length;
  const pageCount = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const paged = freightOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return { orders: paged, allOrders: freightOrders, total, page, pageCount, shop };
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