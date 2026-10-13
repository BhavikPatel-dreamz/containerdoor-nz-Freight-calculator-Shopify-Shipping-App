import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { cronUnauthorized, verifyCronSecret } from "../lib/cron-auth.server";
import { backfillShopifyCreatedAtBatch } from "../lib/backfill-shopify-created-at.server";

export const maxDuration = 60;

/**
 * Overwrite OMS OrderSnapshot + OrderLineItemIndex createdAt with Shopify order createdAt.
 *
 * GET /api/backfill-shopify-created-at?take=100&cursor=&dryRun=1
 * Auth: admin session, or Authorization: Bearer CRON_SECRET (+ shop= or ORDER_SYNC_SHOP)
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const take = Number(url.searchParams.get("take") || "100");
  const cursor = url.searchParams.get("cursor");
  const dryRun = url.searchParams.get("dryRun") === "1" || url.searchParams.get("dry_run") === "1";

  let shop = String(url.searchParams.get("shop") || process.env.ORDER_SYNC_SHOP || process.env.SHOPIFY_SHOP || "").trim();

  if (verifyCronSecret(request)) {
    if (!shop) {
      return Response.json({ ok: false, error: "shop required" }, { status: 400 });
    }
  } else {
    try {
      const { session } = await authenticate.admin(request);
      shop = shop || session.shop;
    } catch {
      return cronUnauthorized(request);
    }
  }

  const result = await backfillShopifyCreatedAtBatch({
    shop,
    cursor,
    take,
    dryRun,
  });

  return Response.json({ ok: true, ...result });
}
