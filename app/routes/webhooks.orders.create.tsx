import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { enqueueOrderWebhookJob, writeFreightMetafield, type OrderPayload } from "../lib/order-webhook.server";
import { attachBundleRelationships } from "../lib/bundles.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, topic, shop, webhookId } = await authenticate.webhook(request);
  const order = payload as OrderPayload;

  // Persist the already-calculated per-line freight breakdown to the order
  // metafield immediately (no wait for the queued worker). Same helper the
  // worker calls; it skips the write when the metafield already exists, so the
  // queued worker won't write it a second time. Never blocks/fails the webhook.
  try {
    const { admin } = await unauthenticated.admin(shop);
    try {
      await attachBundleRelationships(admin, order);
    } catch (e) {
      console.error(`[WebhookCreate] bundle hydration failed for order ${String(order.id ?? "")}:`, e);
    }
    await writeFreightMetafield(admin, order);
  } catch (e) {
    console.error(`[WebhookCreate] freight metafield write failed for order ${String(order.id ?? "")}:`, e);
  }

  console.log(`Queued ${topic} webhook for ${shop} (webhookId=${webhookId})`);

  if (!webhookId) {
    return new Response(null, { status: 200 });
  }

  await enqueueOrderWebhookJob(shop, String(topic), String(webhookId), order);

  return new Response(JSON.stringify({ ok: true, queued: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
