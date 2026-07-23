import type {
  CarrierCompany,
  CarrierMode,
  CostType,
  ServiceType,
} from "@prisma/client";

export const carrierCompanies: CarrierCompany[] = [
  "FLIWAYLINEHAUL",
  "FLIWAYMIDSIZE",
  "NZP",
  "NZP_AGE_RESTRICTED",
  "CASTLE",
  "TGE",
  "M2H",
  "MAINFREIGHT",
];

export const serviceTypes: ServiceType[] = [
  "STANDARD_DELIVERY",
  "DEPOT_DELIVERY",
  "CUSTOMER_PICKUP",
];

export const nzpSectors = [
  "Local",
  "Local Town",
  "One Sector",
  "Two Sector",
  "Island To Island (Economy)",
] as const;

export const carrierModes: CarrierMode[] = ["AIR", "ROAD"];

export const costTypes: CostType[] = ["FIXED", "PERCENTAGE"];

export const serviceLabels: Record<ServiceType, string> = {
  STANDARD_DELIVERY: "Standard delivery",
  DEPOT_DELIVERY: "Depot delivery",
  CUSTOMER_PICKUP: "Customer pickup",
};

export const companyLabels: Record<string, string> = {
  FLIWAYLINEHAUL: "Fliway - Linehaul",
  FLIWAYMIDSIZE: "Fliway - Midsize",
  NZP: "NZP",
  NZP_AGE_RESTRICTED: "NZP - Age Restricted",
  CASTLE: "Castle",
  TGE: "Team Global Express",
  M2H: "M2H",
  MAINFREIGHT: "Mainfreight",
};

export const freightFormula = {
  depotCollectionCompanies: [
    "FLIWAYLINEHAUL",
    "FLIWAYMIDSIZE",
    "MAINFREIGHT",
    "TGE",
  ] as CarrierCompany[],

  // NEW: NZP-specific
  nzp: {
    totalVariableRate: 0.114, // TVR = VFR (10.8%) + RUC (0.6%)
    ruralSurcharge: 4.7854,
    signatureSurcharge: 0.5662,
    ageRestrictedSurcharge: 2.2835,
    residentialSurcharge: 0, // NZP has no residential fee
  },

  // NEW: Castle-specific
  castle: {
    totalVariableRate: 0.167, // TVR = VFF (12.2%) + RUC (4.5%)
    residentialSurcharge: 1, // Always applied
    ruralSurcharge: 1,
    signatureSurcharge: 1,
    waihekeSurcharge: 1,
  },
};

export const modeLabels: Record<CarrierMode, string> = {
  AIR: "Air",
  ROAD: "Road",
};

export const costTypeLabels: Record<CostType, string> = {
  FIXED: "Fixed",
  PERCENTAGE: "Percentage",
};

export const variantFreightMetafields = [
  { key: "number_of_boxes", name: "Number of boxes", type: "number_integer" },
  {
    key: "courier_company",
    name: "Courier company",
    type: "list.single_line_text_field",
    validations: [
      {
        name: "choices",
        value: JSON.stringify([
          "FLIWAYLINEHAUL",
          "FLIWAYMIDSIZE",
          "NZP",
          "NZP_AGE_RESTRICTED",
          "CASTLE",
          "TGE",
          "M2H",
          "MAINFREIGHT",
        ]),
      },
    ],
  },
  { key: "hiab_required", name: "HIAB required", type: "boolean" },
  { key: "units_per_box", name: "Units per box", type: "number_integer" },
  {
  key: "box_dimensions",
  name: "Box dimensions (JSON)",
  type: "json",
},
  // Per-product surcharge metafields removed — surcharges derived from rate rows
] as const;

export const freightMetafieldNamespace = "containerdoor_freight";

export function formatEnumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function toMoney(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : "0.00";
}

export function parseBoolean(value: FormDataEntryValue | null) {
  return value === "on" || value === "true" || value === "1";
}

export function parseOptionalInt(value: FormDataEntryValue | null) {
  if (value === null || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseDecimalString(value: FormDataEntryValue | null) {
  const parsed = Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

//  only for CSV import to preserve full precision
export function parseDecimalStringFull(value: string | undefined) {
  const parsed = Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? String(parsed) : "0";
}

// ─── Shipping-line code helpers ──────────────────────────────────────────────

export const freightServicePrefixes = [
  "standard_delivery::",
  "depot_delivery::",
  "customer_pickup::",
] as const;

export function isFreightShippingCode(code?: string): boolean {
  if (!code) return false;
  return freightServicePrefixes.some((prefix) => code.startsWith(prefix));
}

export function extractCarrierFromShippingCode(code?: string): string {
  if (!code) return "";
  const parts = code.split("::");
  if (parts.length < 2) return "";
  const carriers = parts[1]?.split(",") ?? [];
  return carriers[0]?.trim() ?? "";
}

export type FreightLineItem = {
  variantId: string;
  title?: string;
  sku?: string;
  company: string;
  companyLabel: string;
  boxes: number;
};

export type FreightBreakdown = {
  carriers: string;
  packageCount: string;
  lineItems: FreightLineItem[];
};

/**
 * Parse a shipping-line code into structured freight data.
 *
 * Code format:
 *   serviceType::CARRIERS::Nboxes::::::variantId:COMPANYxBoxes|variantId:COMPANYxBoxes
 */
export function parseFreightCode(
  code: string | undefined,
  lineItems?: Array<{ variant_id?: number; title?: string; sku?: string }>,
): FreightBreakdown | null {
  if (!code) return null;
  if (!isFreightShippingCode(code)) return null;

  const segments = code.split("::");
  const carriers = segments[1];
  const packageCount = segments[2];
  const lineItemsRaw = segments[4];
  if (!carriers || !lineItemsRaw) return null;

  const titleByVariant = new Map<string, string>();
  const skuByVariant = new Map<string, string>();
  for (const li of lineItems ?? []) {
    if (li.variant_id != null) {
      if (li.title) titleByVariant.set(String(li.variant_id), li.title);
      if (li.sku) skuByVariant.set(String(li.variant_id), li.sku);
    }
  }

  const items = lineItemsRaw.split("|").map((part) => {
    const [variantId, rest] = part.split(":");
    const [company, boxesStr] = (rest ?? "").split("x");
    return {
      variantId,
      title: titleByVariant.get(variantId),
      sku: skuByVariant.get(variantId) ?? "",
      company: company ?? "",
      companyLabel: companyLabels[company ?? ""] ?? company ?? "",
      boxes: Number(boxesStr ?? 0),
    };
  });

  return { carriers, packageCount, lineItems: items };
}

export function extractFreightProperties(
  properties: Array<{ name?: string; value?: string }>,
) {
  const map = Object.fromEntries(
    properties
      .filter((p) => p.name)
      .map((p) => [String(p.name), String(p.value ?? "")]),
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