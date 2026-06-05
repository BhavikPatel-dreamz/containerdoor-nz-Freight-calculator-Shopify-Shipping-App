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
  { key: "box_length_cm", name: "Box length (cm)", type: "single_line_text_field" },
{ key: "box_width_cm",  name: "Box width (cm)",  type: "single_line_text_field" },
{ key: "box_height_cm", name: "Box height (cm)", type: "single_line_text_field" },
  { key: "number_of_boxes", name: "Number of boxes", type: "number_integer" },
  { key: "weight_grams",  name: "Weight (g)",      type: "single_line_text_field" },
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