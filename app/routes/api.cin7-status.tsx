/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { fetchCin7SalesOrder, diffCin7Fields } from "../lib/cin7.server";

type LineItemInput = { variantId: string; trackingNumber?: string; eddDate?: string; company?: string };
type OrderInput = { orderId: string; lineItems: LineItemInput[] };

const CIN7_STATUS_CACHE_MS = Number(process.env.CIN7_STATUS_CACHE_MS ?? 5 * 60 * 1000);

type Cin7Result = { variantId: string; status: string; mismatches: string[] };

async function persistCin7StatusCache(shop: string, orderId: string, results: Cin7Result[]) {
  try {
    await prisma.orderOperationalData.upsert({
      where: { shop_orderId: { shop, orderId } },
      create: { shop, orderId, cin7StatusCheckedAt: new Date() },
      update: { cin7StatusCheckedAt: new Date() },
    });
    // Raw query on purpose: writing cache columns must NOT touch `updatedAt`,
    // since `updatedAt` is used elsewhere to detect real freight-tab edits
    // vs. Cin7-side edits. A normal prisma upsert() DOES bump updatedAt on
    // every poll, which was silently making every refresh look like a
    // "freight is newer" edit and pushing stale local values back to Cin7.
    await Promise.all(results.map((r) =>
      prisma.$executeRaw`
        INSERT INTO "OrderLineItemOperationalData"
          ("id","shop","orderId","variantId","cin7CachedStatus","cin7CachedMismatches","createdAt","updatedAt")
        VALUES
          (${`c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}, ${shop}, ${orderId}, ${r.variantId}, ${r.status}, ${r.mismatches.join(",")}, now(), now())
        ON CONFLICT ("shop","orderId","variantId")
        DO UPDATE SET "cin7CachedStatus" = EXCLUDED."cin7CachedStatus", "cin7CachedMismatches" = EXCLUDED."cin7CachedMismatches"
      `
    ));
  } catch (cacheErr) {
    console.error("[Cin7][Status] Failed to persist cache", cacheErr);
    // fallback stays as-is (rarely hit) — same raw-query treatment could be
    // applied here too if you want belt-and-suspenders, but not required for this fix.
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  try {
    const body = (await request.json()) as {
      shop?: string; orderId?: string; lineItems?: LineItemInput[]; orders?: OrderInput[]; force?: boolean;
    };
    const { shop, force } = body;
    if (!shop) return Response.json({ error: "Missing shop" }, { status: 400 });

    // Accept the old single-order shape too, so nothing else breaks
    const orders: OrderInput[] = body.orders ?? (body.orderId && body.lineItems
      ? [{ orderId: body.orderId, lineItems: body.lineItems }]
      : []);
    if (orders.length === 0) return Response.json({ error: "Missing orderId/lineItems or orders" }, { status: 400 });

    // ONE query for every order's DB record, instead of N
    const records = await prisma.orderOperationalData.findMany({
      where: { shop, orderId: { in: orders.map((o) => o.orderId) } },
      select: { orderId: true, cin7SalesOrderId: true, cin7StatusCheckedAt: true },
    });
    const recordByOrderId = new Map(records.map((r) => [r.orderId, r]));

    const lineRecords = await prisma.orderLineItemOperationalData.findMany({
      where: { shop, orderId: { in: orders.map((o) => o.orderId) } },
      select: { orderId: true, variantId: true, cin7CachedStatus: true, cin7CachedMismatches: true },
    });
    const lineCacheMap = new Map(lineRecords.map((r) => [`${r.orderId}::${r.variantId}`, r]));

    const perOrderResults: Record<string, { cin7SalesOrderId: string | null; results: any[] }> = {};
    const now = Date.now();

    // Cin7 HTTP calls (not DB) — safe to run with limited concurrency
    const concurrency = 2;
    const queue = orders.slice();
    const worker = async () => {
      while (queue.length > 0) {
        const order = queue.shift();
        if (!order) break;
        const record = recordByOrderId.get(order.orderId);
        const cin7SalesOrderId = record?.cin7SalesOrderId;

        if (!cin7SalesOrderId || cin7SalesOrderId === "pending") {
          const results = order.lineItems.map((li) => ({ variantId: li.variantId, status: "missing", mismatches: [] }));
          perOrderResults[order.orderId] = { cin7SalesOrderId: null, results };
          await persistCin7StatusCache(shop, order.orderId, results);
          continue;
        }

        if (cin7SalesOrderId === "duplicate") {
          const results = order.lineItems.map((li) => ({ variantId: li.variantId, status: "error", mismatches: [] }));
          perOrderResults[order.orderId] = { cin7SalesOrderId: null, results };
          await persistCin7StatusCache(shop, order.orderId, results);
          continue;
        }

        const checkedAt = record?.cin7StatusCheckedAt ? new Date(record.cin7StatusCheckedAt).getTime() : 0;
        const isFresh = !force && checkedAt && now - checkedAt < CIN7_STATUS_CACHE_MS;
        if (isFresh) {
          const allCached = order.lineItems.every((li) => lineCacheMap.has(`${order.orderId}::${li.variantId}`));
          if (allCached) {
            perOrderResults[order.orderId] = {
              cin7SalesOrderId,
              results: order.lineItems.map((li) => {
                const cached = lineCacheMap.get(`${order.orderId}::${li.variantId}`) as
                  | { cin7CachedStatus?: string | null; cin7CachedMismatches?: string | null }
                  | undefined;
                const cachedMismatchText = typeof cached?.cin7CachedMismatches === "string"
                  ? cached.cin7CachedMismatches
                  : "";
                return {
                  variantId: li.variantId,
                  status: cached?.cin7CachedStatus || "missing",
                  mismatches: cachedMismatchText ? cachedMismatchText.split(",").filter(Boolean) : [],
                };
              }),
            };
            continue;
          }
        }

        const snapshot = await fetchCin7SalesOrder(cin7SalesOrderId);
        if (!snapshot) {
          const results = order.lineItems.map((li) => ({ variantId: li.variantId, status: "missing", mismatches: [] }));
          perOrderResults[order.orderId] = { cin7SalesOrderId, results };
          await persistCin7StatusCache(shop, order.orderId, results);
          continue;
        }

        if (snapshot.isVoid || Boolean(snapshot.cancellationDate)) {
          const results = order.lineItems.map((li) => ({ variantId: li.variantId, status: "error", mismatches: [] }));
          perOrderResults[order.orderId] = { cin7SalesOrderId, results };
          await persistCin7StatusCache(shop, order.orderId, results);
          continue;
        }

        const results = order.lineItems.map((li) => {
          const mismatches = diffCin7Fields(li, snapshot);
          return { variantId: li.variantId, status: mismatches.length ? "mismatch" : "match", mismatches };
        });
        perOrderResults[order.orderId] = {
          cin7SalesOrderId,
          results,
        };

        await persistCin7StatusCache(shop, order.orderId, results);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, orders.length) }, worker));

    // Keep old response shape for single-order callers
    if (body.orderId && !body.orders) {
      return Response.json(perOrderResults[body.orderId] ?? { cin7SalesOrderId: null, results: [] });
    }
    return Response.json({ orders: perOrderResults });
  } catch (error) {
    console.error("[Cin7][Status] Error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
};