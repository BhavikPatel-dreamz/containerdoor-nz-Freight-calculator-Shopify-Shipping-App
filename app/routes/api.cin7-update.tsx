import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { syncCin7EstimatedDispatchDate, syncCin7TrackingNumber, syncCin7Carrier } from "../lib/cin7.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  try {
    const { shop, orderId, trackingNumber, eddDate, carrier, fields } = (await request.json()) as {
      shop?: string; orderId?: string; trackingNumber?: string; eddDate?: string; carrier?: string; fields?: string[];
    };
    if (!shop || !orderId) return Response.json({ error: "Missing shop or orderId" }, { status: 400 });

    const existing = await prisma.orderOperationalData.findUnique({
      where: { shop_orderId: { shop, orderId } },
      select: { cin7SalesOrderId: true },
    });
    if (!existing?.cin7SalesOrderId || existing.cin7SalesOrderId === "pending") {
      return Response.json({ ok: false, error: "Order not yet created in Cin7" }, { status: 400 });
    }

    const salesOrderId = existing.cin7SalesOrderId;
    const toFix = fields && fields.length ? fields : ["trackingNumber", "eddDate", "carrier"];
    const errors: string[] = [];

    if (toFix.includes("trackingNumber")) {
      const r = await syncCin7TrackingNumber({ salesOrderId, trackingNumber });
      if (!r.updated) errors.push(r.error || "tracking sync failed");
    }
    if (toFix.includes("eddDate")) {
      const r = await syncCin7EstimatedDispatchDate({ salesOrderId, eddDate });
      if (!r.updated) errors.push(r.error || "EDD sync failed");
    }
    if (toFix.includes("carrier")) {
      const r = await syncCin7Carrier({ salesOrderId, carrier });
      if (!r.updated) errors.push(r.error || "carrier sync failed");
    }

    if (errors.length) return Response.json({ ok: false, error: errors.join("; ") }, { status: 500 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[Cin7][Fix] Error:", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
};
