import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  console.log("[ORDERS/UPDATE WEBHOOK PAYLOAD]", JSON.stringify(payload, null, 2));

  // No-op for now — Cin7/Monday entries are created on orders/create.
  // Add order-update logic here (task pending).

  return new Response();
};
