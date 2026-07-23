import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { type OrderPayload, saveOrderSnapshot } from "../lib/order-webhook.server";
import { reindexOrderById } from "../lib/line-index.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const order = payload as OrderPayload;

  // Refresh the DB snapshot + per-line-item index so the freight-orders list
  // reflects edits (e.g. financial status, added/removed freight lines).
  // Cin7/Monday entries remain create-time only.
  if (order.id) {
    await saveOrderSnapshot(shop, order);
    await reindexOrderById(shop, String(order.id));
  }

  return new Response();
};
