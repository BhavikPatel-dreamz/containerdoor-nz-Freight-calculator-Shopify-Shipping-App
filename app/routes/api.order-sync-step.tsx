import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  countShopifyOrders,
  findNextEligibleShopifyOrder,
} from "../lib/migrate-shopify-oms.server";
import { processShopifyOrder, summarizeSyncSystems } from "../lib/process-shopify-order.server";

/**
 * Process exactly one eligible Shopify order (newest first by default).
 * The Order Sync "Sync all" button calls this in a loop for the progress bar.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session, admin } = await authenticate.admin(request);
  const body = (await request.json().catch(() => ({}))) as {
    mode?: "dry_run" | "full";
    after?: string | null;
    newestFirst?: boolean;
    skipIds?: string[];
    countOnly?: boolean;
  };

  if (body.countOnly) {
    const total = await countShopifyOrders(admin);
    return Response.json({ ok: true, total });
  }

  const mode = body.mode === "dry_run" ? "dry_run" : "full";
  const newestFirst = body.newestFirst !== false;
  const after = body.after ? String(body.after) : null;

  const next = await findNextEligibleShopifyOrder(admin, session.shop, {
    newestFirst,
    after,
    maxPages: 20,
    skipIds: Array.isArray(body.skipIds) ? body.skipIds.map(String).slice(0, 2000) : [],
  });

  if ("error" in next) {
    return Response.json({
      ok: next.done !== false,
      done: Boolean(next.done),
      continueScan: next.done === false,
      message: next.error,
      after: next.resumeAfter,
      skippedCompleted: next.skippedCompleted,
      pagesScanned: next.pagesScanned,
    });
  }

  let one;
  try {
    one = await processShopifyOrder({
      shop: session.shop,
      admin,
      shopifyOrderId: next.orderId,
      sentBy: session.shop,
      mode,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({
      ok: false,
      done: false,
      after: next.resumeAfter,
      skippedCompleted: next.skippedCompleted,
      order: {
        id: next.orderId,
        name: next.orderName,
        ok: false,
        error: message,
        steps: [{ at: new Date().toISOString(), step: "error", ok: false, message }],
      },
    });
  }
  const systems = summarizeSyncSystems(one);

  return Response.json({
    ok: one.ok,
    done: false,
    after: next.resumeAfter,
    skippedCompleted: next.skippedCompleted,
    order: {
      id: one.orderId || next.orderId,
      name: one.orderName || next.orderName,
      ok: one.ok,
      error: one.error,
      steps: one.steps,
    },
    systems,
  });
}
