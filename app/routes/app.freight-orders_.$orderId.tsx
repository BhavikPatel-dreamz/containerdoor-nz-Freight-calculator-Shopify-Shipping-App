/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import FreightDashboard from "../components/FreightDashboard";
import {
  buildRow,
  buildOpsMaps,
  FREIGHT_ORDER_FIELDS,
  type ShopifyOrderNode,
} from "../lib/freight-orders.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { authenticate } = await import("../shopify.server");
  const { default: prisma } = await import("../db.server");

  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const orderId = params.orderId!;

  const response = await admin.graphql(
    `#graphql
    query FreightOrderDetail($id: ID!) {
      order(id: $id) {
        ...FreightOrderFields
      }
    }
    ${FREIGHT_ORDER_FIELDS}`,
    { variables: { id: `gid://shopify/Order/${orderId}` } }
  );

  const json = await response.json();
  const order: ShopifyOrderNode | null = json.data?.order ?? null;
  if (!order) throw new Response("Order not found", { status: 404 });

  const { opsMap, orderCin7Map } = await buildOpsMaps(prisma, shop);
  const row = buildRow(order, opsMap, orderCin7Map);
  if (!row) throw new Response("Order has no freight shipping line", { status: 404 });

  return { row, shop };
}

export default function FreightOrderDetailPage() {
  const { row, shop } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const variantId = searchParams.get("variantId") ?? undefined;

  return (
    <FreightDashboard
      orders={[row] as any}
      allOrders={[row] as any}
      total={1}
      page={1}
      pageCount={1}
      shop={shop}
      noteAuthor="SP"
      navbarRight={<div className="fo-avatar">SP</div>}
      initialDetailOrderId={row.shopifyOrderId}
      initialDetailVariantId={variantId}
      detailBackHref="/app/freight-orders"
    />
  );
}
