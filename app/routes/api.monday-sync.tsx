/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createMondayItem, updateMondayItem, fetchMondayItem, createMondayUpdate, isStaleMondayItemError, fetchMondayUpdates, renameMondayItem, buildMondayRowFromOms, summarizeMondayRow } from "../lib/monday.server";
import { normalizePaymentStatus } from "../lib/freight-orders.server";

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
  const { shop, orderId, variantId, itemName: rawItemName, row } = await request.json();
  console.log("[Monday][Sync] Request received:", { shop, orderId, variantId, itemName: rawItemName, row });

  let existing = await prisma.orderLineItemOperationalData.findUnique({
    where: { shop_orderId_variantId: { shop, orderId, variantId } },
  });
  if (!existing) {
    console.log("[Monday][Sync] Line item not found in DB, aborting");
    return Response.json({ error: "Line item not found" }, { status: 404, headers: getCorsHeaders(request) });
  }

  // Full OMS detail → Monday columns (customer, address, EDD, ops, etc.)
  const resolvedPaymentStatus = normalizePaymentStatus(
    String(existing.paymentStatus || "").trim() || String(row?.paymentStatus || "").trim(),
  );
  if (resolvedPaymentStatus && !String(existing.paymentStatus || "").trim()) {
    await prisma.orderLineItemOperationalData.update({
      where: { shop_orderId_variantId: { shop, orderId, variantId } },
      data: { paymentStatus: resolvedPaymentStatus },
    });
    existing = { ...existing, paymentStatus: resolvedPaymentStatus };
  }

  const { row: builtRow, itemName } = await buildMondayRowFromOms({
    shop,
    orderId,
    variantId,
    ops: {
      ...existing,
      ...(row?.carriers ? { carrier: row.carriers } : {}),
      ...(row?.trackingNumber != null ? { trackingNumber: row.trackingNumber } : {}),
      ...(row?.eddDate != null ? { eddDate: row.eddDate } : {}),
      ...(row?.originalEddDate != null ? { originalEddDate: row.originalEddDate } : {}),
      ...(row?.customerStatus != null ? { customerStatus: row.customerStatus } : {}),
      ...(row?.productTitle ? { productTitle: row.productTitle } : {}),
      ...(row?.customerName ? { customerName: row.customerName } : {}),
      ...(row?.email ? { email: row.email } : {}),
      ...(row?.boxes != null && row.boxes !== "" ? { boxes: row.boxes } : {}),
      paymentStatus: resolvedPaymentStatus || existing.paymentStatus,
    },
  });
  // Client may pass customer/email even when index is empty — apply after build.
  if (row?.customerName && !builtRow.customerName) builtRow.customerName = String(row.customerName);
  if (row?.email && !builtRow.email) builtRow.email = String(row.email);
  const fullRow = { ...builtRow };
  console.log("[Monday][Sync] Resolved pulse name:", itemName);

  let mondayItemId = existing.mondayItemId;

  if (!mondayItemId) {
    console.log("[Monday][Sync] No mondayItemId yet, creating new item");
    mondayItemId = await createMondayItem(itemName, fullRow);
    await prisma.orderLineItemOperationalData.update({
      where: { shop_orderId_variantId: { shop, orderId, variantId } },
      data: { mondayItemId, mondayItemName: itemName },
    });
    console.log("[Monday][Sync] Created and saved mondayItemId:", mondayItemId, "name:", itemName);
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

      const mondayTrackingAt = mondayBefore.trackingNumberChangedAt
        ? new Date(mondayBefore.trackingNumberChangedAt).getTime() : 0;
      const localTrackingAt = existing.trackingNumberUpdatedAt
        ? new Date(existing.trackingNumberUpdatedAt).getTime() : 0;

      if (mondayBefore.trackingNumber && mondayTrackingAt > localTrackingAt) {
        console.log(
          `[Monday][Sync] Monday tracking "${mondayBefore.trackingNumber}" (changed ${mondayBefore.trackingNumberChangedAt}) is newer than admin tab's last tracking change (${existing.trackingNumberUpdatedAt}). Keeping Monday's tracking.`
        );
        fullRow.trackingNumber = mondayBefore.trackingNumber;
      } else {
        console.log("[Monday][Sync] Admin tab tracking is newer (or Monday has none), pushing it.");
      }
    } else {
      console.log("[Monday][Sync] Could not fetch existing Monday item, pushing local values as-is.");
    }

    console.log("[Monday][Sync] Updating Monday item:", mondayItemId, "with resolved row:", fullRow);
    try {
      // updateMondayItem also sets pulse `name` from lineOrderName (#CDL215347A)
      await updateMondayItem(mondayItemId, fullRow);
      await renameMondayItem(mondayItemId, itemName);
      await prisma.orderLineItemOperationalData.update({
        where: { shop_orderId_variantId: { shop, orderId, variantId } },
        data: { mondayItemName: itemName },
      });
    } catch (updateError) {
      if (isStaleMondayItemError(updateError)) {
        console.log(`[Monday][Sync] Stale/inactive mondayItemId ${mondayItemId}, creating a fresh item`);
        mondayItemId = await createMondayItem(itemName, fullRow);
        await prisma.orderLineItemOperationalData.update({
          where: { shop_orderId_variantId: { shop, orderId, variantId } },
          data: { mondayItemId, mondayItemName: itemName, notesPushedCount: 0 },
        });
      } else {
        throw updateError;
      }
    }
  }

  const mondayData = await fetchMondayItem(mondayItemId);
  console.log("[Monday][Sync] Fetched latest data from Monday:", mondayData);
  const mondayStatus = mondayData?.customerStatus ?? "";
  const mondayTracking = mondayData?.trackingNumber ?? "";
  const mondayEdd = mondayData?.eddDate ?? "";
  const mondayOriginalEdd = mondayData?.originalEddDate ?? "";
  const mondayWarehouseStatus = mondayData?.warehouseStatus ?? "";
  const mondayDispatchStatus = mondayData?.dispatchStatus ?? "";
  const mondayDeliveryStatus = mondayData?.deliveryStatus ?? "";
  const mondayDepositPaid = mondayData?.depositPaid ?? "";
  const mondayBalanceDue = mondayData?.balanceDue ?? "";
  const mondayPaymentStatus = mondayData?.paymentStatus ?? "";

  const updated = await prisma.orderLineItemOperationalData.update({
    where: { shop_orderId_variantId: { shop, orderId, variantId } },
    data: {
      ...(mondayStatus ? { customerStatus: mondayStatus.toLowerCase() } : {}),
      ...(mondayTracking ? { trackingNumber: mondayTracking } : {}),
      ...(mondayEdd ? { eddDate: mondayEdd } : {}),
      ...(mondayOriginalEdd ? { originalEddDate: mondayOriginalEdd } : {}),
      ...(mondayWarehouseStatus ? { warehouseStatus: mondayWarehouseStatus } : {}),
      ...(mondayDispatchStatus ? { dispatchStatus: mondayDispatchStatus } : {}),
      ...(mondayDeliveryStatus ? { deliveryStatus: mondayDeliveryStatus } : {}),
      ...(mondayDepositPaid ? { depositPaid: mondayDepositPaid } : {}),
      ...(mondayBalanceDue ? { balanceDue: mondayBalanceDue } : {}),
      ...(mondayPaymentStatus ? { paymentStatus: normalizePaymentStatus(mondayPaymentStatus) } : {}),
    },
  });
  console.log("[Monday][Sync] DB updated with Monday data:", updated);

  // ── NEW: push any new admin-tab notes (tracking added, EDD changed, etc.)
  // to Monday's native Updates tab. Doesn't touch any existing column sync logic.
  // ── Push new admin-tab notes to Monday, tracking which update IDs we created ──
  const justPushedIds: string[] = [];
  try {
    const noteBlocks = String(existing.notes ?? "")
      .split(/\r?\n\r?\n/)
      .map((b) => b.trim())
      .filter(Boolean);

    const freshRecord = await prisma.orderLineItemOperationalData.findUnique({
      where: { shop_orderId_variantId: { shop, orderId, variantId } },
    });
    const mondayTaggedBlocks = noteBlocks.filter((b) => /^\[[^\]|]+:monday[|\]]/i.test(b));
    let alreadyPushed = freshRecord?.notesPushedMondayItemId === mondayItemId
      ? (freshRecord?.notesPushedCount ?? 0)
      : 0;
    if (alreadyPushed > mondayTaggedBlocks.length) alreadyPushed = 0;
    const newBlocks = mondayTaggedBlocks.slice(alreadyPushed);

    if (newBlocks.length > 0 && mondayItemId) {
      for (const block of newBlocks) {
        const cleaned = block.replace(/^\[[^\]]*\]\s*/, "");
        const createdId = await createMondayUpdate(mondayItemId, cleaned); // must return the new update's id
        if (createdId) justPushedIds.push(String(createdId));
      }
      await prisma.orderLineItemOperationalData.update({
        where: { shop_orderId_variantId: { shop, orderId, variantId } },
        data: { notesPushedCount: mondayTaggedBlocks.length, notesPushedMondayItemId: mondayItemId },
      });
      console.log(`[Monday][Sync] Pushed ${newBlocks.length} new note(s) to Monday Updates tab.`);
    } else {
      console.log("[Monday][Sync] No new notes to push to Monday Updates tab.");
    }
  } catch (e) {
    console.error("[Monday][Sync] Failed to push notes to Monday updates", e);
  }

  // ── Pull any new comments from Monday (by anyone) that we haven't already recorded ──
  // ── Pull any new comments from Monday (by anyone) that we haven't already recorded ──
  try {
    const mondayUpdates = await fetchMondayUpdates(mondayItemId);
    const fresh = await prisma.orderLineItemOperationalData.findUnique({
      where: { shop_orderId_variantId: { shop, orderId, variantId } },
    });
    const pulledIds = new Set(String(fresh?.notesPulledUpdateIds ?? "").split(",").filter(Boolean));
    justPushedIds.forEach((id) => pulledIds.add(id));

    const newFromMonday = mondayUpdates.filter((u: any) => !pulledIds.has(String(u.id)));

    if (newFromMonday.length > 0) {
      const formatted = newFromMonday.map((u: any) => {
        const time = new Date(u.createdAt).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
        return `[internal|${u.creatorName}|${time}] ${u.body}`;
      });
      const nextNotes = [String(fresh?.notes ?? ""), ...formatted].filter(Boolean).join("\n\n");
      const nextPulledIds = [...pulledIds, ...newFromMonday.map((u: any) => String(u.id))].join(",");

      // These blocks came FROM Monday — they must never be pushed back to Monday.
      // Bump notesPushedCount by however many blocks we just appended, so the push
      // step's "alreadyPushed" offset stays aligned with the new total block count.
      const currentPushedCount = fresh?.notesPushedMondayItemId === mondayItemId
        ? (fresh?.notesPushedCount ?? 0)
        : 0;
      const nextPushedCount = currentPushedCount + newFromMonday.length;

      await prisma.orderLineItemOperationalData.update({
        where: { shop_orderId_variantId: { shop, orderId, variantId } },
        data: {
          notes: nextNotes,
          notesPulledUpdateIds: nextPulledIds,
          notesPushedCount: nextPushedCount,
          notesPushedMondayItemId: mondayItemId,
        },
      });
    } else if (justPushedIds.length > 0) {
      const nextPulledIds = [...pulledIds].join(",");
      await prisma.orderLineItemOperationalData.update({
        where: { shop_orderId_variantId: { shop, orderId, variantId } },
        data: { notesPulledUpdateIds: nextPulledIds },
      });
    }
  } catch (e) {
    console.error("[Monday][Sync] Failed to pull comments", e);
  }

  // Persist match status to the Monday cache columns — same pattern as
  // cin7-update.tsx. Without this, mondayCachedStatus/mondayCachedMismatches
  // stay stale in the DB, so a reload or the next /api/monday-status refresh
  // flips the icon back to mismatch/missing even though the sync succeeded.
  try {
    await prisma.orderLineItemOperationalData.update({
      where: { shop_orderId_variantId: { shop, orderId, variantId } },
      data: { mondayCachedStatus: "match", mondayCachedMismatches: "" },
    });
  } catch (cacheErr) {
    console.error("[Monday][Sync] Failed to persist cache status", cacheErr);
  }

  const fieldSummary = summarizeMondayRow(fullRow);
  console.log(
    "[Monday][Sync] Field summary filled:",
    Object.keys(fieldSummary.filled),
    "blank:",
    fieldSummary.blank,
  );

  return Response.json(
    {
      ok: true,
      mondayItemId,
      mondayItemName: itemName,
      syncedFields: fieldSummary.filled,
      blankFields: fieldSummary.blank,
      updated: {
        ...updated,
        customerStatusColor: mondayData?.customerStatusColor ?? null, // NEW — not a DB column, added here only
        carriersColor: mondayData?.carriersColor ?? null,   // NEW
        paymentStatusColor: mondayData?.paymentStatusColor ?? null,   // NEW
      },
    },
    { headers: getCorsHeaders(request) },
  );
}