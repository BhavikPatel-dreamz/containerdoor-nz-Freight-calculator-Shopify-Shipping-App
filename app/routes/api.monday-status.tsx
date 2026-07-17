/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { fetchMondayItem } from "../lib/monday.server";

type LineItemInput = { variantId: string };
type OrderInput = { orderId: string; lineItems: LineItemInput[] };

const MONDAY_STATUS_CACHE_MS = Number(process.env.MONDAY_STATUS_CACHE_MS ?? 5 * 60 * 1000);

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  try {
    const body = (await request.json()) as { shop?: string; orders?: OrderInput[]; force?: boolean };
    const { shop, force } = body;
    if (!shop) return Response.json({ error: "Missing shop" }, { status: 400 });
    const orders: OrderInput[] = body.orders ?? [];
    if (orders.length === 0) return Response.json({ error: "Missing orders" }, { status: 400 });

    const records = await prisma.orderLineItemOperationalData.findMany({
      where: { shop, orderId: { in: orders.map((o) => o.orderId) } },
      select: { orderId: true, variantId: true, mondayItemId: true, trackingNumber: true, eddDate: true, customerStatus: true, mondayCachedStatus: true, mondayCachedMismatches: true },
    });
    const recordMap = new Map(records.map((r) => [`${r.orderId}::${r.variantId}`, r]));

    const orderRecords = await prisma.orderOperationalData.findMany({
      where: { shop, orderId: { in: orders.map((o) => o.orderId) } },
      select: { orderId: true, mondayStatusCheckedAt: true },
    });
    const recordByOrderId = new Map(orderRecords.map((r) => [r.orderId, r]));

    const perOrderResults: Record<string, { results: any[] }> = {};
    const now = Date.now();

    // Concurrency-limited workers to fetch Monday items
    const concurrency = 2;
    const queue = orders.slice();
    const worker = async () => {
      while (queue.length > 0) {
        const order = queue.shift();
        if (!order) break;
        const checkedAt = recordByOrderId.get(order.orderId)?.mondayStatusCheckedAt
          ? new Date(recordByOrderId.get(order.orderId)!.mondayStatusCheckedAt as any).getTime()
          : 0;
        const isFresh = !force && checkedAt && now - checkedAt < MONDAY_STATUS_CACHE_MS;

        const lineKeys = order.lineItems.map((li) => `${order.orderId}::${li.variantId}`);
        const allCached = lineKeys.every((k) => recordMap.has(k) && (recordMap.get(k) as any).mondayCachedStatus !== undefined);
        if (isFresh && allCached) {
          perOrderResults[order.orderId] = {
            results: order.lineItems.map((li) => {
              const cached = recordMap.get(`${order.orderId}::${li.variantId}`) as any;
              const cachedMismatchText = typeof cached?.mondayCachedMismatches === "string" ? cached.mondayCachedMismatches : "";
              return {
                variantId: li.variantId,
                status: cached?.mondayCachedStatus || "missing",
                mismatches: cachedMismatchText ? cachedMismatchText.split(",").filter(Boolean) : [],
              };
            }),
          };
          continue;
        }

        const results: any[] = [];
        for (const li of order.lineItems) {
          const rec = recordMap.get(`${order.orderId}::${li.variantId}`) as any | undefined;
          if (!rec?.mondayItemId) {
            results.push({ variantId: li.variantId, status: "missing", mismatches: [] });
            continue;
          }
          const mondayData = await fetchMondayItem(rec.mondayItemId);
          if (!mondayData) {
            results.push({ variantId: li.variantId, status: "missing", mismatches: [] });
            continue;
          }
          const mismatches: string[] = [];
          const wantTracking = (rec.trackingNumber || "").trim();
          if (wantTracking && wantTracking !== (mondayData.trackingNumber || "").trim()) mismatches.push("trackingNumber");
          const wantEdd = (rec.eddDate || "").slice(0, 10);
          const haveEdd = (mondayData.eddDate || "").slice(0, 10);
          if (wantEdd && wantEdd !== haveEdd) mismatches.push("eddDate");
          const wantStatus = (rec.customerStatus || "").toLowerCase();
          const haveStatus = (mondayData.customerStatus || "").toLowerCase();
          if (wantStatus && wantStatus !== haveStatus) mismatches.push("customerStatus");

          results.push({ variantId: li.variantId, status: mismatches.length ? "mismatch" : "match", mismatches });
        }

        perOrderResults[order.orderId] = { results };

        try {
          // Ensure the parent order operational row exists and update the checkedAt timestamp.
          await prisma.orderOperationalData.upsert({
            where: { shop_orderId: { shop, orderId: order.orderId } },
            create: { shop, orderId: order.orderId, mondayStatusCheckedAt: new Date() },
            update: { mondayStatusCheckedAt: new Date() },
          });
          await Promise.all(results.map((r) =>
            prisma.orderLineItemOperationalData.upsert({
              where: { shop_orderId_variantId: { shop, orderId: order.orderId, variantId: r.variantId } },
              create: { shop, orderId: order.orderId, variantId: r.variantId, mondayCachedStatus: r.status, mondayCachedMismatches: r.mismatches.join(",") },
              update: { mondayCachedStatus: r.status, mondayCachedMismatches: r.mismatches.join(",") },
            })
          ));
        } catch (cacheErr) {
          console.error("[Monday][Status] Failed to persist cache", cacheErr);
          try {
            // Fallback: ensure cache persisted via Prisma upsert per-line
            await Promise.all(results.map((r) =>
              prisma.orderLineItemOperationalData.upsert({
                where: { shop_orderId_variantId: { shop, orderId: order.orderId, variantId: r.variantId } },
                create: { shop, orderId: order.orderId, variantId: r.variantId, mondayCachedStatus: r.status, mondayCachedMismatches: r.mismatches.join(",") },
                update: { mondayCachedStatus: r.status, mondayCachedMismatches: r.mismatches.join(",") },
              })
            ));
          } catch (upsertErr) {
            console.error("[Monday][Status] Fallback upsert failed", upsertErr);
          }
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, orders.length) }, worker));

    return Response.json({ orders: perOrderResults });
  } catch (error) {
    console.error("[Monday][Status] Error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
};
