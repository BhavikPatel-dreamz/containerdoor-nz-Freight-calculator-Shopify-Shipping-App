import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createMondayItem, updateMondayItem, fetchMondayItem, createMondayUpdate } from "../lib/monday.server";

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

export async function loader({ request }: LoaderFunctionArgs) {
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
  console.log("[Monday][Sync] Request received:", { shop, orderId, variantId, itemName, row });

  const existing = await prisma.orderLineItemOperationalData.findUnique({
    where: { shop_orderId_variantId: { shop, orderId, variantId } },
  });
  if (!existing) {
    console.log("[Monday][Sync] Line item not found in DB, aborting");
    return Response.json({ error: "Line item not found" }, { status: 404, headers: getCorsHeaders(request) });
  }

  const fullRow = {
    ...row,
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

  if (!mondayItemId) {
    console.log("[Monday][Sync] No mondayItemId yet, creating new item");
    mondayItemId = await createMondayItem(itemName, fullRow);
    await prisma.orderLineItemOperationalData.update({
      where: { shop_orderId_variantId: { shop, orderId, variantId } },
      data: { mondayItemId },
    });
    console.log("[Monday][Sync] Created and saved mondayItemId:", mondayItemId);
  } else {
    // ── Conflict check: only for customerStatus and eddDate/originalEddDate.
    // Everything else (tracking, warehouse, dispatch, delivery, deposit, balance)
    // keeps the original behavior — admin tab always overwrites Monday.
    const mondayBefore = await fetchMondayItem(mondayItemId);

    if (mondayBefore) {
      const mondayStatusAt = mondayBefore.statusChangedAt
        ? new Date(mondayBefore.statusChangedAt).getTime() : 0;
      const localStatusAt = existing.customerStatusUpdatedAt
        ? new Date(existing.customerStatusUpdatedAt).getTime() : 0;

      if (mondayBefore.customerStatus && mondayStatusAt > localStatusAt) {
        console.log(
          `[Monday][Sync] Monday status "${mondayBefore.customerStatus}" (changed ${mondayBefore.statusChangedAt}) is newer than admin tab's last status change (${existing.customerStatusUpdatedAt}). Keeping Monday's status.`
        );
        fullRow.customerStatus = mondayBefore.customerStatus.toLowerCase();
      } else {
        console.log("[Monday][Sync] Admin tab status is newer (or Monday has none), pushing it.");
      }

      const mondayEddAt = mondayBefore.eddDateChangedAt
        ? new Date(mondayBefore.eddDateChangedAt).getTime() : 0;
      const localEddAt = existing.eddDateUpdatedAt
        ? new Date(existing.eddDateUpdatedAt).getTime() : 0;

      if (mondayBefore.eddDate && mondayEddAt > localEddAt) {
        console.log(
          `[Monday][Sync] Monday EDD "${mondayBefore.eddDate}" (changed ${mondayBefore.eddDateChangedAt}) is newer than admin tab's last EDD change (${existing.eddDateUpdatedAt}). Keeping Monday's EDD.`
        );
        fullRow.eddDate = mondayBefore.eddDate;
        fullRow.originalEddDate = mondayBefore.originalEddDate || fullRow.originalEddDate;
      } else {
        console.log("[Monday][Sync] Admin tab EDD is newer (or Monday has none), pushing it.");
      }
    } else {
      console.log("[Monday][Sync] Could not fetch existing Monday item, pushing local values as-is.");
    }

    console.log("[Monday][Sync] Updating Monday item:", mondayItemId, "with resolved row:", fullRow);
    await updateMondayItem(mondayItemId, fullRow);
  }

  const mondayData = await fetchMondayItem(mondayItemId);
  console.log("[Monday][Sync] Fetched latest data from Monday:", mondayData);
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
  console.log("[Monday][Sync] DB updated with Monday data:", updated);

  // ── NEW: push any new admin-tab notes (tracking added, EDD changed, etc.)
  // to Monday's native Updates tab. Doesn't touch any existing column sync logic.
  try {
    const noteBlocks = String(existing.notes ?? "")
      .split(/\r?\n\r?\n/)
      .map((b) => b.trim())
      .filter(Boolean);

    const alreadyPushed = existing.notesPushedCount ?? 0;
    const newBlocks = noteBlocks.slice(alreadyPushed);

    if (newBlocks.length > 0 && mondayItemId) {
      for (const block of newBlocks) {
        // Strip the "[scheme|author|time]" prefix for a cleaner Monday update body
        const cleaned = block.replace(/^\[[^\]]*\]\s*/, "");
        await createMondayUpdate(mondayItemId, cleaned);
      }
      await prisma.orderLineItemOperationalData.update({
        where: { shop_orderId_variantId: { shop, orderId, variantId } },
        data: { notesPushedCount: noteBlocks.length },
      });
      console.log(`[Monday][Sync] Pushed ${newBlocks.length} new note(s) to Monday Updates tab.`);
    } else {
      console.log("[Monday][Sync] No new notes to push to Monday Updates tab.");
    }
  } catch (e) {
    console.error("[Monday][Sync] Failed to push notes to Monday updates", e);
  }

  return Response.json({ ok: true, mondayItemId, updated }, { headers: getCorsHeaders(request) });
}