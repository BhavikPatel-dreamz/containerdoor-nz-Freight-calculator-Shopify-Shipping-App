/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from "../db.server";
import { isFreightShippingCode, parseFreightCode, freightServicePrefixes } from "./freight";
import { createMondayItem, buildMondayPulseName, buildMondayRowFromOms } from "./monday.server";
import { createCin7SalesOrder } from "./cin7.server";
import {
  buildCin7CustomerOrderNo,
  buildCin7SalesOrderReference,
  getCin7SoStrategy,
  isLinkedCin7Id,
  saveCin7LineLink,
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
    console.error(`[OrderSnapshot][${orderId}] FAILED`, error);
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
          ...(selectedDepot
            ? {
                shippingAddress1: selectedDepot.address1 ?? "",
                shippingCity: selectedDepot.city ?? "",
                shippingZip: selectedDepot.zip ?? "",
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

    // Ensure order-ops row exists (claim marker for UI "has Cin7 work").
    await prisma.orderOperationalData.upsert({
      where: { shop_orderId: { shop, orderId } },
      create: { shop, orderId, cin7SalesOrderId: "pending" },
      update: {},
    });

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
