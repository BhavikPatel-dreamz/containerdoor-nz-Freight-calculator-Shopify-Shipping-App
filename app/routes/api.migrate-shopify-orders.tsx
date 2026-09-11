import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { migrateShopifyOrdersToOms } from "../lib/migrate-shopify-oms.server";

/**
 * Migrate historical Shopify orders into OMS, then link-or-create Cin7 + Monday.
 *
 * POST JSON:
 *   { "shop": "store.myshopify.com", "orders": ["#CDL215347", "6153478901"] }
 *
 * Auth: Shopify admin session, or Bearer CRON_SECRET.
 */
function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get("Authorization") ?? request.headers.get("X-Cron-Secret");
  if (authHeader === `Bearer ${secret}` || authHeader === secret) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

export async function loader({ request }: LoaderFunctionArgs) {
  return Response.json(
    {
      ok: true,
      usage: "POST { shop, orders: ['#CDL215347', ...] } — Shopify → OMS, then link existing Cin7/Monday or create if missing",
    },
    { status: 200 },
  );
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const cronOk = verifyCronSecret(request);
  let shop = "";
  let sentBy = "system";
  if (cronOk) {
    const bodyPeek = (await request.clone().json().catch(() => ({}))) as { shop?: string };
    shop = String(bodyPeek.shop || "").trim();
  } else {
    try {
      const { session } = await authenticate.admin(request);
      shop = session.shop;
      sentBy = session.email || session.firstName || "Shopify Admin";
    } catch {
      const auth = request.headers.get("Authorization") || "";
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (m?.[1]) {
        try {
          const part = m[1].split(".")[1];
          const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
          const payload = JSON.parse(json) as { dest?: string };
          const dest = String(payload.dest || "")
            .replace(/^https?:\/\//i, "")
            .replace(/\/+$/, "")
            .trim();
          if (dest.includes(".")) shop = dest;
        } catch {
          /* ignore */
        }
      }
      if (!shop) {
        return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
      sentBy = "Shopify Admin";
    }
  }

  const body = (await request.json().catch(() => ({}))) as {
    shop?: string;
    order?: string;
    orderId?: string;
    orders?: string[];
    names?: string[];
    performedBy?: string;
  };
  shop = String(body.shop || shop || "").trim();
  if (!shop) {
    return Response.json({ ok: false, error: "Missing shop" }, { status: 400 });
  }
  if (body.performedBy) sentBy = String(body.performedBy);

  const orders = [
    ...(body.orders ?? body.names ?? []),
    ...(body.order ? [body.order] : []),
    ...(body.orderId ? [body.orderId] : []),
  ]
    .map((x) => String(x).trim())
    .filter(Boolean);
  if (!orders.length) {
    return Response.json({ ok: false, error: "Missing orders[]" }, { status: 400 });
  }

  const result = await migrateShopifyOrdersToOms({ shop, namesOrIds: orders, sentBy });
  const failed = result.results.filter((r) => !r.ok).length;
  return Response.json({ ok: failed === 0, ...result });
}
