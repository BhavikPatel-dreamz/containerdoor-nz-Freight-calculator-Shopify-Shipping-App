/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { createMondayItem } from "../lib/monday.server";

type OrderLineItemProperty = {
  name?: string;
  value?: string;
};

type OrderLineItem = {
  id?: number;
  sku?: string;
  quantity?: number;
  grams?: number;
  properties?: OrderLineItemProperty[];
};

type OrderShippingLine = {
  title?: string;
  code?: string;
};

type OrderPayload = {
  id?: number;
  name?: string;
  created_at?: string;
  currency?: string;
  total_price?: string;
  shipping_address?: {
    city?: string;
    zip?: string;
    country_code?: string;
  };
  shipping_lines?: OrderShippingLine[];
  line_items?: OrderLineItem[];
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, payload, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const orderPayload = payload as OrderPayload;
  const syncPayload = buildOrderSyncPayload(shop, orderPayload);

  // Mirror the freight breakdown (encoded in the shipping-line `code`) onto an
  // order metafield so the customer-account extension — which cannot read
  // shippingLine.code — can render the same per-variant carrier/box info.
   if (admin && orderPayload.id) {
    await writeFreightMetafield(admin, orderPayload);
    await createMondayEntriesForOrder(shop, orderPayload);
  }

  const targets = [
    {
      name: "Cin7",
      url: process.env.CIN7_SYNC_URL,
      token: process.env.CIN7_SYNC_TOKEN,
    },
    {
      name: "Monday",
      url: process.env.MONDAY_SYNC_URL,
      token: process.env.MONDAY_SYNC_TOKEN,
    },
  ];

  await Promise.all(
    targets.map(async (target) => {
      if (!target.url) return;
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (target.token) {
          headers.Authorization = `Bearer ${target.token}`;
        }

        const response = await fetch(target.url, {
          method: "POST",
          headers,
          body: JSON.stringify(syncPayload),
        });

        if (!response.ok) {
          console.error(`Order sync failed for ${target.name}: ${response.status}`);
        }
      } catch (error) {
        console.error(`Order sync request failed for ${target.name}`, error);
      }
    }),
  );

  return new Response();
};

function buildOrderSyncPayload(shop: string, order: OrderPayload) {
  return {
    shop,
    order: {
      id: order.id,
      name: order.name,
      createdAt: order.created_at,
      currency: order.currency,
      totalPrice: order.total_price,
      shippingAddress: {
        city: order.shipping_address?.city,
        postalCode: order.shipping_address?.zip,
        countryCode: order.shipping_address?.country_code,
      },
      lineItems: (order.line_items ?? []).map((lineItem) => ({
        id: lineItem.id,
        sku: lineItem.sku,
        quantity: lineItem.quantity,
        grams: lineItem.grams,
        freight: extractFreightProperties(lineItem.properties ?? []),
      })),
    },
  };
}

// ─── Freight metafield (for customer-account extension) ─────────────────────────

const FREIGHT_NAMESPACE = "containerdoor_freight";
const FREIGHT_METAFIELD_KEY = "freight_data";

const FREIGHT_SERVICE_PREFIXES = [
  "standard_delivery::",
  "depot_delivery::",
  "customer_pickup::",
];

const COMPANY_LABELS: Record<string, string> = {
  FLIWAYLINEHAUL: "Fliway - Linehaul",
  FLIWAYMIDSIZE: "Fliway - Midsize",
  NZP: "NZP",
  NZP_AGE_RESTRICTED: "NZP - Age Restricted",
  CASTLE: "Castle",
  TGE: "Team Global Express",
  M2H: "M2H",
  MAINFREIGHT: "Mainfreight",
};

// service_code format (see app/routes/app.freight-orders.tsx):
//   standard_delivery::CARRIERS::Nboxes::::::variantId:COMPANYxBoxes|variantId:COMPANYxBoxes
function parseFreightCode(code: string | undefined, order: OrderPayload) {
  if (!code) return null;
  if (!FREIGHT_SERVICE_PREFIXES.some((prefix) => code.startsWith(prefix))) return null;

  const segments = code.split("::");
  const carriers = segments[1];
  const packageCount = segments[2];
  const lineItemsRaw = segments[4];
  if (!carriers || !lineItemsRaw) return null;

  // Map numeric variant id -> product title and SKU from the order line items.
  const titleByVariant = new Map<string, string>();
  const skuByVariant = new Map<string, string>();
  for (const li of order.line_items ?? []) {
    const anyLi = li as OrderLineItem & { variant_id?: number; title?: string; sku?: string };
    if (anyLi.variant_id != null) {
      if (anyLi.title) titleByVariant.set(String(anyLi.variant_id), anyLi.title);
      if (anyLi.sku) skuByVariant.set(String(anyLi.variant_id), anyLi.sku);
    }
  }

  const lineItems = lineItemsRaw.split("|").map((part) => {
    const [variantId, rest] = part.split(":");
    const [company, boxesStr] = (rest ?? "").split("x");
    return {
      variantId,
      title: titleByVariant.get(variantId),
      sku: skuByVariant.get(variantId) ?? "",
      company: company ?? "",
      companyLabel: COMPANY_LABELS[company ?? ""] ?? company ?? "",
      boxes: Number(boxesStr ?? 0),
    };
  });

  return { carriers, packageCount, lineItems };
}

async function writeFreightMetafield(
  admin: { graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> },
  order: OrderPayload,
) {
  try {
    const freightLine = (order.shipping_lines ?? []).find((s) =>
      FREIGHT_SERVICE_PREFIXES.some((prefix) => s.code?.startsWith(prefix)),
    );
    const breakdown = parseFreightCode(freightLine?.code, order);
    if (!breakdown) return;

    const response = await admin.graphql(
      `#graphql
      mutation SetFreightMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              ownerId: `gid://shopify/Order/${order.id}`,
              namespace: FREIGHT_NAMESPACE,
              key: FREIGHT_METAFIELD_KEY,
              type: "json",
              value: JSON.stringify(breakdown),
            },
          ],
        },
      },
    );

    const json = await response.json();
    const userErrors = json?.data?.metafieldsSet?.userErrors ?? [];
    if (userErrors.length) {
      console.error("Freight metafield write errors", userErrors);
    }
  } catch (error) {
    console.error("Failed to write freight metafield", error);
  }
}


async function createMondayEntriesForOrder(shop: string, order: OrderPayload) {
  const orderId = String(order.id);
  console.log(`[Monday][Webhook][${orderId}] START createMondayEntriesForOrder for order ${order.name}`);

  try {
    const { default: prisma } = await import("../db.server");

    const freightLine = (order.shipping_lines ?? []).find((s) =>
      FREIGHT_SERVICE_PREFIXES.some((prefix) => s.code?.startsWith(prefix)),
    );

    if (!freightLine) {
      console.log(`[Monday][Webhook][${orderId}] SKIP - no freight shipping line found. All shipping_lines:`,
        JSON.stringify(order.shipping_lines));
      return;
    }

    const breakdown = parseFreightCode(freightLine.code, order);
    if (!breakdown || !order.id) {
      console.log(`[Monday][Webhook][${orderId}] SKIP - could not parse freight code:`, freightLine.code);
      return;
    }
    console.log(`[Monday][Webhook][${orderId}] Parsed breakdown, ${breakdown.lineItems.length} line item(s):`,
      JSON.stringify(breakdown.lineItems));

    const customerName = [
      (order as any).shipping_address?.first_name,
      (order as any).shipping_address?.last_name,
    ].filter(Boolean).join(" ") || "—";
    const email = (order as any).email ?? "—";

    let createdCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const [idx, li] of breakdown.lineItems.entries()) {
      if (!li.variantId) {
        console.log(`[Monday][Webhook][${orderId}] SKIP line item idx=${idx} - no variantId`, li);
        skippedCount++;
        continue;
      }

      const letterSuffix = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[idx % 26];
      const itemName = `${order.name ?? orderId}${letterSuffix}`;

      let claimed = false;
      try {
        await prisma.orderLineItemOperationalData.create({
          data: {
            shop,
            orderId,
            variantId: li.variantId,
            productTitle: li.title ?? "",
            carrier: li.company,
            mondayItemId: "pending",
          },
        });
        claimed = true;
        console.log(`[Monday][Webhook][${orderId}] Claimed row for variant ${li.variantId} (item "${itemName}")`);
      } catch (claimError) {
        console.log(
          `[Monday][Webhook][${orderId}] SKIP variant ${li.variantId} - row already exists (duplicate webhook or already processed)`,
        );
        skippedCount++;
      }
      if (!claimed) continue;

      // Isolate the Monday API call so DB claim vs Monday create vs DB update failures are distinguishable.
      let mondayItemId: string;
      try {
        console.log(`[Monday][Webhook][${orderId}] Calling createMondayItem for "${itemName}" (variant ${li.variantId})...`);
        mondayItemId = await createMondayItem(itemName, {
          customerName,
          email,
          carriers: li.company,
          trackingNumber: "",
          eddDate: "",
          originalEddDate: "",
          productTitle: li.title ?? "",
          sku: li.sku ?? "",
          boxes: li.boxes ?? "",
          customerStatus: "",
          shop,
          orderId,
          variantId: li.variantId,
          warehouseStatus: "",
          dispatchStatus: "",
          deliveryStatus: "",
          depositPaid: "",
          balanceDue: "",
        });
        console.log(`[Monday][Webhook][${orderId}] SUCCESS - Monday item created, id=${mondayItemId} for variant ${li.variantId}`);
      } catch (mondayError) {
        failedCount++;
        console.error(
          `[Monday][Webhook][${orderId}] FAILED createMondayItem for variant ${li.variantId}. Row stays "pending" in DB.`,
          mondayError,
        );
        // Leave the DB row as "pending" so it's visible/queryable later; don't attempt the update below.
        continue;
      }

      try {
        await prisma.orderLineItemOperationalData.update({
          where: { shop_orderId_variantId: { shop, orderId, variantId: li.variantId } },
          data: { mondayItemId },
        });
        createdCount++;
        console.log(`[Monday][Webhook][${orderId}] DB updated with mondayItemId=${mondayItemId} for variant ${li.variantId}`);
      } catch (dbUpdateError) {
        failedCount++;
        console.error(
          `[Monday][Webhook][${orderId}] Monday item WAS created (id=${mondayItemId}) but DB update FAILED for variant ${li.variantId}. ` +
          `This row will show mondayItemId="pending" even though a Monday item exists — check for orphaned Monday items.`,
          dbUpdateError,
        );
      }
    }

    console.log(
      `[Monday][Webhook][${orderId}] DONE - created=${createdCount}, skipped=${skippedCount}, failed=${failedCount}, total=${breakdown.lineItems.length}`,
    );
  } catch (error) {
    console.error(`[Monday][Webhook][${orderId}] FATAL ERROR - createMondayEntriesForOrder threw:`, error);
  }
}


function extractFreightProperties(properties: OrderLineItemProperty[]) {
  const map = Object.fromEntries(
    properties
      .filter((property) => property.name)
      .map((property) => [String(property.name), String(property.value ?? "")]),
  );

  return {
    company: map.courier_company,
    serviceType: map.freight_service_type,
    boxes: map.number_of_boxes,
    unitsPerBox: map.units_per_box,
    weightGrams: map.weight_grams,
    volumeCm3: map.volume_cm3,
    hiabRequired: map.hiab_required,
    shippingCharge: map.freight_charge,
  };
}
