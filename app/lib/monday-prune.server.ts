import prisma from "../db.server";
import { deleteMondayItem, listMondayBoardItemsPage } from "./monday.server";
import { shouldPruneMondayPulse } from "./monday-scope.server";

function parsePulseOrderName(name: string): string {
  const stripped = String(name || "").trim().replace(/\s+/g, "");
  if (!stripped) return "";
  return stripped.replace(/[A-Za-z]$/, "");
}

function orderNameKeys(value: string): string[] {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const withHash = raw.startsWith("#") ? raw : `#${raw}`;
  const withoutHash = withHash.replace(/^#/, "");
  return [...new Set([raw, withHash, withoutHash])];
}

export async function pruneClosedMondayItems(input: {
  shop: string;
  dryRun?: boolean;
  limit?: number;
  fromBoard?: boolean;
  cursor?: string | null;
  dropUnmatched?: boolean;
  scanLimit?: number;
}) {
  const shop = String(input.shop || "").trim();
  const dryRun = input.dryRun !== false;
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
  const fromBoard = Boolean(input.fromBoard);
  const dropUnmatched = Boolean(input.dropUnmatched);
  const scanLimit = Math.min(Math.max(Number(input.scanLimit) || 400, 100), 2000);
  if (!shop) return { ok: false, error: "Missing shop", dryRun, deleted: 0, cleared: 0, examined: 0 };

  if (fromBoard) {
    return pruneFromMondayBoard({
      shop,
      dryRun,
      limit,
      cursor: input.cursor || null,
      dropUnmatched,
      scanLimit,
    });
  }

  const closedOps = await prisma.orderLineItemOperationalData.findMany({
    where: {
      shop,
      mondayItemId: { not: "" },
      NOT: { mondayItemId: "pending" },
      OR: [
        { customerStatus: { in: ["Cancelled", "cancelled", "Canceled", "canceled", "Delivered", "delivered"] } },
        { order: { fulfillmentStatus: { in: ["fulfilled", "restocked", "Fulfilled", "Restocked"] } } },
        { order: { financialStatus: { in: ["cancelled", "canceled", "voided", "Cancelled", "Canceled", "voided"] } } },
      ],
    },
    select: {
      id: true,
      orderId: true,
      mondayItemId: true,
      customerStatus: true,
      order: { select: { orderName: true, fulfillmentStatus: true, financialStatus: true } },
    },
  });

  const targets = closedOps.filter((row) =>
    shouldPruneMondayPulse({
      fulfillmentStatus: row.order?.fulfillmentStatus,
      financialStatus: row.order?.financialStatus,
      customerStatus: row.customerStatus,
    }),
  );

  return applyDeletes({
    shop,
    dryRun,
    limit,
    targets: targets.map((row) => ({
      opsId: row.id,
      orderId: row.orderId,
      orderName: row.order?.orderName || row.orderId,
      mondayItemId: row.mondayItemId,
      reason: reasonFor(row.order?.fulfillmentStatus, row.order?.financialStatus, row.customerStatus),
    })),
    examined: closedOps.length,
    extra: { source: "oms" },
  });
}

function reasonFor(fulfillment?: string | null, financial?: string | null, customer?: string | null) {
  if (shouldPruneMondayPulse({ fulfillmentStatus: fulfillment, financialStatus: financial, customerStatus: customer })) {
    const customerN = String(customer || "").toLowerCase();
    if (customerN === "cancelled" || customerN === "canceled") return "cancelled";
    if (customerN === "delivered") return "delivered";
    if (String(fulfillment || "").toLowerCase().includes("fulfill")) return "fulfilled";
    return "closed";
  }
  return "keep";
}

async function pruneFromMondayBoard(input: {
  shop: string;
  dryRun: boolean;
  limit: number;
  cursor: string | null;
  dropUnmatched: boolean;
  scanLimit: number;
}) {
  const shop = input.shop;
  const items: Array<{ id: string; name: string }> = [];
  let cursor = input.cursor;
  let pages = 0;
  while (items.length < input.scanLimit) {
    const page = await listMondayBoardItemsPage(cursor);
    pages += 1;
    items.push(...page.items.filter((row) => row.id));
    cursor = page.cursor;
    if (!page.items.length || !cursor) break;
  }

  const mondayIds = items.map((row) => row.id);
  const opsByMonday = new Map<string, {
    id: string;
    orderId: string;
    customerStatus: string;
    fulfillmentStatus: string;
    financialStatus: string;
    orderName: string;
  }>();

  if (mondayIds.length) {
    const ops = await prisma.orderLineItemOperationalData.findMany({
      where: { shop, mondayItemId: { in: mondayIds } },
      select: {
        id: true,
        orderId: true,
        mondayItemId: true,
        customerStatus: true,
        order: { select: { orderName: true, fulfillmentStatus: true, financialStatus: true } },
      },
    });
    for (const row of ops) {
      opsByMonday.set(row.mondayItemId, {
        id: row.id,
        orderId: row.orderId,
        customerStatus: row.customerStatus,
        fulfillmentStatus: row.order?.fulfillmentStatus || "",
        financialStatus: row.order?.financialStatus || "",
        orderName: row.order?.orderName || "",
      });
    }
  }

  const unmatchedNames = new Set<string>();
  for (const item of items) {
    if (opsByMonday.has(item.id)) continue;
    for (const key of orderNameKeys(parsePulseOrderName(item.name))) unmatchedNames.add(key);
  }

  const snaps = unmatchedNames.size
    ? await prisma.orderSnapshot.findMany({
        where: { shop, orderName: { in: [...unmatchedNames] } },
        select: { orderId: true, orderName: true, fulfillmentStatus: true, financialStatus: true },
      })
    : [];
  const snapByName = new Map<string, (typeof snaps)[number]>();
  for (const snap of snaps) {
    for (const key of orderNameKeys(snap.orderName)) snapByName.set(key, snap);
  }

  const lineStatusByOrder = new Map<string, string>();
  if (snaps.length) {
    const lineOps = await prisma.orderLineItemOperationalData.findMany({
      where: { shop, orderId: { in: snaps.map((s) => s.orderId) } },
      select: { orderId: true, customerStatus: true },
    });
    for (const row of lineOps) {
      if (row.customerStatus && !lineStatusByOrder.has(row.orderId)) {
        lineStatusByOrder.set(row.orderId, row.customerStatus);
      }
    }
  }

  type Target = {
    opsId?: string;
    orderId: string;
    orderName: string;
    mondayItemId: string;
    reason: string;
  };
  const targets: Target[] = [];
  let keep = 0;
  let unmatched = 0;

  for (const item of items) {
    const linked = opsByMonday.get(item.id);
    if (linked) {
      if (
        shouldPruneMondayPulse({
          fulfillmentStatus: linked.fulfillmentStatus,
          financialStatus: linked.financialStatus,
          customerStatus: linked.customerStatus,
        })
      ) {
        targets.push({
          opsId: linked.id,
          orderId: linked.orderId,
          orderName: linked.orderName || item.name,
          mondayItemId: item.id,
          reason: reasonFor(linked.fulfillmentStatus, linked.financialStatus, linked.customerStatus),
        });
      } else {
        keep += 1;
      }
      continue;
    }

    const snap = orderNameKeys(parsePulseOrderName(item.name))
      .map((key) => snapByName.get(key))
      .find(Boolean);
    if (snap) {
      const customerStatus = lineStatusByOrder.get(snap.orderId) || "";
      if (
        shouldPruneMondayPulse({
          fulfillmentStatus: snap.fulfillmentStatus,
          financialStatus: snap.financialStatus,
          customerStatus,
        })
      ) {
        targets.push({
          orderId: snap.orderId,
          orderName: snap.orderName || item.name,
          mondayItemId: item.id,
          reason: reasonFor(snap.fulfillmentStatus, snap.financialStatus, customerStatus),
        });
      } else {
        keep += 1;
      }
      continue;
    }

    unmatched += 1;
    if (input.dropUnmatched) {
      targets.push({
        orderId: "",
        orderName: item.name,
        mondayItemId: item.id,
        reason: "unmatched",
      });
    }
  }

  return applyDeletes({
    shop,
    dryRun: input.dryRun,
    limit: input.limit,
    targets,
    examined: items.length,
    extra: {
      source: "board",
      keep,
      unmatched,
      dropUnmatched: input.dropUnmatched,
      pages,
      nextCursor: cursor,
      hint:
        "Keep = pending/unfulfilled (including paid + unfulfilled). Drop = cancelled, fulfilled, delivered. Unmatched = pulse not in OMS — add dropUnmatched=1 to delete those too.",
    },
  });
}

async function applyDeletes(input: {
  shop: string;
  dryRun: boolean;
  limit: number;
  targets: Array<{ opsId?: string; orderId: string; orderName: string; mondayItemId: string; reason: string }>;
  examined: number;
  extra?: Record<string, unknown>;
}) {
  const sample = input.targets.slice(0, 20).map((row) => ({
    orderId: row.orderId,
    orderName: row.orderName,
    mondayItemId: row.mondayItemId,
    reason: row.reason,
  }));
  let deleted = 0;
  let cleared = 0;
  let failed = 0;

  if (!input.dryRun) {
    for (const row of input.targets.slice(0, input.limit)) {
      try {
        await deleteMondayItem(row.mondayItemId);
        deleted += 1;
      } catch (err) {
        failed += 1;
        console.error("[monday-prune] delete failed", row.mondayItemId, err);
      }
      if (row.opsId) {
        await prisma.orderLineItemOperationalData.update({
          where: { id: row.opsId },
          data: { mondayItemId: "", mondayItemName: "" },
        });
        cleared += 1;
      } else if (row.mondayItemId) {
        await prisma.orderLineItemOperationalData.updateMany({
          where: { shop: input.shop, mondayItemId: row.mondayItemId },
          data: { mondayItemId: "", mondayItemName: "" },
        });
      }
    }
  }

  return {
    ok: true,
    dryRun: input.dryRun,
    examined: input.examined,
    eligible: input.targets.length,
    remaining: Math.max(0, input.targets.length - input.limit),
    deleted,
    cleared,
    failed,
    sample,
    ...input.extra,
  };
}
