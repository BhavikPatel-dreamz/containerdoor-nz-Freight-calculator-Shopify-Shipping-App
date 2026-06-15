import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

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
  const lineItemsRaw = segments[6];
  if (!carriers || !lineItemsRaw) return null;

  // Map numeric variant id -> product title from the order line items.
  const titleByVariant = new Map<string, string>();
  for (const li of order.line_items ?? []) {
    const anyLi = li as OrderLineItem & { variant_id?: number; title?: string };
    if (anyLi.variant_id != null && anyLi.title) {
      titleByVariant.set(String(anyLi.variant_id), anyLi.title);
    }
  }

  const lineItems = lineItemsRaw.split("|").map((part) => {
    const [variantId, rest] = part.split(":");
    const [company, boxesStr] = (rest ?? "").split("x");
    return {
      variantId,
      title: titleByVariant.get(variantId),
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
