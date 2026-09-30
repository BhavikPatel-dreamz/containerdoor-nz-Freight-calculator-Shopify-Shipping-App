import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";

const NODES_QUERY = `#graphql
  query BackfillOrderCreatedAt($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Order {
        id
        createdAt
      }
    }
  }
`;

function gidToOrderId(gid: string): string {
  const m = String(gid || "").match(/Order\/(\d+)/);
  return m?.[1] || "";
}

export async function backfillShopifyCreatedAtBatch(opts: {
  shop: string;
  cursor?: string | null;
  take?: number;
  dryRun?: boolean;
}) {
  const shop = opts.shop;
  const take = Math.min(Math.max(Number(opts.take || 100), 1), 250);
  const cursor = opts.cursor || null;
  const dryRun = Boolean(opts.dryRun);

  const snapshots = await prisma.orderSnapshot.findMany({
    where: { shop },
    orderBy: { id: "asc" },
    take: take + 1,
    select: { id: true, orderId: true, createdAt: true },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = snapshots.length > take;
  const batch = hasMore ? snapshots.slice(0, take) : snapshots;
  const nextCursor = hasMore ? batch[batch.length - 1]?.id ?? null : null;

  if (!batch.length) {
    return { shop, processed: 0, updated: 0, skipped: 0, missing: 0, nextCursor: null, done: true, dryRun };
  }

  const { admin } = await unauthenticated.admin(shop);
  const ids = batch.map((s) => `gid://shopify/Order/${s.orderId}`);
  const res = await admin.graphql(NODES_QUERY, { variables: { ids } });
  const json = await res.json();
  const nodes = (json?.data?.nodes ?? []) as Array<{ id?: string; createdAt?: string } | null>;
  const byOrderId = new Map<string, Date>();
  for (const node of nodes) {
    if (!node?.id || !node.createdAt) continue;
    const orderId = gidToOrderId(node.id);
    const d = new Date(node.createdAt);
    if (orderId && !Number.isNaN(d.getTime())) byOrderId.set(orderId, d);
  }

  let updated = 0;
  let skipped = 0;
  let missing = 0;

  for (const snap of batch) {
    const shopifyAt = byOrderId.get(snap.orderId);
    if (!shopifyAt) {
      missing++;
      continue;
    }
    const current = snap.createdAt instanceof Date ? snap.createdAt : new Date(snap.createdAt);
    const sameSecond = Math.abs(current.getTime() - shopifyAt.getTime()) < 1000;
    if (sameSecond) {
      skipped++;
      continue;
    }
    if (!dryRun) {
      await prisma.orderSnapshot.update({
        where: { shop_orderId: { shop, orderId: snap.orderId } },
        data: { createdAt: shopifyAt },
      });
      await prisma.orderLineItemIndex.updateMany({
        where: { shop, orderId: snap.orderId },
        data: { createdAt: shopifyAt },
      });
    }
    updated++;
  }

  return {
    shop,
    processed: batch.length,
    updated,
    skipped,
    missing,
    nextCursor,
    done: !hasMore,
    dryRun,
  };
}
