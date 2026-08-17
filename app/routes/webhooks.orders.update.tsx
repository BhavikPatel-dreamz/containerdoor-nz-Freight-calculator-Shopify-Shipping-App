import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { type OrderPayload, saveOrderSnapshot, attemptCreatePaymentsForOrder } from "../lib/order-webhook.server";
import { reindexOrderById } from "../lib/line-index.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const order = payload as OrderPayload;

  // Refresh the DB snapshot + per-line-item index so the freight-orders list
  // reflects edits (e.g. financial status, added/removed freight lines).
  // Cin7/Monday entries remain create-time only.
  if (order.id) {
    try {
      console.log(`[Cin7PaymentWebhook] topic=ORDERS_UPDATED`);
      console.log(`[Cin7PaymentWebhook] orderId=${String(order.id ?? "")}`);
      console.log(`[Cin7PaymentWebhook] orderNumber=${String(order.name ?? "")}`);
      console.log(`[Cin7PaymentWebhook] financial_status=${String((order as any).financial_status ?? "")}`);
      console.log(`[Cin7PaymentWebhook] current_total_price=${String((order as any).current_total_price ?? "")}`);
      console.log(`[Cin7PaymentWebhook] total_price=${String((order as any).total_price ?? "")}`);
      console.log(`[Cin7PaymentWebhook] current_subtotal_price=${String((order as any).current_subtotal_price ?? "")}`);
      console.log(`[Cin7PaymentWebhook] subtotal_price=${String((order as any).subtotal_price ?? "")}`);
    } catch (e) {}
    await saveOrderSnapshot(shop, order);
    await reindexOrderById(shop, String(order.id));
    // Attempt payment-only processing (idempotent, per-line)
    try {
      console.log(`[Cin7PaymentWebhook] calling payment retry orderId=${String(order.id)}`);
      await attemptCreatePaymentsForOrder(shop, order);
      console.log(`[Cin7PaymentWebhook] payment retry finished orderId=${String(order.id)} result=ok`);
    } catch (e) {
      console.error(`[Cin7Payment] orders.update payment attempt failed for ${String(order.id)}:`, e);
      try {
        console.log(`[Cin7PaymentWebhook] payment retry finished orderId=${String(order.id)} result=error ${String((e as any)?.message ?? e)}`);
      } catch (e2) {}
    }
  }

  return new Response();
};
