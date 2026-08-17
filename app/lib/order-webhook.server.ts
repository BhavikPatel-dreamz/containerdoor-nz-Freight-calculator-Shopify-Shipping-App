/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import type { Prisma } from "@prisma/client";
import { isFreightShippingCode, parseFreightCode, freightServicePrefixes } from "./freight";
import { createMondayItem, buildMondayPulseName, buildMondayRowFromOms, resolveMondayCarrierLabel, resolveMondayCustomerStatusLabel, resolveMondayPaymentLabel, resolveMondayWarehouseStatusLabel, resolveMondayStatusColor } from "./monday.server";
import { createCin7SalesOrder, createCin7Payment, fetchCin7SalesOrderTotal } from "./cin7.server";
import { getAppSettings } from "../models/freight.server";
import { reindexOrderById } from "./line-index.server";
import {
  buildCin7CustomerOrderNo,
  buildCin7SalesOrderReference,
  getCin7SoStrategy,
  isLinkedCin7Id,
  saveCin7LineLink,
  resolveCin7SalesOrderId,
} from "./cin7-adapter.server";

// ─── Order webhook payload type ──────────────────────────────────────────────

export type OrderPayload = {
  id?: number;
  name?: string;
  note_attributes?: Array<{ name?: string; value?: string }>;
  created_at?: string;
  currency?: string;
  total_price?: string;
  presentment_currency?: string;
  current_total_price?: string;
  current_total_price_set?: {
    presentment_money?: { amount?: string; currency_code?: string };
  };
  shipping_address?: {
    first_name?: string;
    last_name?: string;
    city?: string;
    zip?: string;
    province?: string;
    address1?: string;
    address2?: string;
    country?: string;
    country_code?: string;
    phone?: string;
    company?: string;
  };
  billing_address?: {
    first_name?: string;
    last_name?: string;
    company?: string;
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    zip?: string;
    country?: string;
    country_code?: string;
    phone?: string;
  };
  phone?: string;
  email?: string;
  customer?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
  };
  total_discounts?: string | number;
  discount_codes?: Array<{ code?: string }>;
  tax_lines?: Array<{ rate?: string | number }>;
  taxes_included?: boolean;
  shipping_lines?: Array<{ title?: string; code?: string; price?: string | number }>;
  line_items?: Array<{
    id?: number;
    variant_id?: number;
    product_id?: number;
    variant_title?: string;
    title?: string;
    sku?: string;
    vendor?: string;
    quantity?: number;
    grams?: number;
    price?: string | number;
    price_set?: { presentment_money?: { amount?: string; currency_code?: string } };
    properties?: Array<{ name?: string; value?: string }>;
  }>;
};

// ─── Address helpers ─────────────────────────────────────────────────────────

export async function enqueueOrderWebhookJob(
  shop: string,
  topic: string,
  webhookId: string,
  order: OrderPayload,
) {
  const existing = await prisma.shopifyWebhookJob.findUnique({
    where: { shop_webhookId: { shop, webhookId } },
  });

  if (existing) {
    return existing;
  }

  // Diagnostic: record key payment-related fields at enqueue time so we can
  // compare against what the worker later reads. Remove these logs after
  // diagnosis. Do NOT log customer-sensitive fields.
  try {
    console.log(
      `[WebhookEnqueue] shop=${shop} webhookId=${webhookId} orderId=${String(order.id ?? "")} financial_status=${String((order as any).financial_status ?? "")} current_total_price=${String((order as any).current_total_price ?? "")} total_price=${String((order as any).total_price ?? "")}`,
    );
  } catch (e) {
    // swallow any logging error
  }

  try {
    return await prisma.shopifyWebhookJob.upsert({
      where: { shop_webhookId: { shop, webhookId } },
      update: {
        payload: order as unknown as Prisma.InputJsonValue,
        eventTopic: topic,
        orderId: String(order.id ?? ""),
        status: "PENDING",
        attempts: 0,
        maxAttempts: Number(process.env.ORDER_WEBHOOK_MAX_RETRIES || "5"),
        error: null,
      },
      create: {
        shop,
        eventTopic: topic,
        webhookId,
        orderId: String(order.id ?? ""),
        payload: order as unknown as Prisma.InputJsonValue,
        status: "PENDING",
        attempts: 0,
        maxAttempts: Number(process.env.ORDER_WEBHOOK_MAX_RETRIES || "5"),
        error: null,
      },
    });
  } catch (error: any) {
    if (error?.code === "P2002") {
      return prisma.shopifyWebhookJob.findUnique({
        where: { shop_webhookId: { shop, webhookId } },
      });
    }
    throw error;
  }
}

/**
 * Attempt payments for an existing order only (payment-only flow).
 * Idempotent per operational line using `OrderLineItemOperationalData.paymentStatus`.
 */
export async function attemptCreatePaymentsForOrder(shop: string, order: OrderPayload) {
  const orderId = String(order.id);
  // If the webhook payload is partial (some shops send minimal update payloads),
  // fall back to the most recent saved OrderSnapshot so payment detection can
  // use consistent fields. Do not change business rules here — snapshot is
  // only used as a best-effort supplement when fields are missing.
  if (!((order as any).financial_status) || ((order as any).current_total_price === undefined && (order as any).total_price === undefined)) {
    try {
      const snap = await prisma.orderSnapshot.findUnique({ where: { shop_orderId: { shop, orderId } } });
      if (snap) {
        // Merge snapshot fields into webhook payload for ratio calculation only
        (order as any).financial_status = (order as any).financial_status || String(snap.financialStatus || "");
        (order as any).current_total_price = (order as any).current_total_price ?? String(snap.totalPrice ?? "0");
        (order as any).total_price = (order as any).total_price ?? String(snap.totalPrice ?? "0");
        (order as any).current_subtotal_price = (order as any).current_subtotal_price ?? String(snap.totalPrice ?? "0");
        (order as any).subtotal_price = (order as any).subtotal_price ?? String(snap.totalPrice ?? "0");
        console.log(`[Cin7PaymentRetry] orderId=${orderId} using saved OrderSnapshot for missing webhook fields financial_status=${String((order as any).financial_status)} current_total_price=${String((order as any).current_total_price)}`);
      }
    } catch (e) {
      console.error(`[Cin7PaymentRetry] failed to read OrderSnapshot for order ${orderId}:`, e);
    }
  }

  const paidRatio = resolveOrderPaidRatio(order);
  // Diagnostic log for payment retry attempts
  try {
    console.log(
      `[Cin7PaymentRetry] orderId=${orderId} financial_status=${String((order as any).financial_status ?? "")} current_total_price=${String((order as any).current_total_price ?? "")} total_price=${String((order as any).total_price ?? "")} paidRatio=${paidRatio}`,
    );
  } catch (e) {}

  if (!orderId || paidRatio <= 0) {
    console.log(`[Cin7Payment] Order ${orderId} not paid yet; payment deferred`);
    return;
  }

  const opsRows = await prisma.orderLineItemOperationalData.findMany({
    where: { shop, orderId },
  });

  for (const ops of opsRows) {
    let soId = String(ops.cin7SalesOrderId || "");
    // If the operational line isn't linked, attempt to resolve via adapter
    if (!isLinkedCin7Id(soId)) {
      try {
        const resolved = await resolveCin7SalesOrderId({ shop, orderId, variantId: ops.variantId });
        if (resolved.salesOrderId) {
          soId = resolved.salesOrderId;
          console.log(`[Cin7PaymentRetry] found existing Cin7 SalesOrder id=${soId} source=${resolved.source}`);
          // Mirror link back onto the ops row so future retries are faster
          await prisma.orderLineItemOperationalData.update({ where: { id: ops.id }, data: { cin7SalesOrderId: soId } }).catch(() => {});
        }
      } catch (e) {
        console.error(`[Cin7PaymentRetry] error resolving Cin7 SO for order ${orderId} variant ${ops.variantId}:`, e);
      }
    }

    if (!isLinkedCin7Id(soId)) {
      console.log(`[Cin7PaymentRetry] orderId=${orderId} variant=${ops.variantId} no linked Cin7 SO found; skipping`);
      continue;
    }
    if (String(ops.paymentStatus || "").toLowerCase() === "paid") {
      console.log(`[Cin7Payment] Payment already exists for order ${orderId} variant ${ops.variantId}; skipping`);
      continue;
    }

    try {
      const cin7Total = await fetchCin7SalesOrderTotal(soId);
      if (!cin7Total || Number(cin7Total) <= 0) {
        console.log(`[Cin7Payment] Cin7 total not available for SO ${soId}; skipping`);
        continue;
      }

      const linePaidAmount = Math.round(Number(cin7Total) * paidRatio * 100) / 100;
      console.log(`[Cin7PaymentRetry] orderId=${orderId} variant=${ops.variantId} calculated payment amount=${linePaidAmount} using cin7Total=${cin7Total} paidRatio=${paidRatio}`);
      if (linePaidAmount <= 0) {
        console.log(`[Cin7Payment] Order ${orderId} variant ${ops.variantId} nothing to pay; deferred`);
        continue;
      }

      console.log(`[Cin7PaymentRetry] creating payment for order ${orderId} variant ${ops.variantId} SO ${soId} amount=${linePaidAmount}`);
      const paymentResult = await createCin7Payment({
        orderId: Number(soId),
        amount: linePaidAmount,
        comments: `Auto-paid from Shopify order ${order.name ?? orderId} variant ${ops.variantId}`,
      });

      if (paymentResult.ok) {
        console.log(`[Cin7Payment] Payment created for order ${orderId} variant ${ops.variantId} SO ${soId}`);
        try {
          await prisma.orderLineItemOperationalData.update({
            where: { id: ops.id },
            data: { paymentStatus: "paid" },
          });
        } catch (e) {
          console.error(`[Cin7Payment] Failed to mark ops paid for order ${orderId} variant ${ops.variantId}`, e);
        }
      } else {
        console.error(`[Cin7Payment] Payment creation failed for order ${orderId} SO ${soId}:`, paymentResult.error);
      }
    } catch (e) {
      console.error(`[Cin7Payment] Error processing payment for order ${orderId} variant ${ops.variantId}:`, e);
    }
  }
}

export async function processQueuedOrderWebhookJobs(limit = 10) {
  console.log("[WebhookWorker] started");
  const jobs = await prisma.shopifyWebhookJob.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  console.log(`[WebhookWorker] found ${jobs.length} pending jobs`);

  const results = [] as Array<{ ok: boolean; jobId?: string; retry?: boolean; error?: string }>;

  for (const job of jobs) {
    console.log(`[WebhookWorker] processing job ${job.id} webhookId=${job.webhookId}`);
    const result = await processQueuedOrderWebhookJob(job);
    results.push(result);
    if (result.ok) console.log(`[WebhookWorker] completed job ${job.id}`);
    else console.warn(`[WebhookWorker] failed job ${job.id} error=${result.error} retry=${String(result.retry)}`);
  }

  return {
    ok: true,
    processed: results.filter((result) => result.ok).length,
    queued: jobs.length,
    results,
  };
}

async function processQueuedOrderWebhookJob(job: any) {
  const nextAttempt = job.attempts + 1;
  const maxAttempts = job.maxAttempts || Number(process.env.ORDER_WEBHOOK_MAX_RETRIES || "5");

  // Attempt an atomic claim: only proceed if we can flip status from PENDING -> PROCESSING
  const claimed = await prisma.shopifyWebhookJob.updateMany({
    where: { id: job.id, status: "PENDING" },
    data: {
      status: "PROCESSING",
      attempts: nextAttempt,
      startedAt: new Date(),
      completedAt: null,
      lastAttemptAt: new Date(),
      error: null,
    },
  });

  if (claimed.count === 0) {
    // Someone else claimed or the job is not pending anymore — skip safely.
    console.log(`[WebhookWorker] job ${job.id} already claimed or not pending, skipping`);
    return { ok: false, jobId: job.id, retry: true, error: "already claimed" };
  }

  try {
    const order = job.payload as OrderPayload;
    const { admin } = await unauthenticated.admin(job.shop);

    // Diagnostic: log the payload fields read by the worker for comparison
    try {
      console.log(
        `[WebhookWorkerRead] job=${job.id} webhookId=${String(job.webhookId ?? "")} orderId=${String(order.id ?? "")} financial_status=${String((order as any).financial_status ?? "")} current_total_price=${String((order as any).current_total_price ?? "")} total_price=${String((order as any).total_price ?? "")}`,
      );
    } catch (e) {
      // swallow logging errors
    }

    // Persist snapshot + line-items + freight + Monday using the original
    // webhook payload to avoid changing the webhook flow semantics.
    await saveOrderSnapshot(job.shop, order);
    await reindexOrderById(job.shop, String(order.id ?? job.orderId));
    await createOrderLineItemRecords(job.shop, order);
    await writeFreightMetafield(admin, order);
    await createMondayEntriesForOrder(job.shop, order);

    await createCin7EntryForOrder(job.shop, order);

    const targets = [
      {
        name: "Monday",
        url: process.env.MONDAY_SYNC_URL,
        token: process.env.MONDAY_SYNC_TOKEN,
      },
    ];

    const syncPayload = buildOrderSyncPayload(job.shop, order);
    await Promise.all(
      targets.map(async (target) => {
        if (!target.url) return;
        try {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (target.token) {
            headers.Authorization = `Bearer ${target.token}`;
          }
          const response = await fetch(target.url, {
            method: "POST",
            headers,
            body: JSON.stringify(syncPayload),
          });
          if (!response.ok) {
            console.error(`Order sync failed for ${target.name}: ${response.status}`);
          }
        } catch (error) {
          console.error(`Order sync request failed for ${target.name}`, error);
        }
      }),
    );

    await prisma.shopifyWebhookJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        error: null,
      },
    });

    return { ok: true, jobId: job.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const shouldRetry = nextAttempt < maxAttempts;

    await prisma.shopifyWebhookJob.update({
      where: { id: job.id },
      data: {
        status: shouldRetry ? "PENDING" : "FAILED",
        error: message,
        completedAt: shouldRetry ? null : new Date(),
        lastAttemptAt: new Date(),
      },
    });

    console.error(`[WebhookWorker] job ${job.id} error: ${message}`);
    return { ok: false, jobId: job.id, retry: shouldRetry, error: message };
  }
}

export function getShippingAddress(order: OrderPayload) {
  return order.shipping_address ?? {};
}

export function getBillingAddress(order: OrderPayload) {
  return order.billing_address ?? {};
}

export function getCustomer(order: OrderPayload) {
  return order.customer ?? {};
}

export function extractPhoneFromOrder(order: OrderPayload): string {
  const shipping = getShippingAddress(order);
  const billing = getBillingAddress(order);
  const customer = getCustomer(order);

  const phone = [order.phone, shipping.phone, billing.phone, customer.phone].find(
    (v) => typeof v === "string" && v.trim() !== "",
  );
  return typeof phone === "string" ? phone.trim() : "";
}

export function extractCarrierFromOrder(order: OrderPayload): string {
  const shippingLines = order.shipping_lines ?? [];
  const code = shippingLines.find((l) => l?.code)?.code ?? "";
  if (isFreightShippingCode(code)) {
    // Format: "standard_delivery::TGE,MAINFREIGHT::4boxes::..."
    const parts = code.split("::");
    const carriers = parts[1]?.split(",") ?? [];
    const first = carriers[0]?.trim() ?? "";
    if (first) return first;
  }
  return shippingLines.find((l) => l?.title)?.title ?? "";
}

/** Fraction of the order total that's actually been paid, per Shopify's financial_status. */
function resolveOrderPaidRatio(order: OrderPayload): number {
  const status = String((order as any).financial_status ?? "").toLowerCase();
  if (status === "paid") return 1;
  if (status === "partially_paid" || status === "authorized") {
    const total = Number(order.total_price ?? 0);
    const current = Number(order.current_total_price ?? total);
    if (total > 0) return Math.min(Math.max(current / total, 0), 1);
    return 0;
  }
  // pending, authorized, partially_refunded (with nothing left owed handled by "paid"), etc.
  return 0;
}

// ─── Depot child-address helper (from checkout cart attribute) ──────────────
export function extractSelectedDepotAddress(order: OrderPayload): {
  name?: string;
  address1?: string;
  city?: string;
  zip?: string;
} | null {
  const raw = (order.note_attributes ?? []).find((a) => a.name === "selected_depot_address")?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// ─── Sync payload for external services ──────────────────────────────────────

export function buildOrderSyncPayload(shop: string, order: OrderPayload) {
  return {
    shop,
    order: {
      id: order.id,
      name: order.name,
      createdAt: order.created_at,
      currency: order.currency,
      totalPrice: order.total_price,
      shippingAddress: {
        city: getShippingAddress(order).city,
        postalCode: getShippingAddress(order).zip,
        countryCode: getShippingAddress(order).country_code,
      },
      lineItems: (order.line_items ?? []).map((li) => ({
        id: li.id,
        sku: li.sku,
        quantity: li.quantity,
        grams: li.grams,
        freight: parseFreightProperties(li.properties ?? []),
      })),
    },
  };
}

// ─── Freight metafield (for customer-account extension) ──────────────────────

const FREIGHT_NAMESPACE = "containerdoor_freight";
const FREIGHT_METAFIELD_KEY = "freight_data";

export async function writeFreightMetafield(
  admin: { graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> },
  order: OrderPayload,
) {
  try {
    const freightLine = (order.shipping_lines ?? []).find((s) => isFreightShippingCode(s.code));
    const breakdown = parseFreightCode(
      freightLine?.code,
      order.line_items?.map((li) => ({
        variant_id: li.variant_id,
        title: li.title,
        sku: li.sku,
      })),
    );
    if (!breakdown) return;

    const response = await admin.graphql(
      `#graphql
      mutation SetFreightMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              ownerId: `gid://shopify/Order/${order.id}`,
              namespace: FREIGHT_NAMESPACE,
              key: FREIGHT_METAFIELD_KEY,
              type: "json",
              value: JSON.stringify(breakdown),
            },
          ],
        },
      },
    );

    const json = await response.json();
    const userErrors = json?.data?.metafieldsSet?.userErrors ?? [];
    if (userErrors.length) {
      console.error("Freight metafield write errors", userErrors);
    }
  } catch (error) {
    console.error("Failed to write freight metafield", error);
  }
}

// ─── Order snapshot (store full order data in DB) ───────────────────────────
// Saves/updates order data so the freight-orders pages can read from DB
// instead of calling the Shopify API on every page load.

export async function saveOrderSnapshot(shop: string, order: OrderPayload) {
  const orderId = String(order.id);
  const shipping = getShippingAddress(order);

  const freightLine = (order.shipping_lines ?? []).find((s) => isFreightShippingCode(s.code));
  const freightCode = freightLine?.code ?? "";
  const freightParts = freightCode.split("::");

  const lineItemsForJson = (order.line_items ?? []).map((li) => ({
    id: li.id,
    variantId: (li as any).variant_id,
    productId: li.product_id ?? null,
    variantTitle: li.variant_title ?? "",
    title: li.title,
    quantity: li.quantity,
    sku: li.sku,
    vendor: li.vendor ?? "",
    price: li.price_set?.presentment_money?.amount ?? li.price ?? "0",
  }));

  try {
    await prisma.orderSnapshot.upsert({
      where: { shop_orderId: { shop, orderId } },
      update: {
        orderName: order.name ?? "",
        email: order.email ?? "",
        phone: order.phone ?? "",
        currencyCode: order.currency ?? "NZD",
        totalPrice: order.total_price ?? "0",
        financialStatus: (order as any).financial_status ?? "",
        fulfillmentStatus: (order as any).fulfillment_status ?? "",
        shippingFirstName: shipping.first_name ?? "",
        shippingLastName: shipping.last_name ?? "",
        shippingAddress1: shipping.address1 ?? "",
        shippingAddress2: shipping.address2 ?? "",
        shippingCity: shipping.city ?? "",
        shippingProvince: shipping.province ?? "",
        shippingZip: shipping.zip ?? "",
        shippingCountry: shipping.country ?? shipping.country_code ?? "",
        carriers: freightParts[1] ?? "",
        packageCount: freightParts[2] ?? "",
        shippingTitle: freightLine?.title ?? "",
        shippingCode: freightCode,
        totalFreight: Number(freightLine?.price ?? 0),
        lineItemsJson: JSON.stringify(lineItemsForJson),
      },
      create: {
        shop,
        orderId,
        orderName: order.name ?? "",
        email: order.email ?? "",
        phone: order.phone ?? "",
        currencyCode: order.currency ?? "NZD",
        totalPrice: order.total_price ?? "0",
        financialStatus: (order as any).financial_status ?? "",
        fulfillmentStatus: (order as any).fulfillment_status ?? "",
        shippingFirstName: shipping.first_name ?? "",
        shippingLastName: shipping.last_name ?? "",
        shippingAddress1: shipping.address1 ?? "",
        shippingAddress2: shipping.address2 ?? "",
        shippingCity: shipping.city ?? "",
        shippingProvince: shipping.province ?? "",
        shippingZip: shipping.zip ?? "",
        shippingCountry: shipping.country ?? shipping.country_code ?? "",
        carriers: freightParts[1] ?? "",
        packageCount: freightParts[2] ?? "",
        shippingTitle: freightLine?.title ?? "",
        shippingCode: freightCode,
        totalFreight: Number(freightLine?.price ?? 0),
        lineItemsJson: JSON.stringify(lineItemsForJson),
      },
    });
    console.log(`[OrderSnapshot][${orderId}] Saved for shop ${shop}`);
  } catch (error) {
    const code = (error as any)?.code;
    const message = (error as any)?.message ?? "";
    if (code === "P2002" || message.includes("Unique constraint failed")) {
      console.warn(`[OrderSnapshot][${orderId}] Duplicate snapshot detected, skipping (P2002)`);
    } else {
      console.error(`[OrderSnapshot][${orderId}] FAILED`, error);
    }
  }
}

// ─── Line-item operational records ───────────────────────────────────────────
// Creates an OrderLineItemOperationalData row for EVERY line item in the order.
// This ensures all items are tracked operationally from the moment the order is placed.

export async function createOrderLineItemRecords(shop: string, order: OrderPayload) {
  const orderId = String(order.id);
  const lineItems = order.line_items ?? [];
  const selectedDepot = extractSelectedDepotAddress(order);

  // Build freight lookup so we can attach carrier info from the shipping line
  const freightLine = (order.shipping_lines ?? []).find((s) => isFreightShippingCode(s.code));
  const freightBreakdown = parseFreightCode(
    freightLine?.code,
    lineItems.map((li) => ({ variant_id: li.variant_id, title: li.title, sku: li.sku })),
  );
  const carrierByVariant = new Map<string, string>();
  if (freightBreakdown) {
    for (const li of freightBreakdown.lineItems) {
      if (li.variantId && li.company) carrierByVariant.set(li.variantId, li.company);
    }
  }

  let created = 0;
  let skipped = 0;

  for (const li of lineItems) {
    const variantId = li.variant_id != null ? String(li.variant_id) : null;
    if (!variantId) {
      skipped++;
      continue;
    }

    try {
      await prisma.orderLineItemOperationalData.create({
        data: {
          shop,
          orderId,
          variantId,
          productTitle: li.title ?? "",
          carrier: carrierByVariant.get(variantId) ?? "",
          paymentStatus: "",
          // Depot fields only — shippingAddress1/City/Zip are NOT touched here.
          // Those remain reserved for customer address overrides via order-amendments.server.ts.
          ...(selectedDepot
            ? {
                depotAddress1: selectedDepot.address1 ?? "",
                depotCity: selectedDepot.city ?? "",
                depotZip: selectedDepot.zip ?? "",
              }
            : {}),
        },
      });
      created++;
    } catch {
      // Already exists (duplicate webhook or re-played) — safe to skip
      skipped++;
    }
  }

  console.log(
    `[OrderLineItems][Webhook][${orderId}] DONE - created=${created}, skipped=${skipped}, total=${lineItems.length}`,
  );
}

// ─── Cin7 order creation ─────────────────────────────────────────────────────
// Preferred: one Cin7 Sales Order per operational freight line (CIN7_SO_STRATEGY=per_line).
// Legacy grouped mode kept behind CIN7_SO_STRATEGY=grouped — see oms-cin7-architecture.mdc.

export async function createCin7EntryForOrder(shop: string, order: OrderPayload) {
  const orderId = String(order.id);
  const strategy = getCin7SoStrategy();
  console.log(`[Cin7][Webhook][${orderId}] START strategy=${strategy} for order ${order.name}`);

  if (strategy === "per_line") {
    return createCin7EntriesPerLine(shop, order);
  }
  return createCin7EntryGroupedLegacy(shop, order);
}

async function createCin7EntriesPerLine(shop: string, order: OrderPayload) {
  const orderId = String(order.id);

  try {
    const freightLine = (order.shipping_lines ?? []).find((s) => isFreightShippingCode(s.code));
    if (!freightLine) {
      console.log(`[Cin7][Webhook][${orderId}] SKIP - no freight shipping line`);
      return;
    }

    const breakdown = parseFreightCode(
      freightLine.code,
      order.line_items?.map((li) => ({
        variant_id: li.variant_id,
        title: li.title,
        sku: li.sku,
      })),
    );
    if (!breakdown?.lineItems?.length) {
      console.log(`[Cin7][Webhook][${orderId}] SKIP - could not parse freight lines`);
      return;
    }

    const shipping = getShippingAddress(order);
    const billing = getBillingAddress(order);
    const customer = getCustomer(order);
    const customerOrderNo = buildCin7CustomerOrderNo(order.name, orderId);
    const currencyCode =
      order.current_total_price_set?.presentment_money?.currency_code ?? "NZD";

    // Freight prices already have OUR OWN GST margin baked in — calculateFreightRate
    // multiplies by settings.gstRate before the customer ever sees the price at
    // checkout. That is NOT the same as Shopify's order.tax_lines rate, which can
    // be 0/unrelated and caused a silent no-op division — Cin7 then added its own
    // 15% on top of an already-taxed number (double tax). Pull the real rate from
    // AppSettings (same value the freight calculator used, same one shown on the
    // Settings page as "GST %") instead of any hardcoded percentage.
    const appSettings = await getAppSettings(shop);
    const ourGstRate = Number((appSettings as any).gstRate ?? 15) / 100;

    // Ensure order-ops row exists (claim marker for UI "has Cin7 work").
    // Retry the upsert a few times on P2002 races (concurrent workers).
    {
      const maxRetries = 3;
      let attempt = 0;
      while (true) {
        try {
          await prisma.orderOperationalData.upsert({
            where: { shop_orderId: { shop, orderId } },
            create: { shop, orderId, cin7SalesOrderId: "pending" },
            update: {},
          });
          break;
        } catch (err) {
          const code = (err as any)?.code;
          const message = (err as any)?.message ?? "";
          if (code === "P2002" || message.includes("Unique constraint failed")) {
            attempt++;
            if (attempt > maxRetries) {
              console.warn(`[Cin7][Webhook][${orderId}] orderOperationalData upsert P2002 after ${attempt} attempts, continuing`);
              break;
            }
            const backoff = 100 * Math.pow(2, attempt - 1);
            console.warn(`[Cin7][Webhook][${orderId}] P2002 on orderOperationalData upsert attempt ${attempt}, retrying after ${backoff}ms`);
            // eslint-disable-next-line no-await-in-loop
            await new Promise((res) => setTimeout(res, backoff));
            continue;
          }
          throw err;
        }
      }
    }

    // Real freight charge for the whole order, as actually shown/charged at
    // Shopify checkout (freightLine.price) — NOT li.amount from the parsed
    // freight code, which is an internal per-carrier calc that can come back
    // as 0 for some rate types (confirmed: depot collection gave amount=0
    // even though checkout charged real freight). Split across per-line SOs
    // weighted by boxes so the sum of all line SOs' freight equals the
    // order's real total shipping charge.
    const totalFreightCharge = Number(freightLine.price ?? 0);
    const totalBoxesAcrossLines = breakdown.lineItems.reduce(
      (sum, x) => sum + (Number(x.boxes) || 0),
      0,
    );
    const validLineCount = breakdown.lineItems.filter((x) => x.variantId).length || 1;
    // Derive the order-level pre-tax total using our GST rate so we can
    // compute the freight pre-tax as: orderPreTax - sum(productTotals).
    const orderTotalInclTax = Number(
      order.current_total_price_set?.presentment_money?.amount ?? order.total_price ?? 0,
    );
    const orderTotalPreTax = Number((orderTotalInclTax / (1 + ourGstRate)) || 0);
    const productTotalsSum = (order.line_items ?? []).reduce(
      (s, li) =>
        s +
        (Number(li.price_set?.presentment_money?.amount ?? li.price ?? 0) * (Number(li.quantity ?? 1) || 1)),
      0,
    );
    let totalFreightPreTax = orderTotalPreTax - productTotalsSum;
    if (!Number.isFinite(totalFreightPreTax) || totalFreightPreTax < 0) totalFreightPreTax = 0;

    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const [idx, li] of breakdown.lineItems.entries()) {
      if (!li.variantId) {
        skipped++;
        continue;
      }

      const letterSuffix = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[idx % 26];
      const reference = buildCin7SalesOrderReference({
        orderName: order.name,
        letterSuffix,
        orderId,
        variantId: li.variantId,
      });

      let ops = await prisma.orderLineItemOperationalData.findUnique({
        where: { shop_orderId_variantId: { shop, orderId, variantId: li.variantId } },
      });
      if (!ops) {
        try {
          ops = await prisma.orderLineItemOperationalData.create({
            data: {
              shop,
              orderId,
              variantId: li.variantId,
              productTitle: li.title ?? "",
              carrier: li.company ?? "",
              cin7SalesOrderId: "pending",
            },
          });
        } catch {
          ops = await prisma.orderLineItemOperationalData.findUnique({
            where: { shop_orderId_variantId: { shop, orderId, variantId: li.variantId } },
          });
        }
      }
      if (!ops) {
        failed++;
        console.error(`[Cin7][Webhook][${orderId}] No ops row for variant ${li.variantId}`);
        continue;
      }

      if (isLinkedCin7Id(ops.cin7SalesOrderId)) {
        skipped++;
        continue;
      }

      const shopifyLine = (order.line_items ?? []).find(
        (x) => String(x.variant_id) === String(li.variantId),
      );
      const sku = String(li.sku || shopifyLine?.sku || "").trim();
      if (!sku) {
        console.log(`[Cin7][Webhook][${orderId}] SKIP line ${letterSuffix} - no SKU`);
        await prisma.orderLineItemOperationalData.update({
          where: { id: ops.id },
          data: { cin7CachedStatus: "error", cin7CachedMismatches: "SKU not found" },
        });
        skipped++;
        continue;
      }

      await prisma.orderLineItemOperationalData.update({
        where: { id: ops.id },
        data: {
          cin7SalesOrderId: "pending",
          cin7SalesOrderRef: reference,
          productTitle: li.title ?? ops.productTitle,
          carrier: li.company || ops.carrier,
        },
      });

      try {
        const qty = Number(shopifyLine?.quantity ?? 1) || 1;
        const unitPrice = Number(
          shopifyLine?.price_set?.presentment_money?.amount ?? shopifyLine?.price ?? 0,
        );
        // Compute per-line freight: split checkout total (weighted by boxes)
        // and remove our GST margin so Cin7 applies tax consistently.
        // Derive this line's share of the order-level freight (pre-tax).
        const freightRaw =
          totalBoxesAcrossLines > 0
            ? totalFreightPreTax * ((Number(li.boxes) || 0) / totalBoxesAcrossLines)
            : totalFreightPreTax / validLineCount;
        const freightFinal = Number(Number(freightRaw).toFixed(2));
        console.log(
          `[Cin7][Webhook][${orderId}] Freight calc line=${letterSuffix} variant=${li.variantId} li.amount=${Number(
            (li as any).amount ?? 0,
          )} totalFreightCharge=${totalFreightCharge} totalFreightPreTax=${totalFreightPreTax} boxes=${li.boxes} totalBoxes=${totalBoxesAcrossLines} ourGstRate=${ourGstRate} freightRaw=${freightRaw} freightFinal=${freightFinal}`,
        );

        const result = await createCin7SalesOrder({
          reference,
          firstName: shipping.first_name ?? customer.first_name ?? "",
          lastName: shipping.last_name ?? customer.last_name ?? "",
          company: shipping.company ?? "",
          email: order.email ?? customer.email ?? "",
          phone: extractPhoneFromOrder(order),
          deliveryAddress1: shipping.address1 ?? "",
          deliveryCity: shipping.city ?? "",
          deliveryState: shipping.province ?? "",
          deliveryPostalCode: shipping.zip ?? "",
          deliveryCountry: shipping.country ?? shipping.country_code ?? "",
          billingFirstName: billing.first_name ?? shipping.first_name ?? customer.first_name ?? "",
          billingLastName: billing.last_name ?? shipping.last_name ?? customer.last_name ?? "",
          billingCompany: billing.company ?? shipping.company ?? "",
          billingAddress1: billing.address1 ?? shipping.address1 ?? "",
          billingCity: billing.city ?? shipping.city ?? "",
          billingState: billing.province ?? shipping.province ?? "",
          billingPostalCode: billing.zip ?? shipping.zip ?? "",
          billingCountry:
            billing.country ?? billing.country_code ?? shipping.country ?? shipping.country_code ?? "",
          logisticsCarrier: li.company || extractCarrierFromOrder(order),
          currencyCode,
          customerOrderNo,
          internalComments: `OMS line ${letterSuffix} from Shopify ${customerOrderNo} (variant ${li.variantId})`,
          taxRate: Number(order.tax_lines?.[0]?.rate ?? 0) * 100,
          taxStatus: order.taxes_included ? "Incl" : "Excl",
          // Freight for THIS line, split from the real checkout freight
          // amount (`freightLine.price`). Attempts to weight by boxes; if
          // box counts are not available, split evenly across valid lines.
          freightTotal: freightFinal,
          freightDescription: freightLine.title || li.company || "",
          lineItems: [
            {
              code: sku,
              name: li.title ?? shopifyLine?.title ?? "",
              qty,
              unitPrice,
            },
          ],
        });

        await saveCin7LineLink({
          shop,
          orderId,
          variantId: li.variantId,
          salesOrderId: String(result.id),
          salesOrderCode: result.code || "",
          salesOrderRef: reference,
          mirrorToOrder: true,
        });
        created++;
        console.log(
          `[Cin7][Webhook][${orderId}] line ${letterSuffix} OK id=${result.id} ref=${reference}`,
        );

        // Record a Payment for this line's Cin7 SO so Cin7 shows Paid/Owing
        // reflecting the real Shopify financial status (0-100% range).
        // IMPORTANT: Cin7 applies its OWN account-level tax settings to the
        // order regardless of the taxRate we send (confirmed: we sent
        // taxRate:0 but Cin7 still added 15% GST) — so we can't compute the
        // total locally. Instead, fetch back the Cin7-computed total for this
        // SO and pay against that, so Paid always matches Cin7's own total.
        const paidRatio = resolveOrderPaidRatio(order);
        const lineSubtotal = qty * unitPrice;
        const cin7Total = await fetchCin7SalesOrderTotal(String(result.id));
        const lineTotalInclTax = cin7Total ?? lineSubtotal; // fallback if fetch fails
        const linePaidAmount = Math.round(lineTotalInclTax * paidRatio * 100) / 100;
        if (linePaidAmount > 0) {
          const paymentResult = await createCin7Payment({
            orderId: result.id,
            amount: linePaidAmount,
            comments: `Auto-paid from Shopify order ${customerOrderNo} line ${letterSuffix}`,
          });
          if (!paymentResult.ok) {
            console.error(
              `[Cin7][Webhook][${orderId}] line ${letterSuffix} Payment FAILED`,
              paymentResult.error,
            );
          } else {
            console.log(
              `[Cin7][Webhook][${orderId}] line ${letterSuffix} Payment OK id=${paymentResult.id} amount=${linePaidAmount}`,
            );
            // Mark operational line as paid to avoid duplicate payments later
            try {
              await prisma.orderLineItemOperationalData.update({
                where: { id: ops.id },
                data: { paymentStatus: "paid" },
              });
            } catch (e) {
              console.error(`[Cin7][Webhook][${orderId}] Failed to mark ops paid for variant ${li.variantId}`, e);
            }
          }
        } else {
          console.log(
            `[Cin7][Webhook][${orderId}] line ${letterSuffix} SKIP payment - nothing paid (financial_status=${String((order as any).financial_status ?? "")})`,
          );
        }
      } catch (e: any) {
        failed++;
        if (e?.isDuplicate) {
          await prisma.orderLineItemOperationalData.update({
            where: { id: ops.id },
            data: { cin7SalesOrderId: "duplicate" },
          });
        } else {
          await prisma.orderLineItemOperationalData.update({
            where: { id: ops.id },
            data: { cin7SalesOrderId: "" },
          });
        }
        console.error(`[Cin7][Webhook][${orderId}] line ${letterSuffix} FAILED`, e);
      }
    }

    console.log(
      `[Cin7][Webhook][${orderId}] DONE per_line created=${created} skipped=${skipped} failed=${failed}`,
    );
  } catch (error) {
    console.error(`[Cin7][Webhook][${orderId}] FAILED`, error);
  }
}

/** Legacy: one Cin7 SO containing all SKUs for the Shopify order. */
async function createCin7EntryGroupedLegacy(shop: string, order: OrderPayload) {
  const orderId = String(order.id);
  console.log(`[Cin7][Webhook][${orderId}] START grouped (legacy) for order ${order.name}`);

  try {
    let claimed = false;
    try {
      await prisma.orderOperationalData.create({
        data: { shop, orderId, cin7SalesOrderId: "pending" },
      });
      claimed = true;
      console.log(`[Cin7][Webhook][${orderId}] Claimed row`);
    } catch {
      console.log(`[Cin7][Webhook][${orderId}] SKIP - already claimed`);
      return;
    }
    if (!claimed) return;

    const lineItems = (order.line_items ?? [])
      .map((li) => ({
        code: li.sku ?? "",
        name: li.title ?? "",
        qty: li.quantity ?? 1,
        unitPrice: Number(li.price_set?.presentment_money?.amount ?? li.price ?? 0),
      }))
      .filter((li) => li.code);

    if (lineItems.length === 0) {
      console.log(`[Cin7][Webhook][${orderId}] SKIP - no SKUs`);
      return;
    }

    const shipping = getShippingAddress(order);
    const billing = getBillingAddress(order);
    const customer = getCustomer(order);

    const result = await createCin7SalesOrder({
      reference: `Shopify-${order.name ?? orderId}`.slice(0, 30),
      firstName: shipping.first_name ?? customer.first_name ?? "",
      lastName: shipping.last_name ?? customer.last_name ?? "",
      company: shipping.company ?? "",
      email: order.email ?? customer.email ?? "",
      phone: extractPhoneFromOrder(order),
      deliveryAddress1: shipping.address1 ?? "",
      deliveryCity: shipping.city ?? "",
      deliveryState: shipping.province ?? "",
      deliveryPostalCode: shipping.zip ?? "",
      deliveryCountry: shipping.country ?? shipping.country_code ?? "",
      billingFirstName: billing.first_name ?? shipping.first_name ?? customer.first_name ?? "",
      billingLastName: billing.last_name ?? shipping.last_name ?? customer.last_name ?? "",
      billingCompany: billing.company ?? shipping.company ?? "",
      billingAddress1: billing.address1 ?? shipping.address1 ?? "",
      billingCity: billing.city ?? shipping.city ?? "",
      billingState: billing.province ?? shipping.province ?? "",
      billingPostalCode: billing.zip ?? shipping.zip ?? "",
      billingCountry: billing.country ?? billing.country_code ?? shipping.country ?? shipping.country_code ?? "",
      logisticsCarrier: extractCarrierFromOrder(order),
      currencyCode: order.current_total_price_set?.presentment_money?.currency_code ?? "NZD",
      customerOrderNo: order.name ?? orderId,
      internalComments: `Auto-created from Shopify order ${order.name ?? orderId} (grouped legacy)`,
      freightTotal: Number(
        (order as any).shipping_lines?.[0]?.discounted_price_set?.presentment_money?.amount ??
          (order as any).current_shipping_price_set?.presentment_money?.amount ?? 0,
      ),
      freightDescription: (order as any).shipping_lines?.[0]?.title ?? "",
      discountTotal: Number(order.total_discounts ?? 0),
      discountDescription: order.discount_codes?.[0]?.code ?? "",
      taxRate: Number(order.tax_lines?.[0]?.rate ?? 0) * 100,
      taxStatus: order.taxes_included ? "Incl" : "Excl",
      lineItems,
    });

    await prisma.orderOperationalData.update({
      where: { shop_orderId: { shop, orderId } },
      data: { cin7SalesOrderId: String(result.id) },
    });

    console.log(`[Cin7][Webhook][${orderId}] SUCCESS grouped id=${result.id}, code=${result.code}`);
  } catch (error) {
    console.error(`[Cin7][Webhook][${orderId}] FAILED`, error);
  }
}

// ─── Monday.com line-item creation ───────────────────────────────────────────

export async function createMondayEntriesForOrder(shop: string, order: OrderPayload) {
  const orderId = String(order.id);
  console.log(`[Monday][Webhook][${orderId}] START for order ${order.name}`);

  try {
    const freightLine = (order.shipping_lines ?? []).find((s) => isFreightShippingCode(s.code));

    if (!freightLine) {
      console.log(`[Monday][Webhook][${orderId}] SKIP - no freight shipping line`);
      return;
    }

    const breakdown = parseFreightCode(
      freightLine.code,
      order.line_items?.map((li) => ({
        variant_id: li.variant_id,
        title: li.title,
        sku: li.sku,
      })),
    );
    if (!breakdown || !order.id) {
      console.log(`[Monday][Webhook][${orderId}] SKIP - could not parse freight code`);
      return;
    }

    const shipping = getShippingAddress(order);
    const customerName =
      [shipping.first_name, shipping.last_name].filter(Boolean).join(" ").trim() || "—";
    const email = String(order.email || "").trim();
    const phone = extractPhoneFromOrder(order);
    const address = [
      shipping.address1,
      shipping.address2,
      shipping.city,
      shipping.province,
      shipping.zip,
      shipping.country || shipping.country_code,
    ]
      .filter(Boolean)
      .join(", ");

    let createdCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const [idx, li] of breakdown.lineItems.entries()) {
      if (!li.variantId) {
        skippedCount++;
        continue;
      }

      const letterSuffix = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[idx % 26];
      const itemName = buildMondayPulseName(order.name, letterSuffix, orderId);

      // Ops row is usually already created by createOrderLineItemRecords — do NOT
      // require a fresh create (that unique-key race was skipping Monday entirely).
      let ops = await prisma.orderLineItemOperationalData.findUnique({
        where: { shop_orderId_variantId: { shop, orderId, variantId: li.variantId } },
      });
      if (!ops) {
        try {
          ops = await prisma.orderLineItemOperationalData.create({
            data: {
              shop,
              orderId,
              variantId: li.variantId,
              productTitle: li.title ?? "",
              carrier: li.company ?? "",
              mondayItemId: "pending",
            },
          });
        } catch (createErr) {
          ops = await prisma.orderLineItemOperationalData.findUnique({
            where: { shop_orderId_variantId: { shop, orderId, variantId: li.variantId } },
          });
          if (!ops) {
            failedCount++;
            console.error(
              `[Monday][Webhook][${orderId}] No ops row for variant ${li.variantId}`,
              createErr,
            );
            continue;
          }
        }
      }

      if (ops.mondayItemId && ops.mondayItemId !== "pending") {
        // Already linked — still rename pulse to #OrderLetter in case it was created with product title.
        try {
          const { renameMondayItem } = await import("./monday.server");
          await renameMondayItem(ops.mondayItemId, itemName);
          await prisma.orderLineItemOperationalData.update({
            where: { id: ops.id },
            data: { mondayItemName: itemName },
          });
        } catch (e) {
          console.error(`[Monday][Webhook][${orderId}] rename existing failed`, e);
        }
        skippedCount++;
        continue;
      }

      // Mark pending so concurrent webhooks don't double-create Monday items.
      if (ops.mondayItemId !== "pending") {
        await prisma.orderLineItemOperationalData.update({
          where: { id: ops.id },
          data: { mondayItemId: "pending", productTitle: li.title ?? ops.productTitle, carrier: li.company || ops.carrier },
        });
      }

      let mondayItemId: string;
      let mondayRowForColor: Awaited<ReturnType<typeof buildMondayRowFromOms>>["row"] | null = null;
      try {
        const { row: mondayRow } = await buildMondayRowFromOms({
          shop,
          orderId,
          variantId: li.variantId,
          ops: {
            ...ops,
            productTitle: li.title ?? ops.productTitle ?? "",
            carrier: li.company || ops.carrier || "",
          },
        });
        mondayRowForColor = mondayRow;
        mondayItemId = await createMondayItem(itemName, {
          ...mondayRow,
          lineOrderName: itemName,
          carriers: li.company || mondayRow.carriers,
          productTitle: li.title ?? mondayRow.productTitle,
          sku: li.sku || mondayRow.sku,
          boxes: li.boxes || mondayRow.boxes,
          customerName: customerName !== "—" ? customerName : mondayRow.customerName,
          email: email || mondayRow.email,
          phone: phone || mondayRow.phone,
          address: address || mondayRow.address,
        });
      } catch (err) {
        failedCount++;
        console.error(
          `[Monday][Webhook][${orderId}] FAILED createMondayItem for variant ${li.variantId}`,
          err,
        );
        // Clear pending so a later sync can retry
        await prisma.orderLineItemOperationalData
          .update({
            where: { id: ops.id },
            data: { mondayItemId: "" },
          })
          .catch(() => {});
        continue;
      }

      const carrierLabelUsed = mondayRowForColor
        ? resolveMondayCarrierLabel(li.company || mondayRowForColor.carriers, mondayRowForColor.isDepot)
        : null;
      const custLabelUsed = mondayRowForColor
        ? resolveMondayCustomerStatusLabel(mondayRowForColor.customerStatus)
        : null;
      const payLabelUsed = mondayRowForColor
        ? resolveMondayPaymentLabel(mondayRowForColor.paymentStatus)
        : null;
      const wareLabelUsed = mondayRowForColor
        ? resolveMondayWarehouseStatusLabel(mondayRowForColor.warehouseStatus)
        : null;
      const [carrierColor, customerStatusColor, paymentStatusColor, warehouseStatusColor] = await Promise.all([
        resolveMondayStatusColor("carriers", carrierLabelUsed),
        resolveMondayStatusColor("customerStatus", custLabelUsed),
        resolveMondayStatusColor("paymentStatus", payLabelUsed),
        resolveMondayStatusColor("warehouseStatus", wareLabelUsed),
      ]);

      try {
        await prisma.orderLineItemOperationalData.update({
          where: { id: ops.id },
          data: {
            mondayItemId,
            mondayItemName: itemName,
            mondayCachedStatus: "match",
            mondayCachedMismatches: "",
            productTitle: li.title ?? ops.productTitle,
            carrier: li.company || ops.carrier,
            ...(carrierColor ? { carrierColor } : {}),
            ...(customerStatusColor ? { customerStatusColor } : {}),
            ...(paymentStatusColor ? { paymentStatusColor } : {}),
            ...(warehouseStatusColor ? { warehouseStatusColor } : {}),
          },
        });
        createdCount++;
        console.log(
          `[Monday][Webhook][${orderId}] Created pulse ${itemName} → ${mondayItemId} (variant ${li.variantId})`,
        );
      } catch (dbErr) {
        failedCount++;
        console.error(
          `[Monday][Webhook][${orderId}] Monday item created (${mondayItemId}) but DB update FAILED for variant ${li.variantId}`,
          dbErr,
        );
      }
    }

    console.log(
      `[Monday][Webhook][${orderId}] DONE - created=${createdCount}, skipped=${skippedCount}, failed=${failedCount}`,
    );
  } catch (error) {
    console.error(`[Monday][Webhook][${orderId}] FATAL`, error);
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function parseFreightProperties(properties: Array<{ name?: string; value?: string }>) {
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
