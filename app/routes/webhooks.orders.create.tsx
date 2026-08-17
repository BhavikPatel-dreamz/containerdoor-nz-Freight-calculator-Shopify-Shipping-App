import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { enqueueOrderWebhookJob, type OrderPayload } from "../lib/order-webhook.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, topic, shop, webhookId } = await authenticate.webhook(request);
  const order = payload as OrderPayload;

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
