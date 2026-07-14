import type { ActionFunctionArgs } from "react-router";
import { createMondayItem, updateMondayItem, fetchMondayItem, createMondayUpdate, findExistingMondayItemId } from "../lib/monday.server";

function getCorsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Cache-Control",
    ...(origin ? { Vary: "Origin" } : {}),
  };
}

export async function loader({ request }: { request: Request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(request) });
  }
  return new Response(null, { status: 405, headers: getCorsHeaders(request) });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(request) });
  }
  const { default: prisma } = await import("../db.server");
  const { shop, orderId, variantId, itemName, row } = await request.json();
  console.log("[Monday][Bulk Sync] Request received:", { shop, orderId, variantId, itemName, row });

  let existing = await prisma.orderLineItemOperationalData.findUnique({
    where: { shop_orderId_variantId: { shop, orderId, variantId } },
  });
  if (!existing) {
    console.log("[Monday][Bulk Sync] Line item not found in DB, creating a new record");
    existing = await prisma.orderLineItemOperationalData.create({
      data: {
        shop,
        orderId,
        variantId,
        productTitle: row.productTitle ?? "",
        carrier: row.carriers ?? "",
        customerStatus: row.customerStatus ?? "",
        trackingNumber: row.trackingNumber ?? "",
        eddDate: row.eddDate ?? "",
        originalEddDate: row.originalEddDate ?? "",
      },
    });
  }

  const fullRow = {
    ...row,
    customerName: row.customerName ?? "",
    email: row.email ?? "",
    carriers: row.carriers ?? existing.carrier ?? "",
    trackingNumber: row.trackingNumber ?? existing.trackingNumber ?? "",
    eddDate: row.eddDate ?? existing.eddDate ?? "",
    originalEddDate: row.originalEddDate ?? existing.originalEddDate ?? "",
    productTitle: row.productTitle ?? existing.productTitle ?? "",
    boxes: row.boxes ?? "",
    customerStatus: row.customerStatus ?? existing.customerStatus ?? "",
    shop,
    orderId,
    variantId,
    warehouseStatus: existing.warehouseStatus ?? "",
    dispatchStatus: existing.dispatchStatus ?? "",
    deliveryStatus: existing.deliveryStatus ?? "",
    depositPaid: existing.depositPaid ?? "",
    balanceDue: existing.balanceDue ?? "",
  };

  let mondayItemId = existing.mondayItemId;
  let syncStatus: "created" | "already-there" = "already-there";
  let didUpdate = false;

  if (!mondayItemId) {
    const resolvedItemId = await findExistingMondayItemId(orderId, variantId);

    if (resolvedItemId) {
      mondayItemId = resolvedItemId;
      await prisma.orderLineItemOperationalData.update({
        where: { shop_orderId_variantId: { shop, orderId, variantId } },
        data: { mondayItemId },
      });
      console.log("[Monday][Bulk Sync] Reused existing Monday item by order/variant:", mondayItemId);
    } else {
      console.log("[Monday][Bulk Sync] No mondayItemId yet, creating new item");
      mondayItemId = await createMondayItem(itemName, fullRow);
      await prisma.orderLineItemOperationalData.update({
        where: { shop_orderId_variantId: { shop, orderId, variantId } },
        data: { mondayItemId },
      });
      console.log("[Monday][Bulk Sync] Created and saved mondayItemId:", mondayItemId);
      syncStatus = "created";
    }
  } else {
    const mondayBefore = await fetchMondayItem(mondayItemId);

    if (!mondayBefore) {
      const resolvedItemId = await findExistingMondayItemId(orderId, variantId);

      if (resolvedItemId) {
        mondayItemId = resolvedItemId;
        await prisma.orderLineItemOperationalData.update({
          where: { shop_orderId_variantId: { shop, orderId, variantId } },
          data: { mondayItemId },
        });
        console.log("[Monday][Bulk Sync] Reused existing Monday item after lookup:", mondayItemId);
      } else {
        console.log("[Monday][Bulk Sync] Monday item could not be resolved for existing ID, creating a fresh item instead.");
        mondayItemId = await createMondayItem(itemName, fullRow);
        await prisma.orderLineItemOperationalData.update({
          where: { shop_orderId_variantId: { shop, orderId, variantId } },
          data: { mondayItemId },
        });
        console.log("[Monday][Bulk Sync] Recreated Monday item with new mondayItemId:", mondayItemId);
      }
    } else {
      const mondayStatusAt = mondayBefore.statusChangedAt
        ? new Date(mondayBefore.statusChangedAt).getTime() : 0;
      const localStatusAt = existing.customerStatusUpdatedAt
        ? new Date(existing.customerStatusUpdatedAt).getTime() : 0;

      if (mondayBefore.customerStatus && mondayStatusAt > localStatusAt) {
        console.log(
          `[Monday][Bulk Sync] Monday status "${mondayBefore.customerStatus}" (changed ${mondayBefore.statusChangedAt}) is newer than admin tab's last status change (${existing.customerStatusUpdatedAt}). Keeping Monday's status.`
        );
        fullRow.customerStatus = mondayBefore.customerStatus.toLowerCase();
      } else {
        console.log("[Monday][Bulk Sync] Admin tab status is newer (or Monday has none), pushing it.");
      }

      const mondayEddAt = mondayBefore.eddDateChangedAt
        ? new Date(mondayBefore.eddDateChangedAt).getTime() : 0;
      const localEddAt = existing.eddDateUpdatedAt
        ? new Date(existing.eddDateUpdatedAt).getTime() : 0;

      if (mondayBefore.eddDate && mondayEddAt > localEddAt) {
        console.log(
          `[Monday][Bulk Sync] Monday EDD "${mondayBefore.eddDate}" (changed ${mondayBefore.eddDateChangedAt}) is newer than admin tab's last EDD change (${existing.eddDateUpdatedAt}). Keeping Monday's EDD.`
        );
        fullRow.eddDate = mondayBefore.eddDate;
        fullRow.originalEddDate = mondayBefore.originalEddDate || fullRow.originalEddDate;
      } else {
        console.log("[Monday][Bulk Sync] Admin tab EDD is newer (or Monday has none), pushing it.");
      }

      syncStatus = "already-there";

      const noChanges =
        String(fullRow.customerStatus ?? "").toLowerCase() === String(mondayBefore.customerStatus ?? "").toLowerCase() &&
        String(fullRow.eddDate ?? "") === String(mondayBefore.eddDate ?? "") &&
        String(fullRow.originalEddDate ?? "") === String(mondayBefore.originalEddDate ?? "") &&
        String(fullRow.trackingNumber ?? "") === String(mondayBefore.trackingNumber ?? "");

      if (noChanges) {
        console.log("[Monday][Bulk Sync] No changes vs Monday, skipping update API call for item:", mondayItemId);
      } else {
        console.log("[Monday][Bulk Sync] Updating Monday item:", mondayItemId, "with resolved row:", fullRow);
        try {
          await updateMondayItem(mondayItemId, fullRow);
          didUpdate = true;
        } catch (updateError) {
          const msg = updateError instanceof Error ? updateError.message : String(updateError);
          if (msg.includes("Item not found in board")) {
            console.log(`[Monday][Bulk Sync] Stale mondayItemId ${mondayItemId} no longer exists on board, creating a fresh item`);
            mondayItemId = await createMondayItem(itemName, fullRow);
            await prisma.orderLineItemOperationalData.update({
              where: { shop_orderId_variantId: { shop, orderId, variantId } },
              data: { mondayItemId },
            });
            syncStatus = "created";
          } else {
            throw updateError;
          }
        }
      }
    }
  }

  const mondayData = await fetchMondayItem(mondayItemId);
  console.log("[Monday][Bulk Sync] Fetched latest data from Monday:", mondayData);
  const mondayStatus = mondayData?.customerStatus ?? "";
  const mondayTracking = mondayData?.trackingNumber ?? "";
  const mondayEdd = mondayData?.eddDate ?? "";
  const mondayOriginalEdd = mondayData?.originalEddDate ?? "";

  const updated = await prisma.orderLineItemOperationalData.update({
    where: { shop_orderId_variantId: { shop, orderId, variantId } },
    data: {
      ...(mondayStatus ? { customerStatus: mondayStatus.toLowerCase() } : {}),
      ...(mondayTracking ? { trackingNumber: mondayTracking } : {}),
      ...(mondayEdd ? { eddDate: mondayEdd } : {}),
      ...(mondayOriginalEdd ? { originalEddDate: mondayOriginalEdd } : {}),
    },
  });
  console.log("[Monday][Bulk Sync] DB updated with Monday data:", updated);

  try {
    const noteBlocks = String(existing.notes ?? "")
      .split(/\r?\n\r?\n/)
      .map((b) => b.trim())
      .filter(Boolean);

    const alreadyPushed = existing.notesPushedCount ?? 0;
    const newBlocks = noteBlocks.slice(alreadyPushed);

    if (newBlocks.length > 0 && mondayItemId) {
      for (const block of newBlocks) {
        const cleaned = block.replace(/^\[[^\]]*\]\s*/, "");
        await createMondayUpdate(mondayItemId, cleaned);
      }
      await prisma.orderLineItemOperationalData.update({
        where: { shop_orderId_variantId: { shop, orderId, variantId } },
        data: { notesPushedCount: noteBlocks.length },
      });
      console.log(`[Monday][Bulk Sync] Pushed ${newBlocks.length} new note(s) to Monday Updates tab.`);
    } else {
      console.log("[Monday][Bulk Sync] No new notes to push to Monday Updates tab.");
    }
  } catch (e) {
    console.error("[Monday][Bulk Sync] Failed to push notes to Monday updates", e);
  }

  return Response.json({ ok: true, mondayItemId, updated, syncStatus, didUpdate }, { headers: getCorsHeaders(request) });
}
