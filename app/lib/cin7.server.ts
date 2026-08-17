/* eslint-disable @typescript-eslint/no-explicit-any */
const CIN7_API_URL = process.env.CIN7_SYNC_URL || `${process.env.CIN7_BASE_URL}/SalesOrders`;

/**
 * Cin7 Omni update endpoint:
 * - GET single order:    /v1/SalesOrders/{id}
 * - PUT updates (array): /v1/SalesOrders
 */
function getCin7UpdateUrl(): string {
  // If env already points to /SalesOrders/{id}, normalize to /SalesOrders.
  return String(CIN7_API_URL || "").replace(/\/\d+$/, "");
}

function getCin7OrderUrl(salesOrderId: string): string {
  return `${getCin7UpdateUrl()}/${encodeURIComponent(salesOrderId)}`;
}

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
  freightTotal?: number;
  freightDescription?: string;
  discountTotal?: number;
  discountDescription?: string;
  taxRate?: number;
  taxStatus?: "Incl" | "Excl" | "Exempt";
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
    const url = getCin7UpdateUrl();
    
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
      return {
        exists: false,
        updated: false,
        salesOrderId,
        error: `Cin7 returned success:false for EDD update (salesOrderId=${salesOrderId})`,
      };
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

export async function syncCin7TrackingNumber(input: {
  salesOrderId?: string;
  trackingNumber?: string;
  reference?: string;
}): Promise<{ exists: boolean; updated: boolean; salesOrderId?: string; error?: string }> {
  const salesOrderId = input.salesOrderId?.trim();
  if (!salesOrderId) {
    debug("Cin7", "syncCin7TrackingNumber: SKIP - no salesOrderId");
    return { exists: false, updated: false };
  }

  if (!CIN7_API_URL) {
    debug("Cin7", "syncCin7TrackingNumber: SKIP - no CIN7 base URL configured");
    return { exists: true, updated: false, salesOrderId };
  }

  try {
    const url = getCin7UpdateUrl();
    const body = [{
      id: parseInt(salesOrderId, 10) || 0,
      trackingCode: input.trackingNumber ?? "",
    }];

    debug("Cin7", `PUT tracking request to ${url}`);
    debug("Cin7", "PUT tracking body:", body);

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: getCin7AuthHeader(),
      },
      body: JSON.stringify(body),
    });

    const responseText = await res.text();
    debug("Cin7", `PUT tracking response status: ${res.status}`);
    debug("Cin7", `PUT tracking response body: ${responseText}`);

    let json: any;
    try {
      json = responseText ? JSON.parse(responseText) : null;
    } catch {
      json = null;
    }

    const result = Array.isArray(json) ? json[0] : json;

    if (result?.errors && result.errors.length > 0) {
      debug("Cin7", `PUT tracking failed with errors:`, result.errors);
      return { exists: false, updated: false, salesOrderId, error: result.errors[0] };
    }

    if (result?.success === false) {
      debug("Cin7", `PUT tracking success false: salesOrderId=${salesOrderId} may not exist in Cin7`);
      return {
        exists: false,
        updated: false,
        salesOrderId,
        error: `Cin7 returned success:false for tracking update (salesOrderId=${salesOrderId})`,
      };
    }

    if (res.ok) {
      debug("Cin7", `PUT tracking success (200): tracking updated for salesOrderId=${salesOrderId}`);
      return { exists: true, updated: true, salesOrderId };
    }

    debug("Cin7", `PUT tracking error (${res.status}): ${responseText}`);
    return { exists: true, updated: false, salesOrderId, error: responseText };
  } catch (error) {
    debug("Cin7", "PUT tracking request failed:", error);
    return {
      exists: true,
      updated: false,
      salesOrderId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type Cin7OrderSnapshot = {
  id: string;
  trackingCode: string;
  estimatedDeliveryDate: string;
  logisticsCarrier: string;
  status: string;
  isVoid: boolean;
  cancellationDate: string | null;
  lineItems: { code: string; qty: number }[];
};

export async function findCin7SalesOrderByReference(reference: string): Promise<{ id: string; code?: string } | null> {
  const ref = String(reference ?? "").trim();
  if (!ref || ref === "pending" || ref === "duplicate" || !CIN7_API_URL) return null;

  try {
    const url = getCin7UpdateUrl();
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: getCin7AuthHeader() },
    });
    if (!res.ok) {
      debug("Cin7", `GET SalesOrders list failed (${res.status}) for reference=${ref}`);
      return null;
    }

    const json: any = await res.json();
    const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.items) ? json.items : [];
    const matched = rows.find((row: any) => String(row?.reference ?? row?.Reference ?? "").trim() === ref);
    if (!matched) return null;

    return {
      id: String(matched.id ?? matched.Id ?? ""),
      code: String(matched.code ?? matched.Code ?? ""),
    };
  } catch (error) {
    debug("Cin7", "GET SalesOrders list by reference failed:", error);
    return null;
  }
}

export async function fetchCin7SalesOrder(salesOrderId: string): Promise<Cin7OrderSnapshot | null> {
  const id = salesOrderId?.trim();
  if (!id || ["pending", "duplicate"].includes(id) || !CIN7_API_URL) return null;

  try {
    const url = getCin7OrderUrl(id);
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: getCin7AuthHeader() },
    });
    if (!res.ok) {
      debug("Cin7", `GET SalesOrder failed (${res.status}) for id=${id}`);
      return null;
    }
    const json: any = await res.json();

    // TEMP: log the raw shape once so we can confirm the real field name/value for void status
    debug("Cin7", `GET SalesOrder raw response for id=${id}:`, json);

    const status = String(json.status ?? json.Status ?? json.orderStatus ?? "").toUpperCase();

    return {
      id: String(json.id ?? id),
      trackingCode: json.trackingCode ?? "",
      estimatedDeliveryDate: json.estimatedDeliveryDate ?? "",
      logisticsCarrier: json.logisticsCarrier ?? "",
      status,
      isVoid: Boolean(json.isVoid),
      cancellationDate: json.cancellationDate ?? null,
      lineItems: (json.lineItems ?? []).map((li: any) => ({ code: li.code ?? "", qty: li.qty ?? 0 })),
    };
  } catch (error) {
    debug("Cin7", "GET SalesOrder failed:", error);
    return null;
  }
}

/** Fetch the Cin7-computed order total (post their own tax rules) for a Sales Order. */
export async function fetchCin7SalesOrderTotal(salesOrderId: string): Promise<number | null> {
  const id = salesOrderId?.trim();
  if (!id || id === "pending" || !CIN7_API_URL) return null;
  try {
    const url = getCin7OrderUrl(id);
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: getCin7AuthHeader() },
    });
    if (!res.ok) {
      debug("Cin7", `GET SalesOrder (for total) failed (${res.status}) for id=${id}`);
      return null;
    }
    const json: any = await res.json();

    // Confirmed via testing: Cin7's `total` field on this endpoint is in the
    // ACCOUNT'S HOME/BASE CURRENCY, not the order's own currency — e.g. a
    // 230.00 INR order came back as total=4.1186 (NZD base). The order also
    // carries its own currency conversion rate, so convert home->order
    // currency before using this as a payment amount, or Paid % is wrong.
    const homeTotal = Number(json.total ?? json.Total ?? json.orderTotal ?? json.grandTotal ?? 0);
    const currencyRate = Number(
      json.currencyRate ?? json.exchangeRate ?? json.CurrencyRate ?? json.ExchangeRate ?? 1,
    );
    const rate = Number.isFinite(currencyRate) && currencyRate > 0 ? currencyRate : 1;
    const orderCurrencyTotal = homeTotal * rate;

    debug(
      "Cin7",
      `GET SalesOrder total for id=${id}: home=${homeTotal} rate=${rate} orderCurrencyTotal=${orderCurrencyTotal}`,
    );
    // Full raw response logged so the currencyRate field name can be verified
    // against Cin7's actual response shape if this ever drifts.
    debug("Cin7", `GET SalesOrder (for total) raw response for id=${id}:`, json);

    return Number.isFinite(orderCurrencyTotal) && orderCurrencyTotal > 0 ? orderCurrencyTotal : null;
  } catch (error) {
    debug("Cin7", "GET SalesOrder (for total) failed:", error);
    return null;
  }
}

export function diffCin7Fields(
  item: { trackingNumber?: string; eddDate?: string; company?: string },
  cin7: Cin7OrderSnapshot,
): string[] {
  const mismatches: string[] = [];

  const wantTracking = (item.trackingNumber ?? "").trim();
  if (wantTracking && wantTracking !== (cin7.trackingCode ?? "").trim()) {
    mismatches.push("trackingNumber");
  }

  const wantEdd = item.eddDate ? item.eddDate.slice(0, 10) : "";
  const haveEdd = cin7.estimatedDeliveryDate ? cin7.estimatedDeliveryDate.slice(0, 10) : "";
  if (wantEdd && wantEdd !== haveEdd) {
    mismatches.push("eddDate");
  }

  const wantCarrier = (item.company ?? "").trim().toUpperCase();
  const haveCarrier = (cin7.logisticsCarrier ?? "").trim().toUpperCase();
  if (wantCarrier && wantCarrier !== haveCarrier) {
    mismatches.push("carrier");
  }

  return mismatches;
}

export async function syncCin7Carrier(input: {
  salesOrderId?: string;
  carrier?: string;
}): Promise<{ exists: boolean; updated: boolean; salesOrderId?: string; error?: string }> {
  const salesOrderId = input.salesOrderId?.trim();
  if (!salesOrderId) return { exists: false, updated: false };
  if (!CIN7_API_URL) return { exists: true, updated: false, salesOrderId };

  try {
    const url = getCin7UpdateUrl();
    const body = [{ id: parseInt(salesOrderId, 10) || 0, logisticsCarrier: input.carrier ?? "" }];
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: getCin7AuthHeader() },
      body: JSON.stringify(body),
    });
    const responseText = await res.text();
    let json: any;
    try { json = responseText ? JSON.parse(responseText) : null; } catch { json = null; }
    const result = Array.isArray(json) ? json[0] : json;

    if (result?.errors?.length) return { exists: false, updated: false, salesOrderId, error: result.errors[0] };
    if (result?.success === false) {
      return {
        exists: false,
        updated: false,
        salesOrderId,
        error: `Cin7 returned success:false for carrier update (salesOrderId=${salesOrderId})`,
      };
    }
    if (res.ok) return { exists: true, updated: true, salesOrderId };
    return { exists: true, updated: false, salesOrderId, error: responseText };
  } catch (error) {
    return { exists: true, updated: false, salesOrderId, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function syncCin7DeliveryAddress(input: {
  salesOrderId?: string;
  firstName?: string;
  lastName?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}): Promise<{ exists: boolean; updated: boolean; salesOrderId?: string; error?: string }> {
  const salesOrderId = input.salesOrderId?.trim();
  if (!salesOrderId) {
    debug("Cin7", "syncCin7DeliveryAddress: SKIP - no salesOrderId");
    return { exists: false, updated: false };
  }
  if (!CIN7_API_URL) {
    debug("Cin7", "syncCin7DeliveryAddress: SKIP - no CIN7 base URL configured");
    return { exists: true, updated: false, salesOrderId };
  }

  try {
    const url = getCin7UpdateUrl();
    const body = [
      {
        id: parseInt(salesOrderId, 10) || 0,
        deliveryFirstName: input.firstName ?? "",
        deliveryLastName: input.lastName ?? "",
        deliveryAddress1: input.address1 ?? "",
        deliveryAddress2: input.address2 ?? "",
        deliveryCity: input.city ?? "",
        deliveryState: input.state ?? "",
        deliveryPostalCode: input.postalCode ?? "",
        deliveryCountry: input.country ?? "",
      },
    ];

    debug("Cin7", `PUT address request to ${url}`);
    debug("Cin7", "PUT address body:", body);

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: getCin7AuthHeader(),
      },
      body: JSON.stringify(body),
    });

    const responseText = await res.text();
    debug("Cin7", `PUT address response status: ${res.status}`);
    debug("Cin7", `PUT address response body: ${responseText}`);

    let json: any;
    try {
      json = responseText ? JSON.parse(responseText) : null;
    } catch {
      json = null;
    }

    const result = Array.isArray(json) ? json[0] : json;

    if (result?.errors && result.errors.length > 0) {
      debug("Cin7", `PUT address failed with errors:`, result.errors);
      return { exists: false, updated: false, salesOrderId, error: result.errors[0] };
    }

    if (result?.success === false) {
      debug("Cin7", `PUT address success false: salesOrderId=${salesOrderId} may not exist in Cin7`);
      return {
        exists: false,
        updated: false,
        salesOrderId,
        error: `Cin7 returned success:false for address update (salesOrderId=${salesOrderId})`,
      };
    }

    if (res.ok) {
      debug("Cin7", `PUT address success (200): address updated for salesOrderId=${salesOrderId}`);
      return { exists: true, updated: true, salesOrderId };
    }

    debug("Cin7", `PUT address error (${res.status}): ${responseText}`);
    return { exists: true, updated: false, salesOrderId, error: responseText };
  } catch (error) {
    debug("Cin7", "PUT address request failed:", error);
    return {
      exists: true,
      updated: false,
      salesOrderId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function appendCin7InternalComment(input: {
  salesOrderId?: string;
  comment?: string;
}): Promise<{ exists: boolean; updated: boolean; salesOrderId?: string; error?: string }> {
  const salesOrderId = input.salesOrderId?.trim();
  const comment = input.comment?.trim();
  if (!salesOrderId || !comment) return { exists: false, updated: false };
  if (!CIN7_API_URL) return { exists: true, updated: false, salesOrderId };

  try {
    // Fetch existing internal comments so we append instead of overwriting
    const getUrl = getCin7OrderUrl(salesOrderId);
    const getRes = await fetch(getUrl, { method: "GET", headers: { Authorization: getCin7AuthHeader() } });
    const existingJson: any = getRes.ok ? await getRes.json().catch(() => null) : null;
    const existingComments = existingJson?.internalComments ?? "";
    const nextComments = existingComments ? `${existingComments}\n${comment}` : comment;

    const body = [{ id: parseInt(salesOrderId, 10) || 0, internalComments: nextComments }];
    const res = await fetch(getCin7UpdateUrl(), {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: getCin7AuthHeader() },
      body: JSON.stringify(body),
    });
    const responseText = await res.text();
    let json: any;
    try { json = responseText ? JSON.parse(responseText) : null; } catch { json = null; }
    const result = Array.isArray(json) ? json[0] : json;

    if (result?.errors?.length) return { exists: false, updated: false, salesOrderId, error: result.errors[0] };
    if (result?.success === false) {
      return {
        exists: false,
        updated: false,
        salesOrderId,
        error: `Cin7 returned success:false for comment update (salesOrderId=${salesOrderId})`,
      };
    }
    if (res.ok) return { exists: true, updated: true, salesOrderId };
    return { exists: true, updated: false, salesOrderId, error: responseText };
  } catch (error) {
    return { exists: true, updated: false, salesOrderId, error: error instanceof Error ? error.message : String(error) };
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
      ...(input.freightTotal !== undefined ? { freightTotal: input.freightTotal } : {}),
      ...(input.freightDescription ? { freightDescription: input.freightDescription } : {}),
      ...(input.discountTotal !== undefined ? { discountTotal: input.discountTotal } : {}),
      ...(input.discountDescription ? { discountDescription: input.discountDescription } : {}),
      ...(input.taxRate !== undefined ? { taxRate: input.taxRate } : {}),
      ...(input.taxStatus ? { taxStatus: input.taxStatus } : {}),
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
    const errors = result?.errors ?? json;
    const err = new Error(`Cin7 SalesOrder creation failed: ${JSON.stringify(errors)}`) as Error & { isDuplicate?: boolean };
    err.isDuplicate = /already exists/i.test(JSON.stringify(errors));
    throw err;
  }

  return { id: result.id, code: result.code };
}

function getCin7PaymentsUrl(): string {
  // Same base as SalesOrders, swap the resource segment.
  return getCin7UpdateUrl().replace(/\/SalesOrders$/i, "/Payments");
}

export type Cin7PaymentInput = {
  orderId: number;
  amount: number;
  method?: string;
  paymentDate?: string; // ISO date; defaults to now
  isAuthorized?: boolean;
  transactionRef?: string;
  comments?: string;
};

/**
 * Create a Payment against a Cin7 Sales Order so Cin7's Total Paid / Total
 * Owing reflects what was actually paid on the Shopify order (0–100% range).
 * Best-effort: caller should treat failure as non-fatal (SO already exists).
 */
export async function createCin7Payment(
  input: Cin7PaymentInput,
): Promise<{ ok: boolean; id?: number; error?: string }> {
  if (!input.orderId || !input.amount) {
    debug("Cin7", "createCin7Payment: SKIP - missing orderId or amount");
    return { ok: false, error: "Missing orderId or amount" };
  }

  const body = [
    {
      orderId: input.orderId,
      amount: input.amount,
      method: input.method ?? "Shopify",
      isAuthorized: input.isAuthorized ?? true,
      paymentDate: input.paymentDate ?? new Date().toISOString(),
      ...(input.transactionRef ? { transactionRef: input.transactionRef } : {}),
      ...(input.comments ? { comments: input.comments } : {}),
    },
  ];

  debug("Cin7", "POST Payment", body);

  try {
    const res = await fetch(getCin7PaymentsUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: getCin7AuthHeader(),
      },
      body: JSON.stringify(body),
    });

    const json: any = await res.json().catch(() => null);
    debug("Cin7", "POST Payment response:", json);

    if (!res.ok) {
      return { ok: false, error: `Cin7 API error ${res.status}: ${JSON.stringify(json)}` };
    }

    const result = Array.isArray(json) ? json[0] : null;
    if (!result || !result.success) {
      return { ok: false, error: `Cin7 Payment creation failed: ${JSON.stringify(result?.errors ?? json)}` };
    }

    return { ok: true, id: result.id };
  } catch (error) {
    debug("Cin7", "POST Payment request failed:", error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
