import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logWebhookPayload, processShopifyRefundsToCin7 } from "../lib/shopify-refund-cin7.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const refund = payload as { id?: number; order_id?: number };
  const orderId = String(refund?.order_id ?? "");
  console.log(
    `[RefundCin7] webhook REFUNDS_CREATE shop=${shop} orderId=${orderId} refundId=${String(refund?.id ?? "")} lineItems=${Array.isArray((payload as any)?.refund_line_items) ? (payload as any).refund_line_items.length : 0}`,
  );
  logWebhookPayload("[RefundCin7]", "refunds/create", payload);
  if (!orderId) {
    console.warn(`[RefundCin7] webhook REFUNDS_CREATE SKIP no order_id`);
    return new Response();
  }
  const snap = await prisma.orderSnapshot.findUnique({
    where: { shop_orderId: { shop, orderId } },
    select: { orderName: true, email: true },
  });
  console.log(`[RefundCin7] webhook REFUNDS_CREATE omsName=${snap?.orderName || "(no snapshot)"} omsEmail=${snap?.email || "(none)"}`);
  try {
    const result = await processShopifyRefundsToCin7(shop, {
      id: Number(orderId),
      name: snap?.orderName || "",
      email: snap?.email || "",
      refunds: [payload],
    } as any);
    console.log(`[RefundCin7] webhook REFUNDS_CREATE done orderId=${orderId}`, result);
  } catch (error) {
    console.error(`[RefundCin7] webhook REFUNDS_CREATE FAILED orderId=${orderId}`, error);
  }
  return new Response();
};
