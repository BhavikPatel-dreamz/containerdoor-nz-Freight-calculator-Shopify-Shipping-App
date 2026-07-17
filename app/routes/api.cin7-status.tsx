/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { fetchCin7SalesOrder, diffCin7Fields } from "../lib/cin7.server";

type LineItemInput = { variantId: string; trackingNumber?: string; eddDate?: string; company?: string };
type OrderInput = { orderId: string; lineItems: LineItemInput[] };

const CIN7_STATUS_CACHE_MS = Number(process.env.CIN7_STATUS_CACHE_MS ?? 5 * 60 * 1000);

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
          perOrderResults[order.orderId] = {
            cin7SalesOrderId: null,
            results: order.lineItems.map((li) => ({ variantId: li.variantId, status: "missing", mismatches: [] })),
          };
          continue;
        }

        if (cin7SalesOrderId === "duplicate") {
          perOrderResults[order.orderId] = {
            cin7SalesOrderId: null,
            results: order.lineItems.map((li) => ({ variantId: li.variantId, status: "error", mismatches: [] })),
          };
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
          perOrderResults[order.orderId] = {
            cin7SalesOrderId,
            results: order.lineItems.map((li) => ({ variantId: li.variantId, status: "missing", mismatches: [] })),
          };
          continue;
        }

        if (snapshot.isVoid || Boolean(snapshot.cancellationDate)) {
          perOrderResults[order.orderId] = {
            cin7SalesOrderId,
            results: order.lineItems.map((li) => ({ variantId: li.variantId, status: "error", mismatches: [] })),
          };
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

        try {
          await prisma.orderOperationalData.update({
            where: { shop_orderId: { shop, orderId: order.orderId } },
            data: { cin7StatusCheckedAt: new Date() },
          });
          // Raw query on purpose: writing cache columns must NOT touch `updatedAt`,
          // since `updatedAt` is used elsewhere to detect real freight-tab edits
          // vs. Cin7-side edits. A normal prisma.update()/updateMany() here would
          // bump updatedAt on every poll and make every mismatch look "freight is newer".
          await Promise.all(results.map((r) =>
            prisma.$executeRaw`
              UPDATE "OrderLineItemOperationalData"
              SET "cin7CachedStatus" = ${r.status}, "cin7CachedMismatches" = ${r.mismatches.join(",")}
              WHERE "shop" = ${shop} AND "orderId" = ${order.orderId} AND "variantId" = ${r.variantId}
            `,
          ));
        } catch (cacheErr) {
          console.error("[Cin7][Status] Failed to persist cache", cacheErr);
        }
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