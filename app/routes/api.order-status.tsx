import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";

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

    return Response.json({ ok: true, record: updated }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("[api.order-status] action error", err);
    return Response.json(
      { ok: false, error: String(err) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}