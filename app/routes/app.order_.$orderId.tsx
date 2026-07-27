/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { FreightOrderDetail } from "../components/freight/FreightOrderDetail";
import { NavUserAvatar } from "../components/freight/NavUserAvatar";
import {
  buildRowFromSnapshot,
} from "../lib/freight-orders.server";

/**
 * Detail route: `/app/order/:id`
 * `id` = OrderLineItemIndex.id (preferred) or OrderSnapshot.id / Shopify orderId (legacy).
 * variantId lives in DB on the index row — not required in the URL.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { authenticate } = await import("../shopify.server");
  const { currentUserFromSession } = await import("../lib/current-user.server");
  const { default: prisma } = await import("../db.server");

  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const currentUser = currentUserFromSession(session);
  const paramId = String(params.orderId || "")
    .replace(/^gid:\/\/shopify\/Order\//, "")
    .trim();

  if (!paramId) throw new Response("Order not found", { status: 404 });

  let shopifyOrderId = "";
  let focusVariantId: string | undefined;
  let focusLineIndexId: string | undefined;

  // 1) Preferred: OrderLineItemIndex.id — has orderId + variantId in DB
  const lineIdx = await prisma.orderLineItemIndex.findFirst({
    where: { shop, id: paramId },
    select: { id: true, orderId: true, variantId: true },
  });
  if (lineIdx) {
    shopifyOrderId = String(lineIdx.orderId);
    focusVariantId = String(lineIdx.variantId || "") || undefined;
    focusLineIndexId = lineIdx.id;
  }

  // 2) OrderSnapshot.id (cuid)
  let snap = lineIdx
    ? await prisma.orderSnapshot.findUnique({
        where: { shop_orderId: { shop, orderId: shopifyOrderId } },
      })
    : await prisma.orderSnapshot.findFirst({
        where: { shop, id: paramId },
      });

  // 3) Legacy: Shopify numeric orderId
  if (!snap) {
    snap = await prisma.orderSnapshot.findUnique({
      where: { shop_orderId: { shop, orderId: paramId } },
    });
  }
  if (!snap) throw new Response("Order not found", { status: 404 });

  shopifyOrderId = String(snap.orderId);
  const { opsMap, orderCin7Map } = await buildOpsMapsForOrder(prisma, shop, shopifyOrderId);
  const row = buildRowFromSnapshot(snap, opsMap, orderCin7Map);
  if (!row) throw new Response("Order has no freight shipping line", { status: 404 });

  // Attach OrderLineItemIndex.id on each line so client can fetch by single id.
  const indexRows = await prisma.orderLineItemIndex.findMany({
    where: { shop, orderId: shopifyOrderId },
    select: { id: true, variantId: true },
  });
  const indexByVariant = new Map(
    indexRows.map((r: { id: string; variantId: string }) => [String(r.variantId), r.id]),
  );
  row.lineItems = row.lineItems.map((li: any) => ({
    ...li,
    lineIndexId: indexByVariant.get(String(li.variantId)) || li.lineIndexId || "",
  }));

  if (!focusVariantId) {
    focusVariantId = row.lineItems[0]?.variantId;
  }
  if (!focusLineIndexId && focusVariantId) {
    focusLineIndexId = indexByVariant.get(String(focusVariantId));
  }

  return {
    row,
    shop,
    currentUser,
    snapshotId: snap.id,
    orderId: shopifyOrderId,
    variantId: focusVariantId,
    lineIndexId: focusLineIndexId,
  };
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
  const { row, shop, currentUser, variantId, lineIndexId } = useLoaderData<typeof loader>();

  return (
    <FreightOrderDetail
      order={row as any}
      shop={shop}
      noteAuthor={currentUser.noteAuthor}
      variantId={variantId}
      lineIndexId={lineIndexId}
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
