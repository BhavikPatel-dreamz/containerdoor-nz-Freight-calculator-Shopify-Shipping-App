/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import prisma from "../db.server";
import FreightDashboard from "../components/FreightDashboard";
import { buildRowFromSnapshot } from "../lib/freight-orders.server";

const PAGE_SIZE = 25;

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const { authenticate } = await import("../shopify.server");

  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const page = Math.max(Number(url.searchParams.get("page") || "1"), 1);

  // Fetch order snapshots from DB — no Shopify API call needed
  const snapshots = await prisma.orderSnapshot.findMany({
    where: { shop, carriers: { not: "" } },
    orderBy: { createdAt: "desc" },
  });

  // Batch-load operational data
  const allOpsData = await prisma.orderLineItemOperationalData.findMany({ where: { shop } });
  const opsMap = new Map(allOpsData.map((r) => [`${r.orderId}::${r.variantId}`, r]));

  const orderOpData = await prisma.orderOperationalData.findMany({
    where: { shop },
    select: { orderId: true, cin7SalesOrderId: true },
  });
  const orderCin7Map = new Map(
    orderOpData
      .filter((row) => Boolean(row.cin7SalesOrderId && row.cin7SalesOrderId !== "pending"))
      .map((row) => [row.orderId, true]),
  );

  // Build rows from snapshots (same shape as before)
  const freightOrders = snapshots
    .map((snap) => buildRowFromSnapshot(snap, opsMap, orderCin7Map))
    .filter((row): row is NonNullable<ReturnType<typeof buildRowFromSnapshot>> => Boolean(row));

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
