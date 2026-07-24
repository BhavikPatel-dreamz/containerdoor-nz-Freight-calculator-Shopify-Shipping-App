/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import FreightDashboard from "../components/FreightDashboard";
import {
  buildRowFromSnapshot,
  buildOpsMaps,
} from "../lib/freight-orders.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { authenticate } = await import("../shopify.server");
  const { default: prisma } = await import("../db.server");

  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const orderId = params.orderId!;

  // Load the DB snapshot so the detail view renders identical data to the list.
  const snap = await prisma.orderSnapshot.findUnique({
    where: { shop_orderId: { shop, orderId } },
  });
  if (!snap) throw new Response("Order not found", { status: 404 });

  const { opsMap, orderCin7Map } = await buildOpsMaps(prisma, shop);
  const row = buildRowFromSnapshot(snap, opsMap, orderCin7Map);
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
      detailBackHref="/app"
    />
  );
}
