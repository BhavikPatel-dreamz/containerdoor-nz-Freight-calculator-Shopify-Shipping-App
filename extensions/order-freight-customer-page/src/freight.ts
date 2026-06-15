// Freight payload shape stored on the order metafield
// `containerdoor_freight.freight_data` by the orders/create webhook.
// The customer-account ShippingLine object does NOT expose `code`, so the
// freight breakdown is read from this metafield instead.
// Keep in sync with the webhook writer (app/routes/webhooks.orders.create.tsx)
// and extensions/order-freight-block/src/freight.ts (FreightMetafieldPayload).

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

export type FreightLineItem = {
  variantId: string;
  title?: string;
  company: string;
  companyLabel: string;
  boxes: number;
};

export type FreightPayload = {
  carriers: string;
  packageCount: string;
  lineItems: FreightLineItem[];
};

export function parseFreightMetafield(value: string | null | undefined): FreightPayload | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(value) as Partial<FreightPayload>;
    const lineItems = (raw.lineItems ?? []).map((li) => ({
      variantId: String(li.variantId ?? ""),
      title: li.title,
      company: String(li.company ?? ""),
      companyLabel: li.companyLabel ?? companyLabels[String(li.company ?? "")] ?? String(li.company ?? ""),
      boxes: Number(li.boxes ?? 0),
    }));
    return {
      carriers: String(raw.carriers ?? ""),
      packageCount: String(raw.packageCount ?? ""),
      lineItems,
    };
  } catch {
    return null;
  }
}
