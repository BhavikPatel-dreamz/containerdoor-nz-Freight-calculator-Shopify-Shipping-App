/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { createMondayItem, updateMondayItem, isStaleMondayItemError, createMondayUpdate } from "../lib/monday.server";
import { syncCin7EstimatedDispatchDate, syncCin7TrackingNumber } from "../lib/cin7.server";

// Debug logging helper
const debug = (namespace: string, message: string, data?: any) => {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = `[${timestamp}] ${namespace}`;
  if (data !== undefined) {
    console.log(`${prefix}: ${message}`, data);
  } else {
    console.log(`${prefix}: ${message}`);
  }
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  // Allow Cache-Control here because some clients set it (and it triggers preflight)
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Cache-Control",
};

// ───────────────────────────────────────────────────────────────────────────
// GET — fetch line item operational data
// ───────────────────────────────────────────────────────────────────────────
export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId") ?? "";
  const shop = url.searchParams.get("shop") ?? "";

  if (!orderId) {
    return Response.json({ error: "Missing orderId" }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    const records = await prisma.orderLineItemOperationalData.findMany({
      where: { orderId, ...(shop ? { shop } : {}) },
      select: {
        variantId: true,
        productTitle: true,
        carrier: true,
        customerStatus: true,
        warehouseStatus: true,
        deliveryStatus: true,
        dispatchStatus: true,
        trackingNumber: true,
        freightRef: true,     
        eddDate: true,
        originalEddDate: true,
        supplierContainer: true,
        portArrivalDate: true,
        inTransitDate: true,
        depositPaid: true,
        balanceDue: true,
        notes: true,
      },
    });

    type RecordWithTitle = (typeof records)[number] & { productTitle: string; imageUrl: string };
    let lineItems: RecordWithTitle[] = records.map((r) => ({
      ...r,
      productTitle: r.productTitle ?? "",
      imageUrl: "",
    }));

    // Always fetch live line items from Shopify when shop is available.
    // This gives us: (a) up-to-date titles, (b) a canonical set of variantIds
    // to filter against — so stale/orphaned DB rows are never shown.
    let canonicalVariantIds: Set<string> | null = null;

    if (shop) {
      try {
        const { admin } = await unauthenticated.admin(shop);
        const res = await admin.graphql(
          `#graphql
            query OrderLineItems($id: ID!) {
              order(id: $id) {
              lineItems(first: 50) {
              nodes {
            title
              variant {
              id
              image { url }
            product { featuredImage { url } }
            }
           }
          }
         }
        }`,
          { variables: { id: `gid://shopify/Order/${orderId}` } }
        );
        const json = await res.json();
        const nodes: Array<{
          title: string;
          variant?: {
            id: string;
            image?: { url: string };
            product?: { featuredImage?: { url: string } };
          };
        }> = json.data?.order?.lineItems?.nodes ?? [];

        // Build a map of variantId → title from the live order
        // AFTER
        const titleMap = new Map<string, string>();
        const imageMap = new Map<string, string>();
        canonicalVariantIds = new Set<string>();

        for (const li of nodes) {
          if (li.variant?.id) {
            const numId = li.variant.id.replace("gid://shopify/ProductVariant/", "");
            titleMap.set(numId, li.title);
            canonicalVariantIds.add(numId);
            // Prefer variant image, fall back to product featured image
            const imgUrl =
              li.variant.image?.url ??
              li.variant.product?.featuredImage?.url ??
              "";
            if (imgUrl) imageMap.set(numId, imgUrl);
          }
        }

        // Apply titles and backfill DB where missing
        lineItems = lineItems.map((r) => {
          const title = titleMap.get(r.variantId);
          const imageUrl = imageMap.get(r.variantId) ?? "";
          const base = { ...r, imageUrl };   // attach image to every record

          if (title && !r.productTitle) {
            prisma.orderLineItemOperationalData
              .updateMany({
                where: { orderId, variantId: r.variantId, ...(shop ? { shop } : {}) },
                data: { productTitle: title },
              })
              .catch(() => { });
            return { ...base, productTitle: title };
          }
          if (title && r.productTitle !== title) {
            return { ...base, productTitle: title };
          }
          return base;
        });
      } catch (e) {
        console.error("[api.order-status] Shopify GraphQL error", e);
      }
    }

    // ── KEY FIX: filter out orphaned rows ──────────────────────────────────
    // If we got a canonical list of variantIds from Shopify, only return
    // records whose variantId actually exists in the current order.
    // This removes stale rows left over from deleted/replaced line items.
    if (canonicalVariantIds !== null) {
      lineItems = lineItems.filter((r) => canonicalVariantIds!.has(r.variantId));
    } else {
      // Fallback when shop is unknown: at minimum hide rows with no title,
      // since "Variant #xxx" rows are almost always orphaned data.
      lineItems = lineItems.filter((r) => r.productTitle !== "");
    }

    return Response.json({ ok: true, lineItems }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("[api.order-status] DB error", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS_HEADERS });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// POST — update editable fields for a single line item (used by admin block)
// ───────────────────────────────────────────────────────────────────────────
const EDITABLE_FIELDS = [
  "customerStatus",
  "warehouseStatus",
  "dispatchStatus",
  "deliveryStatus",
  "trackingNumber",
  "carrier", 
  "freightRef",   
  "eddDate",
  "originalEddDate",
  "supplierContainer",
  "portArrivalDate",
  "inTransitDate",
  "depositPaid",
  "balanceDue",
  "notes",
] as const;

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return Response.json(
      { ok: false, error: "Method not allowed" },
      { status: 405, headers: CORS_HEADERS }
    );
  }

  try {
    const body = (await request.json()) as {
      shop?: string;
      orderId?: string;
      variantId?: string;
      data?: Record<string, string>;
    };

    const { shop, orderId, variantId, data } = body;
    const shopValue = typeof shop === "string" ? shop : "";

    if (!orderId || !variantId || !data) {
      return Response.json(
        { ok: false, error: "Missing orderId, variantId, or data" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const updateData: Record<string, string> = {};
    for (const key of EDITABLE_FIELDS) {
      if (key in data) updateData[key] = String(data[key] ?? "");
    }

    let updated;
    const existing = shopValue
      ? await prisma.orderLineItemOperationalData.findUnique({
          where: { shop_orderId_variantId: { shop: shopValue, orderId, variantId } },
        })
      : await prisma.orderLineItemOperationalData.findFirst({
          where: { orderId, variantId },
        });

    const payload = { ...updateData } as Record<string, string | Date>;
    if (existing) {
      payload.originalEddDate = existing.originalEddDate
        ? existing.originalEddDate
        : existing.eddDate
          ? existing.eddDate
          : updateData.eddDate ?? "";
    } else if (Object.prototype.hasOwnProperty.call(updateData, "eddDate")) {
      payload.originalEddDate = updateData.eddDate;
    }

    // ── NEW: stamp field-level timestamps only when that field actually changes ──
    if (
      Object.prototype.hasOwnProperty.call(updateData, "customerStatus") &&
      updateData.customerStatus !== (existing?.customerStatus ?? "")
    ) {
      payload.customerStatusUpdatedAt = new Date();
    }
    if (
      Object.prototype.hasOwnProperty.call(updateData, "eddDate") &&
      updateData.eddDate !== (existing?.eddDate ?? "")
    ) {
      payload.eddDateUpdatedAt = new Date();
    }
    if (
      Object.prototype.hasOwnProperty.call(updateData, "trackingNumber") &&
      updateData.trackingNumber !== (existing?.trackingNumber ?? "")
    ) {
      payload.trackingNumberUpdatedAt = new Date();
    }
    // ── end new block ──

    if (shopValue) {
      updated = await prisma.orderLineItemOperationalData.upsert({
        where: { shop_orderId_variantId: { shop: shopValue, orderId, variantId } },
        update: payload,
        create: { shop: shopValue, orderId, variantId, ...payload },
      });
    } else if (existing) {
      updated = await prisma.orderLineItemOperationalData.update({
        where: { id: existing.id },
        data: payload,
      });
    } else {
      updated = await prisma.orderLineItemOperationalData.create({
        data: { shop: shopValue, orderId, variantId, ...payload },
      });
    }

    const orderOperationalData = shopValue
      ? await prisma.orderOperationalData.findUnique({
          where: { shop_orderId: { shop: shopValue, orderId } },
        })
      : null;

    const cin7SalesOrderId = orderOperationalData?.cin7SalesOrderId?.trim() || "";
    let cin7Exists = Boolean(cin7SalesOrderId && cin7SalesOrderId !== "pending");
    debug("Cin7", `orderId=${orderId}, cin7SalesOrderId=${cin7SalesOrderId}, eddDateChanged=${Object.prototype.hasOwnProperty.call(updateData, "eddDate")}, trackingChanged=${Object.prototype.hasOwnProperty.call(updateData, "trackingNumber")}, newEdd=${updateData.eddDate}`);

    if (Object.prototype.hasOwnProperty.call(updateData, "eddDate") && cin7SalesOrderId && cin7SalesOrderId !== "pending") {
      debug("Cin7", `Syncing EDD to Cin7: salesOrderId=${cin7SalesOrderId}, eddDate=${updateData.eddDate}`);
      const cin7Update = await syncCin7EstimatedDispatchDate({
        salesOrderId: cin7SalesOrderId,
        eddDate: updateData.eddDate || "",
        reference: orderId,
      });
      debug("Cin7", `EDD sync result:`, cin7Update);
      cin7Exists = cin7Update.exists;
    } else if (Object.prototype.hasOwnProperty.call(updateData, "trackingNumber") && cin7SalesOrderId && cin7SalesOrderId !== "pending") {
      debug("Cin7", `Syncing tracking to Cin7: salesOrderId=${cin7SalesOrderId}, trackingNumber=${updateData.trackingNumber}`);
      const cin7Update = await syncCin7TrackingNumber({
        salesOrderId: cin7SalesOrderId,
        trackingNumber: updateData.trackingNumber || "",
        reference: orderId,
      });
      debug("Cin7", `Tracking sync result:`, cin7Update);
      cin7Exists = cin7Update.exists;
    } else {
      debug("Cin7", `SKIP - no relevant Cin7 update needed`);
    }

    // ── NEW: push updated fields to Monday dashboard ──
    const mondayDebug: Record<string, unknown> = {
      attempted: true,
      shopUsed: shopValue || updated.shop || "",
      hadExistingMondayId: !!updated.mondayItemId,
    };
    try {
      const mondayRow = {
        customerName: "",
        email: "",
        carriers: updated.carrier ?? "",
        trackingNumber: updated.trackingNumber ?? "",
        eddDate: updated.eddDate ?? "",
        originalEddDate: updated.originalEddDate ?? "",
        productTitle: updated.productTitle ?? "",
        sku: "",
        boxes: "",
        customerStatus: updated.customerStatus ?? "",
        shop: shopValue || updated.shop || "",
        orderId,
        variantId,
        warehouseStatus: updated.warehouseStatus ?? "",
        dispatchStatus: updated.dispatchStatus ?? "",
        deliveryStatus: updated.deliveryStatus ?? "",
        depositPaid: updated.depositPaid ?? "",
        balanceDue: updated.balanceDue ?? "",
      };
      const itemName = mondayRow.productTitle || `Order ${orderId} - ${variantId}`;

      if (!updated.mondayItemId || updated.mondayItemId === "pending") {
        const newMondayId = await createMondayItem(itemName, mondayRow);
        updated = await prisma.orderLineItemOperationalData.update({
          where: { id: updated.id },
          data: { mondayItemId: newMondayId },
        });
        mondayDebug.action = "created";
        mondayDebug.mondayItemId = newMondayId;
      } else {
        try {
          await updateMondayItem(updated.mondayItemId, mondayRow);
          mondayDebug.action = "updated";
          mondayDebug.mondayItemId = updated.mondayItemId;
        } catch (mErr) {
          if (isStaleMondayItemError(mErr)) {
            const newMondayId = await createMondayItem(itemName, mondayRow);
            updated = await prisma.orderLineItemOperationalData.update({
              where: { id: updated.id },
              data: { mondayItemId: newMondayId },
            });
            mondayDebug.action = "recreated-stale";
            mondayDebug.mondayItemId = newMondayId;
          } else {
            throw mErr;
          }
        }
      }
    } catch (mondayErr) {
      console.error("[api.order-status] Failed to push update to Monday", mondayErr);
      mondayDebug.action = "failed";
      mondayDebug.error = mondayErr instanceof Error ? mondayErr.message : String(mondayErr);
    }
    // ── end new block ──

    // ── NEW: push new notes to Monday Updates tab ──
    // ── NEW: push new notes to Monday Updates tab ──
    try {
      const noteBlocks = String(updated.notes ?? "")
        .split(/\r?\n\r?\n/)
        .map((b) => b.trim())
        .filter(Boolean);

      const alreadyPushed = updated.notesPushedMondayItemId === updated.mondayItemId
        ? (updated.notesPushedCount ?? 0)
        : 0;
      const newBlocks = noteBlocks.slice(alreadyPushed);

      if (newBlocks.length > 0 && updated.mondayItemId && updated.mondayItemId !== "pending") {
        const pushedIds: string[] = [];
        for (const block of newBlocks) {
          const cleaned = block.replace(/^\[[^\]]*\]\s*/, "");
          const createdId = await createMondayUpdate(updated.mondayItemId, cleaned);
          if (createdId) pushedIds.push(String(createdId));
        }
        const existingPulledIds = new Set(
          String(updated.notesPulledUpdateIds ?? "").split(",").filter(Boolean)
        );
        pushedIds.forEach((id) => existingPulledIds.add(id));
        updated = await prisma.orderLineItemOperationalData.update({
          where: { id: updated.id },
          data: {
            notesPushedCount: noteBlocks.length,
            notesPushedMondayItemId: updated.mondayItemId,
            notesPulledUpdateIds: [...existingPulledIds].join(","),
          },
        });
      }
    } catch (noteErr) {
      console.error("[api.order-status] Failed to push notes to Monday updates", noteErr);
    }
    // ── end new block ──

    // Fallback: if the client didn't send a shop, use whatever ended up on the saved record
    const resolvedShop = shopValue || updated.shop || "";

    fetch("https://webhook.site/12c1d76a-a089-4cd7-9a3e-ed11beb1f125", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "order-extension",
        shop: resolvedShop,
        orderId,
        variantId,
        data: updateData,
        updatedAt: new Date().toISOString(),
      }),
    }).catch((e) => console.error("[webhook] failed to send", e));

    return Response.json({ ok: true, record: updated, mondayDebug, cin7Exists }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("[api.order-status] action error", err);
    return Response.json(
      { ok: false, error: String(err) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}