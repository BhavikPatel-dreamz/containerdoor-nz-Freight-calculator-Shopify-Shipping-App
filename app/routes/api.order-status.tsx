import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
        supplierContainer: true,
        portArrivalDate: true,
        inTransitDate: true,
        depositPaid: true,
        balanceDue: true,
        notes: true,
      },
    });

    type RecordWithTitle = (typeof records)[number] & { productTitle: string };
    let lineItems: RecordWithTitle[] = records.map((r) => ({
      ...r,
      productTitle: r.productTitle ?? "",
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
                nodes { title variant { id } }
              }
            }
          }`,
          { variables: { id: `gid://shopify/Order/${orderId}` } }
        );
        const json = await res.json();
        const nodes: Array<{ title: string; variant?: { id: string } }> =
          json.data?.order?.lineItems?.nodes ?? [];

        // Build a map of variantId → title from the live order
        const titleMap = new Map<string, string>();
        canonicalVariantIds = new Set<string>();

        for (const li of nodes) {
          if (li.variant?.id) {
            const numId = li.variant.id.replace("gid://shopify/ProductVariant/", "");
            titleMap.set(numId, li.title);
            canonicalVariantIds.add(numId);
          }
        }

        // Apply titles and backfill DB where missing
        lineItems = lineItems.map((r) => {
          const title = titleMap.get(r.variantId);
          if (title && !r.productTitle) {
            prisma.orderLineItemOperationalData
              .updateMany({
                where: { orderId, variantId: r.variantId, ...(shop ? { shop } : {}) },
                data: { productTitle: title },
              })
              .catch(() => {});
            return { ...r, productTitle: title };
          }
          // Even if already has a title, refresh it from live data
          if (title && r.productTitle !== title) {
            return { ...r, productTitle: title };
          }
          return r;
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

    // If shop was provided, upsert using the unique composite key (shop+orderId+variantId).
    // If shop is missing, try to find an existing record by orderId+variantId and update it
    // to avoid creating a duplicate row with an empty shop value.
    if (shopValue) {
      updated = await prisma.orderLineItemOperationalData.upsert({
        where: { shop_orderId_variantId: { shop: shopValue, orderId, variantId } },
        update: updateData,
        create: { shop: shopValue, orderId, variantId, ...updateData },
      });
    } else {
      // Try to find any existing record that matches orderId+variantId regardless of shop
      const existing = await prisma.orderLineItemOperationalData.findFirst({
        where: { orderId, variantId },
      });

      if (existing) {
        updated = await prisma.orderLineItemOperationalData.update({
          where: { id: existing.id },
          data: updateData,
        });
      } else {
        // No existing record — create one with empty shop value to preserve previous behaviour
        updated = await prisma.orderLineItemOperationalData.create({
          data: { shop: shopValue, orderId, variantId, ...updateData },
        });
      }
    }

    return Response.json({ ok: true, record: updated }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("[api.order-status] action error", err);
    return Response.json(
      { ok: false, error: String(err) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}