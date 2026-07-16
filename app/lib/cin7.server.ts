/* eslint-disable @typescript-eslint/no-explicit-any */
const CIN7_API_URL = process.env.CIN7_SYNC_URL || `${process.env.CIN7_BASE_URL}/SalesOrders`;

// Simple debug helper for terminal logging
const debug = (namespace: string, message: string, data?: any) => {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = `[${timestamp}] ${namespace}`;
  if (data !== undefined) {
    console.log(`${prefix}: ${message}`, data);
  } else {
    console.log(`${prefix}: ${message}`);
  }
};

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
  billingAddress1?: string;
  billingCity?: string;
  billingState?: string;
  billingPostalCode?: string;
  billingCountry?: string;
  billingFirstName?: string;
  billingLastName?: string;
  billingCompany?: string;
  logisticsCarrier?: string;
  currencyCode?: string;
  customerOrderNo?: string;
  internalComments?: string;
  lineItems: Cin7LineItem[];
};

export async function syncCin7EstimatedDispatchDate(input: {
  salesOrderId?: string;
  eddDate?: string;
  reference?: string;
}): Promise<{ exists: boolean; updated: boolean; salesOrderId?: string; error?: string }> {
  const salesOrderId = input.salesOrderId?.trim();
  if (!salesOrderId) {
    debug("Cin7", "syncCin7EstimatedDispatchDate: SKIP - no salesOrderId");
    return { exists: false, updated: false };
  }

  if (!CIN7_API_URL) {
    debug("Cin7", "syncCin7EstimatedDispatchDate: SKIP - no CIN7 base URL configured");
    return { exists: true, updated: false, salesOrderId };
  }

  try {
    const url = `${CIN7_API_URL}/${encodeURIComponent(salesOrderId)}`;
    
    // Cin7 expects EstimatedDeliveryDate in ISO 8601 format with time
    let eddFormatted = "";
    if (input.eddDate) {
      try {
        // Parse YYYY-MM-DD and convert to ISO 8601 format with midnight UTC
        eddFormatted = `${input.eddDate}T00:00:00Z`;
      } catch {
        eddFormatted = input.eddDate; // fallback to original format
      }
    }
    
    const body = [
      {
        id: parseInt(salesOrderId, 10) || 0,
        estimatedDeliveryDate: eddFormatted,
      },
    ];
    debug("Cin7", `PUT request to ${url}`);
    debug("Cin7", "PUT body:", body);
    
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: getCin7AuthHeader(),
      },
      body: JSON.stringify(body),
    });

    const responseText = await res.text();
    debug("Cin7", `PUT response status: ${res.status}`);
    debug("Cin7", `PUT response body: ${responseText}`);

    let json: any;
    try {
      json = responseText ? JSON.parse(responseText) : null;
    } catch {
      json = null;
    }

    // Cin7 returns 200 but may have success: false in the response
    const result = Array.isArray(json) ? json[0] : json;
    
    if (result?.errors && result.errors.length > 0) {
      debug("Cin7", `PUT failed with errors:`, result.errors);
      return { exists: false, updated: false, salesOrderId, error: result.errors[0] };
    }

    if (result?.success === false) {
      debug("Cin7", `PUT success false: salesOrderId=${salesOrderId} may not exist in Cin7`);
      return { exists: false, updated: false, salesOrderId, error: "Cin7 returned success: false" };
    }

    if (res.ok) {
      debug("Cin7", `PUT success (200): EDD updated for salesOrderId=${salesOrderId}`);
      return { exists: true, updated: true, salesOrderId };
    } else {
      debug("Cin7", `PUT error (${res.status}): ${responseText}`);
      return { exists: true, updated: false, salesOrderId, error: responseText };
    }
  } catch (error) {
    debug("Cin7", "PUT request failed:", error);
    return {
      exists: true,
      updated: false,
      salesOrderId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

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
      billingFirstName: input.billingFirstName ?? input.firstName ?? "",
      billingLastName: input.billingLastName ?? input.lastName ?? "",
      billingCompany: input.billingCompany ?? input.company ?? "",
      billingAddress1: input.billingAddress1 ?? input.deliveryAddress1 ?? "",
      billingCity: input.billingCity ?? input.deliveryCity ?? "",
      billingState: input.billingState ?? input.deliveryState ?? "",
      billingPostalCode: input.billingPostalCode ?? input.deliveryPostalCode ?? "",
      billingCountry: input.billingCountry ?? input.deliveryCountry ?? "",
      logisticsCarrier: input.logisticsCarrier ?? "",
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

  debug("Cin7", "POST SalesOrder", body);

  const res = await fetch(CIN7_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: getCin7AuthHeader(),
    },
    body: JSON.stringify(body),
  });

  const json: any = await res.json().catch(() => null);
  debug("Cin7", "POST SalesOrder response:", json);

  if (!res.ok) {
    throw new Error(`Cin7 API error ${res.status}: ${JSON.stringify(json)}`);
  }

  const result = Array.isArray(json) ? json[0] : null;
  if (!result || !result.success) {
    throw new Error(`Cin7 SalesOrder creation failed: ${JSON.stringify(result?.errors ?? json)}`);
  }

  return { id: result.id, code: result.code };
}
