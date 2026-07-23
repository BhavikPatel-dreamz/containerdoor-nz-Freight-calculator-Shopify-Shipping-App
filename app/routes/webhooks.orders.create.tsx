import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  type OrderPayload,
  buildOrderSyncPayload,
  writeFreightMetafield,
  createOrderLineItemRecords,
  createMondayEntriesForOrder,
  createCin7EntryForOrder,
  saveOrderSnapshot,
} from "../lib/order-webhook.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const order = payload as OrderPayload;

  if (admin && order.id) {
    // 1. Save order snapshot to DB (so pages can fetch from DB, not Shopify API)
    await saveOrderSnapshot(shop, order);

    // 2. Create operational record for every line item
    await createOrderLineItemRecords(shop, order);

    // 2. Write freight breakdown to order metafield (for customer-account extension)
    await writeFreightMetafield(admin, order);

    // 3. Create Monday.com items (freight line items only)
    await createMondayEntriesForOrder(shop, order);

    // 4. Create Cin7 sales order (order-level)
    await createCin7EntryForOrder(shop, order);
  }

  const targets = [
    {
      name: "Monday",
      url: process.env.MONDAY_SYNC_URL,
      token: process.env.MONDAY_SYNC_TOKEN,
    },
  ];

  const syncPayload = buildOrderSyncPayload(shop, order);

  await Promise.all(
    targets.map(async (target) => {
      if (!target.url) return;
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (target.token) {
          headers.Authorization = `Bearer ${target.token}`;
        }
        const response = await fetch(target.url, {
          method: "POST",
          headers,
          body: JSON.stringify(syncPayload),
        });
        if (!response.ok) {
          console.error(`Order sync failed for ${target.name}: ${response.status}`);
        }
      } catch (error) {
        console.error(`Order sync request failed for ${target.name}`, error);
      }
    }),
  );

  return new Response();
};
