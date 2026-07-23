/* eslint-disable @typescript-eslint/no-explicit-any */
// One-off / re-runnable backfill for OrderLineItemIndex.
// Iterates OrderSnapshot in cursor-paged batches and (re)builds the index rows.
// Idempotent — safe to run repeatedly; each order is delete-stale + upsert.
//
// Usage (admin session required, embedded app):
//   GET /api/backfill-line-index            → first batch (200 orders)
//   GET /api/backfill-line-index?cursor=ID  → resume after the returned cursor
//   GET /api/backfill-line-index?take=500   → custom batch size
// Repeat with the returned `nextCursor` until `done: true`.
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { reindexOrderLineItems } from "../lib/line-index.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { authenticate } = await import("../shopify.server");
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const take = Math.min(Math.max(Number(url.searchParams.get("take") || "200"), 1), 1000);

  const snapshots = await prisma.orderSnapshot.findMany({
    where: { shop },
    orderBy: { id: "asc" },
    take: take + 1, // fetch one extra to detect whether more remain
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = snapshots.length > take;
  const batch = hasMore ? snapshots.slice(0, take) : snapshots;

  let indexedOrders = 0;
  let indexedItems = 0;
  let failed = 0;
  for (const snap of batch) {
    try {
      const n = await reindexOrderLineItems(shop, snap);
      if (n > 0) {
        indexedOrders++;
        indexedItems += n;
      }
    } catch (error) {
      failed++;
      console.error(`[BackfillLineIndex][${snap.orderId}] FAILED`, error);
    }
  }

  const nextCursor = hasMore ? batch[batch.length - 1].id : null;

  return {
    shop,
    processed: batch.length,
    indexedOrders,
    indexedItems,
    failed,
    nextCursor,
    done: !hasMore,
  };
}
