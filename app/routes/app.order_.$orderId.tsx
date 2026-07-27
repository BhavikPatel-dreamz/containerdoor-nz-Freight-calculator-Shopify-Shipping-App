/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { FreightOrderDetail } from "../components/freight/FreightOrderDetail";
import { NavUserAvatar } from "../components/freight/NavUserAvatar";
import {
  buildRowFromSnapshot,
} from "../lib/freight-orders.server";

/**
 * Separate route: `/app/order/:orderId?variantId=`
 * Loader returns one order only — never the list.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { authenticate } = await import("../shopify.server");
  const { currentUserFromSession } = await import("../lib/current-user.server");
  const { default: prisma } = await import("../db.server");

  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const currentUser = currentUserFromSession(session);
  // URL must use OMS OrderSnapshot.orderId (= Shopify numeric order id).
  // Accept accidental GID / whitespace from older links.
  const orderId = String(params.orderId || "")
    .replace(/^gid:\/\/shopify\/Order\//, "")
    .trim();

  // Prefer shop+orderId (canonical). Fallback: OrderSnapshot cuid if someone
  // linked with primary key — still resolve to the same DB row.
  let snap =
    orderId
      ? await prisma.orderSnapshot.findUnique({
          where: { shop_orderId: { shop, orderId } },
        })
      : null;
  if (!snap && orderId) {
    snap = await prisma.orderSnapshot.findFirst({
      where: { shop, OR: [{ id: orderId }, { orderId }] },
    });
  }
  if (!snap) throw new Response("Order not found", { status: 404 });

  // Always key ops by the snapshot's Shopify orderId (DB column), not URL quirks.
  const dbOrderId = String(snap.orderId);
  const { opsMap, orderCin7Map } = await buildOpsMapsForOrder(prisma, shop, dbOrderId);
  const row = buildRowFromSnapshot(snap, opsMap, orderCin7Map);
  if (!row) throw new Response("Order has no freight shipping line", { status: 404 });

  return { row, shop, currentUser, orderId: dbOrderId };
}

/** Leaner than full-shop buildOpsMaps — detail page only needs this order. */
async function buildOpsMapsForOrder(prisma: any, shop: string, orderId: string) {
  const allOpsData = await prisma.orderLineItemOperationalData.findMany({
    where: { shop, orderId },
  });
  const opsMap = new Map<string, any>(
    allOpsData.map((r: any) => [`${r.orderId}::${r.variantId}`, r]),
  );

  const orderOpData = await prisma.orderOperationalData.findMany({
    where: { shop, orderId },
    select: { orderId: true, cin7SalesOrderId: true },
  });
  const orderCin7Map = new Map<string, boolean>(
    orderOpData
      .filter((row: any) => Boolean(row.cin7SalesOrderId && row.cin7SalesOrderId !== "pending"))
      .map((row: any) => [row.orderId, true] as [string, boolean]),
  );

  return { opsMap, orderCin7Map };
}

export default function FreightOrderDetailPage() {
  const { row, shop, currentUser } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const variantId = searchParams.get("variantId") ?? undefined;

  return (
    <FreightOrderDetail
      order={row as any}
      shop={shop}
      noteAuthor={currentUser.noteAuthor}
      variantId={variantId}
      backHref="/app"
      navbarRight={
        <NavUserAvatar
          name={currentUser.name}
          email={currentUser.email}
          initials={currentUser.initials}
        />
      }
    />
  );
}
