/* eslint-disable @typescript-eslint/no-explicit-any */
const CIN7_API_URL = process.env.CIN7_SYNC_URL || `${process.env.CIN7_BASE_URL}/SalesOrders`;

export function getCin7AuthHeader(): string {
  const username = process.env.CIN7_USERNAME;
  const token = process.env.CIN7_SYNC_TOKEN;
  if (!username || !token) {
    throw new Error("Missing CIN7_USERNAME or CIN7_SYNC_TOKEN env vars");
  }
  return "Basic " + Buffer.from(`${username}:${token}`).toString("base64");
}

export type Cin7LineItem = {
  code: string; // Product SKU — Cin7 matches an existing product by this
  name?: string;
  qty: number;
  unitPrice?: number;
};

export type Cin7SalesOrderInput = {
  reference: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  email?: string;
  phone?: string;
  deliveryAddress1?: string;
  deliveryCity?: string;
  deliveryState?: string;
  deliveryPostalCode?: string;
  deliveryCountry?: string;
  currencyCode?: string;
  customerOrderNo?: string;
  internalComments?: string;
  lineItems: Cin7LineItem[];
};

export async function createCin7SalesOrder(
  input: Cin7SalesOrderInput,
): Promise<{ id: number; code: string }> {
  const body = [
    {
      reference: input.reference,
      firstName: input.firstName ?? "",
      lastName: input.lastName ?? "",
      company: input.company ?? "",
      memberEmail: input.email ?? "",
      phone: input.phone ?? "",
      deliveryFirstName: input.firstName ?? "",
      deliveryLastName: input.lastName ?? "",
      deliveryCompany: input.company ?? "",
      deliveryAddress1: input.deliveryAddress1 ?? "",
      deliveryCity: input.deliveryCity ?? "",
      deliveryState: input.deliveryState ?? "",
      deliveryPostalCode: input.deliveryPostalCode ?? "",
      deliveryCountry: input.deliveryCountry ?? "",
      ...(input.currencyCode ? { currencyCode: input.currencyCode } : {}),
      customerOrderNo: input.customerOrderNo ?? "",
      internalComments: input.internalComments ?? "",
      lineItems: input.lineItems.map((li, idx) => ({
        code: li.code,
        name: li.name ?? "",
        qty: li.qty,
        unitPrice: li.unitPrice ?? 0,
        sort: (idx + 1) * 10,
      })),
    },
  ];

  console.log("[Cin7 API] request:", JSON.stringify(body));

  const res = await fetch(CIN7_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: getCin7AuthHeader(),
    },
    body: JSON.stringify(body),
  });

  const json: any = await res.json().catch(() => null);
  console.log("[Cin7 API] response:", JSON.stringify(json));

  if (!res.ok) {
    throw new Error(`Cin7 API error ${res.status}: ${JSON.stringify(json)}`);
  }

  const result = Array.isArray(json) ? json[0] : null;
  if (!result || !result.success) {
    throw new Error(`Cin7 SalesOrder creation failed: ${JSON.stringify(result?.errors ?? json)}`);
  }

  return { id: result.id, code: result.code };
}
