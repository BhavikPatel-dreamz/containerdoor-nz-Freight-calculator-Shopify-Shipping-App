import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { cronUnauthorized, verifyCronSecret } from "../lib/cron-auth.server";
import {
  countShopifyOrders,
  findNextEligibleShopifyOrder,
} from "../lib/migrate-shopify-oms.server";
import { processShopifyOrder, summarizeSyncSystems } from "../lib/process-shopify-order.server";
import { loadOrderSyncCursor, saveOrderSyncCursor } from "../lib/order-sync-cursor.server";

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

function envShop(): string {
  return String(
    process.env.ORDER_SYNC_SHOP || process.env.SHOPIFY_SHOP || process.env.SHOP || "",
  ).trim();
}

async function resolveAdmin(request: Request, explicitShop: string) {
  let shop = String(explicitShop || "").trim();
  if (verifyCronSecret(request)) {
    shop = shop || envShop();
    if (!shop) throw new Error("Unauthorized");
    const { admin } = await unauthenticated.admin(shop);
    return { shop, admin, sentBy: "order-sync-cron" };
  }
  try {
    const auth = await authenticate.admin(request);
    shop = shop || String(auth.session?.shop || "").trim();
    if (auth.admin) return { shop, admin: auth.admin, sentBy: auth.session?.shop || shop };
  } catch (e) {
    console.warn("[order-sync-step] authenticate.admin failed, using offline session", e);
  }
  shop = shop || shopFromBearerJwt(request) || envShop();
  if (!shop) throw new Error("Unauthorized");
  const { admin } = await unauthenticated.admin(shop);
  return { shop, admin, sentBy: shop };
}

type StepBody = {
  shop?: string;
  mode?: "dry_run" | "full";
  after?: string | null;
  newestFirst?: boolean;
  skipIds?: string[];
  countOnly?: boolean;
  persist?: boolean;
  resetCursor?: boolean;
  statusOnly?: boolean;
};

async function runStep(request: Request, body: StepBody) {
  const persist = Boolean(body.persist) || verifyCronSecret(request);
  let ctx: Awaited<ReturnType<typeof resolveAdmin>>;
  try {
    ctx = await resolveAdmin(request, String(body.shop || ""));
  } catch {
    return Response.json({ ok: false, error: "Unauthorized", done: true }, { status: 401 });
  }
  const { shop, admin, sentBy } = ctx;

  if (body.resetCursor && persist) {
    await saveOrderSyncCursor({ shop, reset: true });
  }

  if (body.statusOnly) {
    const cursor = await loadOrderSyncCursor(shop);
    return Response.json({
      ok: true,
      shop,
      cursor,
      message: cursor?.lastOrderName
        ? `Last sync ${cursor.lastOrderName}${cursor.lastOk === false ? " FAIL" : cursor.lastOk ? " OK" : ""} — will resume from saved page`
        : "No saved cursor yet — starting from newest",
    });
  }

  if (body.countOnly) {
    const total = await countShopifyOrders(admin);
    return Response.json({ ok: true, total, shop });
  }

  const saved = persist ? await loadOrderSyncCursor(shop) : null;
  const mode = body.mode === "dry_run" ? "dry_run" : "full";
  const newestFirst = body.newestFirst !== false;
  const after =
    body.after != null && String(body.after).trim()
      ? String(body.after)
      : saved?.caughtUp
        ? null
        : saved?.after || null;
  const skipIds = [
    ...new Set([
      ...(Array.isArray(body.skipIds) ? body.skipIds.map(String) : []),
      ...(saved?.skipIds || []),
    ]),
  ].slice(-1500);

  if (saved?.lastOrderName) {
    console.log(
      `[order-sync-step] resume shop=${shop} last=${saved.lastOrderName} processed=${saved.processed} after=${after ? "yes" : "start"}`,
    );
  }

  const next = await findNextEligibleShopifyOrder(admin, shop, {
    newestFirst,
    after,
    maxPages: 20,
    skipIds,
  });

  if ("error" in next) {
    if (persist) {
      await saveOrderSyncCursor({
        shop,
        after: next.resumeAfter,
        skipIds,
        lastMessage: next.error,
        caughtUp: Boolean(next.done),
        ...(next.done ? { after: "", skipIds: [] } : {}),
      });
    }
    return Response.json({
      ok: next.done !== false,
      done: Boolean(next.done),
      continueScan: next.done === false,
      message: next.error,
      after: next.resumeAfter,
      skippedCompleted: next.skippedCompleted,
      pagesScanned: next.pagesScanned,
      resumedFrom: saved?.lastOrderName || null,
    });
  }

  const nextSkip = skipIds.includes(next.orderId) ? skipIds : [...skipIds, next.orderId];

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
    if (persist) {
      await saveOrderSyncCursor({
        shop,
        after: next.resumeAfter,
        skipIds: nextSkip,
        lastOrderId: next.orderId,
        lastOrderName: next.orderName,
        lastOk: false,
        lastMessage: message,
        bumpProcessed: true,
        bumpFailed: true,
        caughtUp: false,
      });
    }
    return Response.json({
      ok: false,
      done: false,
      after: next.resumeAfter,
      skippedCompleted: next.skippedCompleted,
      resumedFrom: saved?.lastOrderName || null,
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

  if (persist) {
    await saveOrderSyncCursor({
      shop,
      after: next.resumeAfter,
      skipIds: nextSkip,
      lastOrderId: one.orderId || next.orderId,
      lastOrderName: one.orderName || next.orderName,
      lastOk: one.ok,
      lastMessage: one.ok ? "Synced" : one.error || "Failed",
      bumpProcessed: true,
      bumpSuccess: one.ok,
      bumpFailed: !one.ok,
      caughtUp: false,
    });
  }

  return Response.json({
    ok: one.ok,
    done: false,
    after: next.resumeAfter,
    skippedCompleted: next.skippedCompleted,
    resumedFrom: saved?.lastOrderName || null,
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

export async function loader({ request }: LoaderFunctionArgs) {
  if (!verifyCronSecret(request)) {
    return cronUnauthorized(request);
  }
  const url = new URL(request.url);
  const skip = String(url.searchParams.get("skipIds") || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return runStep(request, {
    shop: url.searchParams.get("shop") || undefined,
    mode: url.searchParams.get("mode") === "dry_run" ? "dry_run" : "full",
    after: url.searchParams.get("after"),
    newestFirst: url.searchParams.get("newestFirst") !== "0",
    skipIds: skip,
    countOnly: url.searchParams.get("countOnly") === "1",
    statusOnly: url.searchParams.get("status") === "1",
    persist: true,
    resetCursor: url.searchParams.get("reset") === "1",
  });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const body = (await request.json().catch(() => ({}))) as StepBody;
  if (verifyCronSecret(request)) body.persist = true;
  return runStep(request, body);
}
