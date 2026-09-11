import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { enqueueOrderWebhookJob, writeFreightMetafield, type OrderPayload } from "../lib/order-webhook.server";
import { isFreightShippingCode, parseFreightCode } from "../lib/freight";

// TEMP DEBUG ONLY (remove after verification): forward the raw orders/create
// payload to the test endpoint so we can inspect per-line product + freight.
const DEBUG_TEST_ENDPOINT = "https://webhook.site/edc3eb4a-e987-43f5-85a8-3ac9627706ae";

const round2 = (n: number) => Math.round(n * 100) / 100;

// TEMP DEBUG ONLY: build a per-line verification object (product amount, freight
// amount, total) from the EXISTING Shopify line items + encoded freight code.
// No re-calculation of freight, no changes to any existing behavior/data.
function buildDebugVerification(order: OrderPayload) {
  const freightLine = (order.shipping_lines ?? []).find((s) => isFreightShippingCode(s.code));
  const breakdown = parseFreightCode(freightLine?.code, order.line_items);

  const freightByVariant = new Map<string, number>();
  for (const item of breakdown?.lineItems ?? []) {
    freightByVariant.set(String(item.variantId), Number(item.amount ?? 0));
  }

  const lineItems = (order.line_items ?? []).map((li) => {
    const variantId = String(li.variant_id ?? "");
    const quantity = Number(li.quantity ?? 0);
    const unitPrice = Number(li.price_set?.presentment_money?.amount ?? li.price ?? 0);
    const productAmount = round2(unitPrice * quantity);
    const freightAmount = round2(freightByVariant.get(variantId) ?? 0);
    return {
      sku: li.sku ?? "",
      variantId,
      quantity,
      unitPrice: round2(unitPrice),
      productAmount,
      freightAmount,
      individualTotal: round2(productAmount + freightAmount),
    };
  });

  return {
    orderId: String(order.id ?? ""),
    orderName: order.name ?? "",
    currency: order.currency ?? order.presentment_currency ?? "",
    freightShippingCode: freightLine?.code ?? "",
    lineItems,
  };
}

// TEMP DEBUG ONLY: fire-and-forget POST of the exact payload Shopify sent plus a
// per-line verification object. Bounded by an AbortController timeout; any
// error/timeout/non-2xx is swallowed so the normal orders/create flow below can
// never be blocked or broken.
async function postRawOrderToTestEndpoint(order: OrderPayload): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(DEBUG_TEST_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order, debug: buildDebugVerification(order) }),
      signal: controller.signal,
    });
    const text = (await res.text().catch(() => "")).slice(0, 2000);
    console.log(`[TEMP-DEBUG] test endpoint POST for orderId=${String(order.id ?? "")} status=${res.status} response=${text}`);
  } catch (e) {
    console.error("[TEMP-DEBUG] test endpoint POST failed (ignored, order processing continues):", e);
  } finally {
    clearTimeout(timer);
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, topic, shop, webhookId } = await authenticate.webhook(request);
  const order = payload as OrderPayload;

  await postRawOrderToTestEndpoint(order);

  // Persist the already-calculated per-line freight breakdown to the order
  // metafield immediately (no wait for the queued worker). Same helper the
  // worker calls; it skips the write when the metafield already exists, so the
  // queued worker won't write it a second time. Never blocks/fails the webhook.
  try {
    const { admin } = await unauthenticated.admin(shop);
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
