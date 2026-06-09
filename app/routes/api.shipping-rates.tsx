import type { ActionFunctionArgs } from "react-router";
import type { CarrierCompany } from "@prisma/client";
import {
  carrierCompanies,
  companyLabels,  
  freightMetafieldNamespace,
  // serviceLabels,
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

    // console.log(`Environment variable SHOPIFY_SHOP_DOMAIN: ${JSON.stringify(payload)}`);

    // console.log(`USE_STATIC_SHIPPING_RATES is ${useStaticRates()}`);
    // console.log(`Payload rate currency: ${payload.rate?.currency}`);
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

    // Filter to Standard Delivery only; one combined rate shown to customer
    const serviceNameMap: Partial<Record<string, string>> = {
      STANDARD_DELIVERY: "Standard Delivery",
      DEPOT_DELIVERY: "Depot Collection",
      CUSTOMER_PICKUP: "Customer Pickup",
    };

    const shopifyRates: Array<{
      service_name: string;
      service_code: string;
      currency: string;
      total_price: string;
    }> = [];

    for (const serviceRate of serviceRates) {
      const serviceName = serviceRate.serviceType === "DEPOT_DELIVERY"
  ? `${companyLabels[serviceRate.companies[0]] ?? serviceRate.companies[0]} Depot Collection – ${destination.city ?? "Depot"}`
  : (serviceNameMap[serviceRate.serviceType] ?? serviceRate.serviceType);

      // Log per-line-item breakdown for internal visibility
      console.log(
        `[FREIGHT] ${serviceName} breakdown for ${shop}:`,
        JSON.stringify(serviceRate.lineItemBreakdown, null, 2),
      );

      // Build a compact metadata string saved natively on the Shopify order shipping line
      const lineItemSummary = serviceRate.lineItemBreakdown
        .map((l) => `${l.variantId.split("/").pop()}:${l.company}x${l.boxes}`)
        .join("|");

      // This service_code is stored verbatim on the Shopify order — visible in admin + API
      // Format: standard_delivery::TGE,MAINFREIGHT::4boxes::v123:TGEx2|v456:MAINFREIGHTx1
      const companies = [...new Set(serviceRate.lineItemBreakdown.map((l) => l.company))].join(",");
      const serviceCode = `${serviceRate.serviceType.toLowerCase()}::${companies}::${serviceRate.packageCount}boxes::$${serviceRate.total.toFixed(2)}::${lineItemSummary}`;

      shopifyRates.push({
        service_name: serviceName,
        service_code: serviceCode,
        currency: serviceRate.currency || payload.rate?.currency || "NZD",
        total_price: Math.round(serviceRate.total * 100).toString(),
      });
    }

    if (shopifyRates.length === 0) {
      // No valid carrier found for this address — show manual quote message
      return Response.json({
        rates: [
          {
            service_name: "Freight Quote Required",
            service_code: "manual_quote",
            description: "Please contact us for a freight quote for your location.",
            currency: payload.rate?.currency || "NZD",
            total_price: "0",
          },
        ],
      });
    }

    return Response.json({ rates: shopifyRates });
  } catch (error) {
    console.error("Shipping callback failed", error);
    return Response.json({ rates: [] });
  }
};

// function useStaticRates() {
//   const value = String(process.env.USE_STATIC_SHIPPING_RATES || "false").toLowerCase();
//   return value !== "false" && value !== "0";
// }

// function buildStaticRates(currency: string) {
//   return [
//     {
//       "service_name": "Standard Shipping bhavik",
//       "service_code": "STD",
//       "total_price": "1400",
//       "description": "3-5 Business Days",
//       "currency": "USD"
//     },
//     {
//       service_name: "Depot delivery",
//       service_code: "depot_delivery",
//       description: "ContainerDoor static test rate",
//       currency,
//       total_price: "9800",
//     },
//     {
//       service_name: "Customer pickup",
//       service_code: "customer_pickup",
//       description: "Pickup from warehouse",
//       currency,
//       total_price: "0",
//     },
//   ];
// }

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
    const variantGid = item.variant_id
      ? `gid://shopify/ProductVariant/${item.variant_id}`
      : "";
    const metafields = metafieldsByVariant.get(variantGid) ?? {};
    const properties = item.properties ?? {};

    // ADD THIS — log raw metafields coming from Shopify
    console.log(`[DEBUG] variantGid: ${variantGid}`);
    console.log(`[DEBUG] metafields from Shopify:`, JSON.stringify(metafields));
    console.log(`[DEBUG] item.properties:`, JSON.stringify(properties));

    const quantity = Number(item.quantity ?? 1);
    const unitsPerBox = positiveInt(metafields.units_per_box || properties.units_per_box) || 1;
    const explicitBoxes = positiveInt(metafields.number_of_boxes || properties.number_of_boxes);
    const boxes = Math.max(explicitBoxes || Math.ceil(quantity / unitsPerBox), 1);
    const lengthRaw = metafields.box_length_cm || properties.box_length_cm || "";
const widthRaw  = metafields.box_width_cm  || properties.box_width_cm  || "";
const heightRaw = metafields.box_height_cm || properties.box_height_cm || "";
const weightRaw = metafields.weight_grams  || properties.weight_grams  || "";

const lengths = lengthRaw.split(",").map((v) => positiveNumber(v.trim()));
const widths  = widthRaw.split(",").map((v) => positiveNumber(v.trim()));
const heights = heightRaw.split(",").map((v) => positiveNumber(v.trim()));
const weights = weightRaw.split(",").map((v) => positiveInt(v.trim()));

const boxCount = Math.max(lengths.length, widths.length, heights.length, 1);
let volumeCm3 = 0;
let multiBoxWeightGrams = 0;

for (let i = 0; i < boxCount; i++) {
  const l = lengths[i] ?? 0;
  const w = widths[i] ?? 0;
  const h = heights[i] ?? 0;
  if (l > 0 && w > 0 && h > 0) volumeCm3 += l * w * h;
  multiBoxWeightGrams += weights[i] ?? 0;
}

console.log(`[DEBUG] computed → boxCount:${boxCount} volumeCm3:${volumeCm3} multiBoxWeightGrams:${multiBoxWeightGrams}`);

    const companyRaw = metafields.courier_company || properties.courier_company || "";

const companyValues: string[] = Array.isArray(JSON.parse(companyRaw || "[]"))
  ? JSON.parse(companyRaw || "[]")
  : [];

const companies = companyValues
  .map((c) => normaliseCompany(c.trim()))
  .filter((c): c is CarrierCompany => c !== null);

    console.log(`[DEBUG] companies:${companies}`);

    if (companies.length === 0) {
      console.log(`[DEBUG] skipping item — no valid company found`);
      continue;
    }

    for (const company of companies) {
      packages.push({
        variantId: variantGid,
        quantity,
        company,
        boxes: boxCount,
weightGrams:
  multiBoxWeightGrams > 0
    ? multiBoxWeightGrams
    : Number(item.grams ?? 0) * quantity,
        volumeCm3,
        hiabRequired:
          isTrue(metafields.hiab_required) || isTrue(properties.hiab_required),
        // Home delivery determination is performed by matched rate rows / DB settings
        homeDelivery: false,
        // These are now derived from the matched rate row surcharge values
        // (set to false here; overridden in calculateNzpRate / calculateCastleRate)
        nzpSignature: false,
        nzpRural: false,
        nzpAgeRestricted: false,
        castleSignature: false,
        castleRural: false,
        castleWaiheke: false,
      });
    }
  }

  // ADD THIS — final packages summary
  console.log(`[DEBUG] total packages built: ${packages.length}`);
  console.log(`[DEBUG] packages:`, JSON.stringify(packages));

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
