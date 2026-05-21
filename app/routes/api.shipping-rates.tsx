import type { ActionFunctionArgs } from "react-router";
import type { CarrierCompany } from "@prisma/client";
import {
  carrierCompanies,
  companyLabels,
  freightMetafieldNamespace,
  serviceLabels,
} from "../lib/freight";
import { calculateServiceRates, type FreightPackage } from "../models/freight.server";
import { unauthenticated } from "../shopify.server";

type ShopifyCarrierRateRequest = {
  rate?: {
    destination?: {
      city?: string;
      postal_code?: string;
    };
    currency?: string;
    items?: Array<{
      quantity?: number;
      grams?: number;
      variant_id?: number | string;
      properties?: Record<string, string>;
    }>;
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop") || process.env.SHOPIFY_SHOP_DOMAIN || "";

    if (!shop) {
      console.error("Shipping callback missing shop query parameter and SHOPIFY_SHOP_DOMAIN fallback");
      return Response.json({ rates: [] });
    }

    const payload = (await request.json()) as ShopifyCarrierRateRequest;
    console.log(
      `Shipping callback received for ${shop} with ${payload.rate?.items?.length ?? 0} cart items`,
    );

    console.log(`Environment variable SHOPIFY_SHOP_DOMAIN: ${JSON.stringify(payload)}`);
    
    console.log(`USE_STATIC_SHIPPING_RATES is ${useStaticRates()}`);
    console.log(`Payload rate currency: ${payload.rate?.currency}`);
    // console.log({
    //     rates: buildStaticRates(payload.rate?.currency || "NZD"),
    //   })

    //   return Response.json({
    //     rates: buildStaticRates(payload.rate?.currency || "NZD"),
    //   });


    const destination = {
      city: payload.rate?.destination?.city,
      postalCode: payload.rate?.destination?.postal_code,
    };
    const packages = await getFreightPackages(shop, payload.rate?.items ?? []);

    if (packages.length === 0) {
      return Response.json({ rates: [] });
    }

    const serviceRates = await calculateServiceRates(shop, destination, packages);
    const rates = serviceRates.map((serviceRate) => ({
      service_name: serviceLabels[serviceRate.serviceType],
      service_code: serviceRate.serviceType.toLowerCase(),
      description: `ContainerDoor freight via ${serviceRate.companies.map((company) => companyLabels[company]).join(", ")} (${serviceRate.packageCount} boxes)`,
      currency: serviceRate.currency || payload.rate?.currency || "NZD",
      total_price: Math.round(serviceRate.total * 100).toString(),
    }));

    return Response.json({ rates });
  } catch (error) {
    console.error("Shipping callback failed", error);
    return Response.json({ rates: [] });
  }
};

function useStaticRates() {
  const value = String(process.env.USE_STATIC_SHIPPING_RATES || "false").toLowerCase();
  return value !== "false" && value !== "0";
}

function buildStaticRates(currency: string) {
  return [
    {
      "service_name": "Standard Shipping bhavik",
      "service_code": "STD",
      "total_price": "1400",
      "description": "3-5 Business Days",
      "currency": "USD"
    },
    {
      service_name: "Depot delivery",
      service_code: "depot_delivery",
      description: "ContainerDoor static test rate",
      currency,
      total_price: "9800",
    },
    {
      service_name: "Customer pickup",
      service_code: "customer_pickup",
      description: "Pickup from warehouse",
      currency,
      total_price: "0",
    },
  ];
}

async function getFreightPackages(
  shop: string,
  items: NonNullable<ShopifyCarrierRateRequest["rate"]>["items"],
) {
  const variantIds = (items ?? [])
    .map((item) => item.variant_id)
    .filter(Boolean)
    .map((variantId) => `gid://shopify/ProductVariant/${variantId}`);
  const metafieldsByVariant = await loadVariantMetafields(shop, variantIds);
  const packages: FreightPackage[] = [];

  for (const item of items ?? []) {
    const variantGid = item.variant_id ? `gid://shopify/ProductVariant/${item.variant_id}` : "";
    const metafields = metafieldsByVariant.get(variantGid) ?? {};
    const properties = item.properties ?? {};
    const quantity = Number(item.quantity ?? 1);
    const unitsPerBox = positiveInt(metafields.units_per_box || properties.units_per_box) || 1;
    const explicitBoxes = positiveInt(metafields.number_of_boxes || properties.number_of_boxes);
    const boxes = Math.max(explicitBoxes || Math.ceil(quantity / unitsPerBox), 1);
    const length = positiveNumber(metafields.box_length_cm || properties.box_length_cm);
    const width = positiveNumber(metafields.box_width_cm || properties.box_width_cm);
    const height = positiveNumber(metafields.box_height_cm || properties.box_height_cm);
    const company = normaliseCompany(metafields.courier_company || properties.courier_company);

    if (!company) continue;

    packages.push({
      variantId: variantGid,
      quantity,
      company,
      boxes,
      weightGrams: positiveInt(metafields.weight_grams || properties.weight_grams) || Number(item.grams ?? 0) * quantity,
      volumeCm3: length * width * height * boxes,
      hiabRequired: isTrue(metafields.hiab_required) || isTrue(properties.hiab_required),
    });
  }

  return packages;
}

async function loadVariantMetafields(shop: string, variantIds: string[]) {
  const metafieldsByVariant = new Map<string, Record<string, string>>();
  if (variantIds.length === 0) return metafieldsByVariant;

  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(
      `#graphql
      query VariantFreightMetafields($ids: [ID!]!, $namespace: String!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            metafields(first: 20, namespace: $namespace) {
              nodes { key value }
            }
          }
        }
      }`,
      { variables: { ids: variantIds, namespace: freightMetafieldNamespace } },
    );
    const json = await response.json();
    for (const node of json.data?.nodes ?? []) {
      if (!node?.id) continue;
      metafieldsByVariant.set(
        node.id,
        Object.fromEntries((node.metafields?.nodes ?? []).map((field: { key: string; value: string }) => [field.key, field.value])),
      );
    }
  } catch {
    return metafieldsByVariant;
  }

  return metafieldsByVariant;
}

function normaliseCompany(value: string | undefined): CarrierCompany | null {
  const normalised = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  const aliases: Record<string, CarrierCompany> = {
    TEAM_GLOBAL_EXPRESS: "TGE",
    MAIN_FREIGHT: "MAINFREIGHT",
    COURIER_POST: "NZP",
  };
  const mapped = aliases[normalised] ?? normalised;
  return carrierCompanies.includes(mapped as CarrierCompany) ? (mapped as CarrierCompany) : null;
}

function positiveNumber(value: string | undefined) {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function positiveInt(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isTrue(value: string | undefined) {
  return ["1", "true", "yes", "on", "y"].includes(String(value ?? "").trim().toLowerCase());
}
