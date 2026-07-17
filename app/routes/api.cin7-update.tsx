import type { ActionFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { syncCin7EstimatedDispatchDate, syncCin7TrackingNumber, syncCin7Carrier, fetchCin7SalesOrder } from "../lib/cin7.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  try {
    const { shop, orderId, variantId, trackingNumber, eddDate, carrier, fields } = (await request.json()) as {
      shop?: string; orderId?: string; variantId?: string; trackingNumber?: string; eddDate?: string; carrier?: string; fields?: string[];
    };
    if (!shop || !orderId) return Response.json({ error: "Missing shop or orderId" }, { status: 400 });

    const orderRecord = await prisma.orderOperationalData.findUnique({
      where: { shop_orderId: { shop, orderId } },
      select: { cin7SalesOrderId: true, cin7StatusCheckedAt: true },
    });
    if (!orderRecord?.cin7SalesOrderId || orderRecord.cin7SalesOrderId === "pending") {
      return Response.json({ ok: false, error: "Order not yet created in Cin7" }, { status: 400 });
    }
    const salesOrderId = orderRecord.cin7SalesOrderId;

    const snapshot = await fetchCin7SalesOrder(salesOrderId);
    if (!snapshot) return Response.json({ ok: false, error: "Could not load current Cin7 order" }, { status: 502 });

    const lineRecord = variantId
      ? await prisma.orderLineItemOperationalData.findUnique({
          where: { shop_orderId_variantId: { shop, orderId, variantId } },
          select: { updatedAt: true },
        })
      : null;

    const lastCheckedAt = (orderRecord.cin7StatusCheckedAt as Date | null | undefined)?.getTime() ?? 0;
    const freightIsNewer = Boolean(lineRecord?.updatedAt && lineRecord.updatedAt.getTime() > lastCheckedAt);

    const toFix = fields && fields.length ? fields : ["trackingNumber", "eddDate", "carrier"];
    const errors: string[] = [];
    const updatedFields: { trackingNumber?: string; eddDate?: string; carrier?: string } = {};

    if (freightIsNewer) {
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
    } else {
      if (toFix.includes("trackingNumber")) updatedFields.trackingNumber = snapshot.trackingCode ?? "";
      if (toFix.includes("eddDate")) updatedFields.eddDate = snapshot.estimatedDeliveryDate ? snapshot.estimatedDeliveryDate.slice(0, 10) : "";
      if (toFix.includes("carrier")) updatedFields.carrier = snapshot.logisticsCarrier ?? "";

      // Raw query on purpose: pulling values FROM Cin7 is not a genuine
      // freight-tab edit. A normal prisma.update()/updateMany() here would
      // bump `updatedAt`, which freightIsNewer relies on — bumping it would
      // make the NEXT check wrongly think freight is newer and push this
      // same pulled value straight back into Cin7 (reverting on reload).
      if (variantId && Object.keys(updatedFields).length) {
        const setClauses: Prisma.Sql[] = [];
        if (updatedFields.trackingNumber !== undefined) setClauses.push(Prisma.sql`"trackingNumber" = ${updatedFields.trackingNumber}`);
        if (updatedFields.eddDate !== undefined) setClauses.push(Prisma.sql`"eddDate" = ${updatedFields.eddDate}`);
        if (updatedFields.carrier !== undefined) setClauses.push(Prisma.sql`"carrier" = ${updatedFields.carrier}`);
        if (setClauses.length) {
          await prisma.$executeRaw`
            UPDATE "OrderLineItemOperationalData"
            SET ${Prisma.join(setClauses, ", ")}
            WHERE "shop" = ${shop} AND "orderId" = ${orderId} AND "variantId" = ${variantId}
          `;
        }
      }
    }

    if (errors.length) return Response.json({ ok: false, error: errors.join("; ") }, { status: 500 });

    await prisma.orderOperationalData.update({
      where: { shop_orderId: { shop, orderId } },
      data: { cin7StatusCheckedAt: new Date() },
    });
    // Same reasoning: resetting cache columns is not a real freight edit,
    // so it must not touch `updatedAt` either.
    if (variantId) {
      await prisma.$executeRaw`
        UPDATE "OrderLineItemOperationalData"
        SET "cin7CachedStatus" = 'match', "cin7CachedMismatches" = ''
        WHERE "shop" = ${shop} AND "orderId" = ${orderId} AND "variantId" = ${variantId}
      `;
    }

    return Response.json({ ok: true, direction: freightIsNewer ? "pushed" : "pulled", updated: updatedFields });
  } catch (error) {
    console.error("[Cin7][Fix] Error:", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
};
