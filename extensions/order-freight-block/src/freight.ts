// Shared freight helpers for the order-freight admin extension.
// NOTE: extensions build in isolation and cannot import from `app/`, so the
// carrier labels and the shipping-line `code` parser are duplicated here.
// Keep in sync with app/lib/freight.ts (companyLabels) and
// app/routes/app.freight-orders.tsx (buildFreightOrderRow parser).

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

export const FREIGHT_SERVICE_PREFIXES = [
  "standard_delivery::",
  "depot_delivery::",
  "customer_pickup::",
];

export type FreightLineItem = {
  variantId: string;
  company: string;
  companyLabel: string;
  boxes: number;
};

export type FreightBreakdown = {
  carriers: string;
  packageCount: string;
  lineItems: FreightLineItem[];
};

// service_code format:
//   standard_delivery::TGE,MAINFREIGHT::4boxes::::::variantId:COMPANYxBoxes|variantId:COMPANYxBoxes
// (segments 3-5 are empty; line items live at index 6)
export function parseFreightCode(code: string | null | undefined): FreightBreakdown | null {
  if (!code) return null;
  if (!FREIGHT_SERVICE_PREFIXES.some((prefix) => code.startsWith(prefix))) return null;

  const segments = code.split("::");
  const carriers = segments[1];
  const packageCount = segments[2];
  const lineItemsRaw = segments[6];
  if (!carriers || !lineItemsRaw) return null;

  const lineItems: FreightLineItem[] = lineItemsRaw.split("|").map((part) => {
    const [variantId, rest] = part.split(":");
    const [company, boxesStr] = (rest ?? "").split("x");
    return {
      variantId,
      company: company ?? "",
      companyLabel: companyLabels[company ?? ""] ?? company ?? "",
      boxes: Number(boxesStr ?? 0),
    };
  });

  return { carriers, packageCount, lineItems };
}

// Build the JSON payload stored on the order metafield so the
// customer-account extension (which cannot read shippingLine.code) can render
// the same breakdown. Keep this shape in sync with the customer extension.
export type FreightMetafieldPayload = {
  carriers: string;
  packageCount: string;
  lineItems: Array<{
    variantId: string;
    title?: string;
    company: string;
    companyLabel: string;
    boxes: number;
  }>;
};
