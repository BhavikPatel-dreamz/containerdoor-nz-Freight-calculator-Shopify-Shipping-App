import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { processShopifyRefundsToCin7 } from "../lib/shopify-refund-cin7.server";

/** Shared failed-sync list for Cin7 Credit Notes (launch). */
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const status = (url.searchParams.get("status") || "failed").trim();
  console.log(`[RefundCin7] GET /api/cin7-credit-notes shop=${shop} status=${status}`);
  const rows = await prisma.cin7CreditNoteSync.findMany({
    where: status === "all" ? { shop } : { shop, status },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return Response.json({ ok: true, shop, rows });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = (await request.json().catch(() => ({}))) as { id?: string; retry?: boolean };
  if (!body.id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
  const row = await prisma.cin7CreditNoteSync.findFirst({ where: { id: body.id, shop } });
  if (!row) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  console.log(`[RefundCin7] retry id=${body.id} shop=${shop} orderId=${row.orderId} refund=${row.shopifyRefundId} status=${row.status}`);
  if (row.status === "sent") {
    console.log(`[RefundCin7] retry SKIP already sent cin7CreditNoteId=${row.cin7CreditNoteId}`);
    return Response.json({ ok: true, skipped: true, reason: "already sent" });
  }
  const snap = await prisma.orderSnapshot.findUnique({
    where: { shop_orderId: { shop, orderId: row.orderId } },
    select: { orderName: true },
  });
  const result = await processShopifyRefundsToCin7(shop, {
    id: Number(row.orderId) || undefined,
    name: snap?.orderName || row.shopifyOrderName,
    refunds: JSON.parse(row.payloadJson || "{}")?.shopifyRefundId
      ? [
          {
            id: row.shopifyRefundId,
            refund_line_items: [
              {
                quantity: 1,
                subtotal: Number(row.amount) - Number(row.freightAmount),
                total_tax: 0,
                line_item: { variant_id: row.variantId, sku: "", title: "Refund retry" },
              },
            ],
            transactions: [{ gateway: row.refundMethod }],
          },
        ]
      : [],
  } as any);
  console.log(`[RefundCin7] retry done id=${body.id}`, result);
  return Response.json({ ok: true, result });
}
