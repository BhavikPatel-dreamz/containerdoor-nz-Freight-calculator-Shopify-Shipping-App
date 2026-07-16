import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { fetchCin7SalesOrder, diffCin7Fields } from "../lib/cin7.server";

type LineItemInput = { variantId: string; trackingNumber?: string; eddDate?: string; company?: string };

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  try {
    const { shop, orderId, lineItems } = (await request.json()) as {
      shop?: string; orderId?: string; lineItems?: LineItemInput[];
    };
    if (!shop || !orderId || !Array.isArray(lineItems)) {
      return Response.json({ error: "Missing shop, orderId, or lineItems" }, { status: 400 });
    }

    const existing = await prisma.orderOperationalData.findUnique({
      where: { shop_orderId: { shop, orderId } },
      select: { cin7SalesOrderId: true },
    });

    if (!existing?.cin7SalesOrderId || existing.cin7SalesOrderId === "pending") {
      return Response.json({
        cin7SalesOrderId: null,
        results: lineItems.map((li) => ({ variantId: li.variantId, status: "missing", mismatches: [] })),
      });
    }

    const snapshot = await fetchCin7SalesOrder(existing.cin7SalesOrderId);
    if (!snapshot) {
      return Response.json({
        cin7SalesOrderId: existing.cin7SalesOrderId,
        results: lineItems.map((li) => ({ variantId: li.variantId, status: "missing", mismatches: [] })),
      });
    }

    const results = lineItems.map((li) => {
      const mismatches = diffCin7Fields(li, snapshot);
      return { variantId: li.variantId, status: mismatches.length ? "mismatch" : "match", mismatches };
    });

    return Response.json({ cin7SalesOrderId: existing.cin7SalesOrderId, results });
  } catch (error) {
    console.error("[Cin7][Status] Error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
};
