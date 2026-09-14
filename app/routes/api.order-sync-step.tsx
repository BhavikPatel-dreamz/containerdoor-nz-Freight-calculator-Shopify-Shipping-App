import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import {
  countShopifyOrders,
  findNextEligibleShopifyOrder,
} from "../lib/migrate-shopify-oms.server";
import { processShopifyOrder, summarizeSyncSystems } from "../lib/process-shopify-order.server";

export const maxDuration = 60;

function shopFromBearerJwt(request: Request): string {
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m?.[1]) return "";
  try {
    const part = m[1].split(".")[1];
    if (!part) return "";
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(json) as { dest?: string };
    const dest = String(payload.dest || "")
      .replace(/^https?:\/\//i, "")
      .replace(/\/+$/, "")
      .trim();
    return dest.includes(".") ? dest : "";
  } catch {
    return "";
  }
}

async function resolveAdmin(request: Request, explicitShop: string) {
  let shop = String(explicitShop || "").trim();
  try {
    const auth = await authenticate.admin(request);
    shop = shop || String(auth.session?.shop || "").trim();
    if (auth.admin) return { shop, admin: auth.admin, sentBy: auth.session?.shop || shop };
  } catch (e) {
    console.warn("[order-sync-step] authenticate.admin failed, using offline session", e);
  }
  shop = shop || shopFromBearerJwt(request);
  if (!shop) throw new Error("Unauthorized");
  const { admin } = await unauthenticated.admin(shop);
  return { shop, admin, sentBy: shop };
}

/**
 * Process exactly one eligible Shopify order (newest first by default).
 * The Order Sync "Sync all" button calls this in a loop for the progress bar.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    shop?: string;
    mode?: "dry_run" | "full";
    after?: string | null;
    newestFirst?: boolean;
    skipIds?: string[];
    countOnly?: boolean;
  };

  let ctx: Awaited<ReturnType<typeof resolveAdmin>>;
  try {
    ctx = await resolveAdmin(request, String(body.shop || ""));
  } catch {
    return Response.json({ ok: false, error: "Unauthorized", done: true }, { status: 401 });
  }
  const { shop, admin, sentBy } = ctx;

  if (body.countOnly) {
    const total = await countShopifyOrders(admin);
    return Response.json({ ok: true, total, shop });
  }

  const mode = body.mode === "dry_run" ? "dry_run" : "full";
  const newestFirst = body.newestFirst !== false;
  const after = body.after ? String(body.after) : null;

  const next = await findNextEligibleShopifyOrder(admin, shop, {
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
      shop,
      admin,
      shopifyOrderId: next.orderId,
      sentBy,
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
