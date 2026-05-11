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
  line_items?: OrderLineItem[];
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const orderPayload = payload as OrderPayload;
  const syncPayload = buildOrderSyncPayload(shop, orderPayload);

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
