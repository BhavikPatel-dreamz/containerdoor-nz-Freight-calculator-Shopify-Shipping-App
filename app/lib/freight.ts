import type { CarrierCompany, CarrierMode, CostType, ServiceType } from "@prisma/client";

export const carrierCompanies: CarrierCompany[] = [
  "FLIWAY",
  "NZP",
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

export const carrierModes: CarrierMode[] = ["AIR", "ROAD"];

export const costTypes: CostType[] = ["FIXED", "PERCENTAGE"];

export const serviceLabels: Record<ServiceType, string> = {
  STANDARD_DELIVERY: "Standard delivery",
  DEPOT_DELIVERY: "Depot delivery",
  CUSTOMER_PICKUP: "Customer pickup",
};

export const companyLabels: Record<CarrierCompany, string> = {
  FLIWAY: "Fliway",
  NZP: "NZP",
  CASTLE: "Castle",
  TGE: "Team Global Express",
  M2H: "M2H",
  MAINFREIGHT: "Mainfreight",
};

export const freightFormula = {
  marginRate: 0.1,
  gstRate: 0.15,
  homeDeliveryFees: {
    FLIWAY: 45,
    TGE: 25,
  } as Partial<Record<CarrierCompany, number>>,
  depotCollectionCompanies: ["FLIWAY", "MAINFREIGHT", "TGE"] as CarrierCompany[],

  // NEW: NZP-specific
  nzp: {
    totalVariableRate: 0.114,   // TVR = VFR (10.8%) + RUC (0.6%)
    ruralSurcharge: 4.7854,
    signatureSurcharge: 0.5662,
    ageRestrictedSurcharge: 2.2835,
    residentialSurcharge: 0,    // NZP has no residential fee
  },

  // NEW: Castle-specific
  castle: {
    totalVariableRate: 0.167,   // TVR = VFF (12.2%) + RUC (4.5%)
    residentialSurcharge: 1,    // Always applied
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
  { key: "box_length_cm", name: "Box length (cm)", type: "number_decimal" },
  { key: "box_cbm", name: "Box CBM", type: "number_decimal" },
  { key: "box_width_cm", name: "Box width (cm)", type: "number_decimal" },
  { key: "box_height_cm", name: "Box height (cm)", type: "number_decimal" },
  { key: "number_of_boxes", name: "Number of boxes", type: "number_integer" },
  { key: "weight_grams", name: "Weight (g)", type: "number_integer" },
  { key: "courier_company", name: "Courier company", type: "single_line_text_field" },
  { key: "hiab_required", name: "HIAB required", type: "boolean" },
  { key: "units_per_box", name: "Units per box", type: "number_integer" },
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
