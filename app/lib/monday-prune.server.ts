import prisma from "../db.server";
import { deleteMondayItem } from "./monday.server";
import { isClosedFulfillmentStatus } from "./monday-scope.server";

export async function pruneClosedMondayItems(input: {
  shop: string;
  dryRun?: boolean;
  limit?: number;
}) {
  const shop = String(input.shop || "").trim();
  const dryRun = input.dryRun !== false;
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
  if (!shop) return { ok: false, error: "Missing shop", dryRun, deleted: 0, cleared: 0, examined: 0 };

  const ops = await prisma.orderLineItemOperationalData.findMany({
    where: {
      shop,
      mondayItemId: { not: "" },
      NOT: { mondayItemId: "pending" },
    },
    select: { id: true, orderId: true, mondayItemId: true, customerStatus: true },
    take: 8000,
  });

  const orderIds = [...new Set(ops.map((row) => row.orderId))];
  const snaps = await prisma.orderSnapshot.findMany({
    where: { shop, orderId: { in: orderIds } },
    select: { orderId: true, orderName: true, fulfillmentStatus: true },
  });
  const snapByOrder = new Map(snaps.map((row) => [row.orderId, row]));

  const targets = ops.filter((row) => {
    const snap = snapByOrder.get(row.orderId);
    if (isClosedFulfillmentStatus(snap?.fulfillmentStatus)) return true;
    const status = String(row.customerStatus || "").toLowerCase();
    return status === "cancelled" || status === "delivered";
  });

  let deleted = 0;
  let cleared = 0;
  let failed = 0;
  const sample: Array<{ orderId: string; orderName: string; mondayItemId: string }> = [];

  for (const row of targets.slice(0, limit)) {
    const snap = snapByOrder.get(row.orderId);
    const mondayItemId = String(row.mondayItemId || "");
    if (sample.length < 20) {
      sample.push({
        orderId: row.orderId,
        orderName: snap?.orderName || row.orderId,
        mondayItemId,
      });
    }
    if (dryRun) continue;
    try {
      await deleteMondayItem(mondayItemId);
      deleted += 1;
    } catch (err) {
      failed += 1;
      console.error("[monday-prune] delete failed", mondayItemId, err);
    }
    await prisma.orderLineItemOperationalData.update({
      where: { id: row.id },
      data: { mondayItemId: "", mondayItemName: "" },
    });
    cleared += 1;
  }

  return {
    ok: true,
    dryRun,
    examined: ops.length,
    eligible: targets.length,
    remaining: Math.max(0, targets.length - limit),
    deleted,
    cleared,
    failed,
    sample,
  };
}
