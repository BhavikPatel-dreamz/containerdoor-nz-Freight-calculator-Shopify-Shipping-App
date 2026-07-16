/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { fetchCin7SalesOrder, diffCin7Fields } from "../lib/cin7.server";

type LineItemInput = { variantId: string; trackingNumber?: string; eddDate?: string; company?: string };
type OrderInput = { orderId: string; lineItems: LineItemInput[] };

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  try {
    const body = (await request.json()) as {
      shop?: string; orderId?: string; lineItems?: LineItemInput[]; orders?: OrderInput[];
    };
    const { shop } = body;
    if (!shop) return Response.json({ error: "Missing shop" }, { status: 400 });

    // Accept the old single-order shape too, so nothing else breaks
    const orders: OrderInput[] = body.orders ?? (body.orderId && body.lineItems
      ? [{ orderId: body.orderId, lineItems: body.lineItems }]
      : []);
    if (orders.length === 0) return Response.json({ error: "Missing orderId/lineItems or orders" }, { status: 400 });

    // ONE query for every order's DB record, instead of N
    const records = await prisma.orderOperationalData.findMany({
      where: { shop, orderId: { in: orders.map((o) => o.orderId) } },
      select: { orderId: true, cin7SalesOrderId: true },
    });
    const recordByOrderId = new Map(records.map((r) => [r.orderId, r.cin7SalesOrderId]));

    const perOrderResults: Record<string, { cin7SalesOrderId: string | null; results: any[] }> = {};

    // Cin7 HTTP calls (not DB) — safe to run with limited concurrency
    const concurrency = 5;
    const queue = orders.slice();
    const worker = async () => {
      while (queue.length > 0) {
        const order = queue.shift();
        if (!order) break;
        const cin7SalesOrderId = recordByOrderId.get(order.orderId);

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

        perOrderResults[order.orderId] = {
          cin7SalesOrderId,
          results: order.lineItems.map((li) => {
            const mismatches = diffCin7Fields(li, snapshot);
            return { variantId: li.variantId, status: mismatches.length ? "mismatch" : "match", mismatches };
          }),
        };
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