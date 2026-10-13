/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Launch: Shopify refunds → OMS log → one Cin7 Credit Note per line order.
 * Does not cancel OMS lines or amend Cin7 Sales Orders.
 */
import prisma from "../db.server";
import { createCin7CreditNote, fetchCin7SalesOrderBrief, isCin7SalesOrderOpen, syncCin7DeliveryAddress } from "./cin7.server";
import { logActivity } from "./communication-log.server";
import { getShippingAddress, type OrderPayload } from "./order-webhook.server";
import { isLinkedCin7Id, resolveCin7SalesOrderId } from "./cin7-adapter.server";
import { normalizePaymentStatus } from "./freight-orders.server";

const LOG = "[RefundCin7]";
const LOG_ADDR = "[AddressCin7]";

function log(tag: string, message: string, extra?: unknown) {
  if (extra !== undefined) console.log(`${tag} ${message}`, extra);
  else console.log(`${tag} ${message}`);
}

/** Full webhook JSON in console (capped) so refund/email fields are visible. */
export function logWebhookPayload(tag: string, topic: string, payload: unknown) {
  try {
    const text = JSON.stringify(payload, null, 2);
    const max = 80_000;
    console.log(`${tag} webhook payload topic=${topic} bytes=${text.length}`);
    console.log(`${tag} webhook payload JSON ${text.length > max ? `${text.slice(0, max)}\n… [truncated ${text.length - max} bytes]` : text}`);
  } catch (error) {
    console.error(`${tag} webhook payload stringify failed`, error);
  }
}

function money(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0;
}

function refundMethod(refund: any): string {
  const txs = Array.isArray(refund?.transactions) ? refund.transactions : [];
  const kinds = txs.map((t: any) => String(t?.gateway || t?.payment_details?.credit_card_company || t?.kind || "").toLowerCase());
  if (kinds.some((g: string) => g.includes("store_credit") || g.includes("gift_card") || g.includes("shop_cash"))) {
    return "store_credit";
  }
  if (txs.length) return String(txs[0]?.gateway || "original_payment");
  return "shopify_refund";
}

function shippingRefundAmount(refund: any): number {
  const lines = refund?.refund_shipping_lines ?? refund?.refund_shippings ?? [];
  if (Array.isArray(lines) && lines.length) {
    return lines.reduce((sum: number, row: any) => sum + money(row?.subtotal ?? row?.amount ?? row?.shipping_line?.price), 0);
  }
  const adjs = Array.isArray(refund?.order_adjustments) ? refund.order_adjustments : [];
  return adjs
    .filter((a: any) => String(a?.kind || "").toLowerCase().includes("shipping"))
    .reduce((sum: number, a: any) => sum + Math.abs(money(a?.amount)) + Math.abs(money(a?.tax_amount)), 0);
}

export async function processShopifyRefundsToCin7(shop: string, order: OrderPayload) {
  const orderId = String(order.id ?? "");
  const orderName = String(order.name ?? "");
  const refunds = Array.isArray((order as any).refunds) ? (order as any).refunds : [];
  log(LOG, `start shop=${shop} orderId=${orderId} name=${orderName} refundCount=${refunds.length}`);
  if (!orderId) {
    console.warn(`${LOG} SKIP no orderId`);
    return { processed: 0, created: 0, skipped: 0, failed: 0 };
  }
  if (!refunds.length) {
    log(LOG, `SKIP no refunds on payload orderId=${orderId} name=${orderName}`);
    return { processed: 0, created: 0, skipped: 0, failed: 0 };
  }

  const ops = await prisma.orderLineItemOperationalData.findMany({
    where: { shop, orderId },
    select: {
      variantId: true,
      cin7SalesOrderId: true,
      productTitle: true,
    },
  });
  const indexRows = await prisma.orderLineItemIndex.findMany({
    where: { shop, orderId },
    select: { variantId: true, letterSuffix: true, sku: true, amount: true, company: true, email: true },
  });
  const idxByVariant = new Map(indexRows.map((r) => [r.variantId, r]));
  const bundleRows = await prisma.bundleComponent.findMany({
    where: { shop, orderId },
    select: { componentVariantId: true, parentVariantId: true, parentSku: true },
  });
  const parentByComponent = new Map(
    bundleRows.map((b) => [String(b.componentVariantId), String(b.parentVariantId)]),
  );
  log(LOG, `bundle maps=${parentByComponent.size} parentVariants=${[...new Set(parentByComponent.values())].join(",") || "(none)"}`);
  const soBrief = new Map<string, Awaited<ReturnType<typeof fetchCin7SalesOrderBrief>>>();
  const snap = await prisma.orderSnapshot.findUnique({
    where: { shop_orderId: { shop, orderId } },
    select: { email: true, financialStatus: true },
  });
  const shopifyEmail = String(
    order.email || snap?.email || indexRows.find((r) => r.email)?.email || "",
  ).trim();
  log(LOG, `customer email=${shopifyEmail || "(none)"} omsLines=${ops.length}`);
  let processed = 0;
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const refund of refunds) {
    const shopifyRefundId = String(refund?.id ?? "").trim();
    if (!shopifyRefundId) {
      console.warn(`${LOG} SKIP refund missing id orderId=${orderId}`, { keys: Object.keys(refund || {}) });
      continue;
    }
    processed++;

    const rlis: any[] = Array.isArray(refund?.refund_line_items) ? refund.refund_line_items : [];
    const method = refundMethod(refund);
    const shipAmt = shippingRefundAmount(refund);
    log(
      LOG,
      `refund shopifyRefundId=${shopifyRefundId} method=${method} lineItems=${rlis.length} shippingRefund=${shipAmt} note=${String(refund?.note || "")}`,
    );

    type Slice = {
      variantId: string;
      qty: number;
      productAmount: number;
      freightShare: number;
      sku: string;
      title: string;
      letter: string;
      salesOrderId: string;
    };
    const slices: Slice[] = [];
    const sliceByVariant = new Map<string, Slice>();

    for (const rli of rlis) {
      const rawVariantId = String(rli?.line_item?.variant_id ?? rli?.variant_id ?? "").trim();
      if (!rawVariantId) continue;
      const parentVariantId = parentByComponent.get(rawVariantId) || "";
      const variantId = idxByVariant.get(rawVariantId)?.letterSuffix
        ? rawVariantId
        : parentVariantId || rawVariantId;
      const lineOps = ops.find((o) => o.variantId === variantId);
      const idx = idxByVariant.get(variantId);
      if (!idx?.letterSuffix) {
        log(
          LOG,
          `SKIP not OMS line order variantId=${rawVariantId} sku=${rli?.line_item?.sku || ""} parent=${parentVariantId || "(none)"}`,
        );
        continue;
      }
      if (parentVariantId && parentVariantId !== rawVariantId) {
        log(
          LOG,
          `map bundle component sku=${rli?.line_item?.sku || ""} variantId=${rawVariantId} → parent ${variantId} letter=${idx.letterSuffix}`,
        );
      }
      const link = await resolveCin7SalesOrderId({ shop, orderId, variantId });
      const salesOrderId = isLinkedCin7Id(link.salesOrderId) ? link.salesOrderId : "";
      const productAmount = money(rli?.subtotal) + money(rli?.total_tax);
      const qty = parentVariantId && parentVariantId !== rawVariantId
        ? 1
        : Math.max(Number(rli?.quantity) || 1, 1);
      log(
        LOG,
        `line slice variantId=${variantId} letter=${idx.letterSuffix} sku=${idx.sku || rli?.line_item?.sku || ""} qty=${qty} productAmount=${productAmount} cin7SO=${salesOrderId || "NONE"} source=${link.source}`,
      );
      const prev = sliceByVariant.get(variantId);
      if (prev) {
        if (!(parentVariantId && parentVariantId !== rawVariantId)) prev.qty += qty;
        prev.productAmount = money(prev.productAmount + productAmount);
        continue;
      }
      const slice: Slice = {
        variantId,
        qty,
        productAmount,
        freightShare: 0,
        sku: String(idx.sku || "REFUND"),
        title: String(lineOps?.productTitle || idx.sku || "Refund"),
        letter: idx.letterSuffix,
        salesOrderId,
      };
      sliceByVariant.set(variantId, slice);
      slices.push(slice);
    }

    if (!slices.length && shipAmt > 0) {
      for (const lineOps of ops) {
        const idx = idxByVariant.get(lineOps.variantId);
        const link = await resolveCin7SalesOrderId({ shop, orderId, variantId: lineOps.variantId });
        const salesOrderId = isLinkedCin7Id(link.salesOrderId) ? link.salesOrderId : "";
        if (!salesOrderId) continue;
        slices.push({
          variantId: lineOps.variantId,
          qty: 1,
          productAmount: 0,
          freightShare: 0,
          sku: idx?.sku || "FREIGHT",
          title: "Freight refund",
          letter: idx?.letterSuffix || "",
          salesOrderId,
        });
      }
    }

    if (shipAmt > 0 && slices.length) {
      const each = Math.round((shipAmt / slices.length) * 10000) / 10000;
      slices.forEach((s, i) => {
        s.freightShare = i === slices.length - 1 ? money(shipAmt - each * (slices.length - 1)) : each;
      });
    }

    for (const slice of slices) {
      const amount = money(slice.productAmount + slice.freightShare);
      log(
        LOG,
        `create? ${orderName}${slice.letter} refund=${shopifyRefundId} amount=${amount} freight=${slice.freightShare} cin7SO=${slice.salesOrderId || "NONE"}`,
      );
      if (amount <= 0) {
        log(LOG, `SKIP amount<=0 ${orderName}${slice.letter} refund=${shopifyRefundId}`);
        skipped++;
        continue;
      }
      const existing = await prisma.cin7CreditNoteSync.findUnique({
        where: {
          shop_shopifyRefundId_variantId: { shop, shopifyRefundId, variantId: slice.variantId },
        },
      });
      if (existing?.status === "sent" && existing.cin7CreditNoteId) {
        log(
          LOG,
          `SKIP already sent ${orderName}${slice.letter} refund=${shopifyRefundId} cin7CreditNoteId=${existing.cin7CreditNoteId} code=${existing.cin7CreditNoteCode}`,
        );
        skipped++;
        continue;
      }
      if (!slice.salesOrderId) {
        console.error(`${LOG} FAIL no Cin7 SO linked ${orderName}${slice.letter} variantId=${slice.variantId} refund=${shopifyRefundId}`);
        await upsertCreditSync({
          shop,
          orderId,
          variantId: slice.variantId,
          letterSuffix: slice.letter,
          shopifyRefundId,
          shopifyOrderName: orderName,
          amount,
          freightAmount: slice.freightShare,
          refundMethod: method,
          cin7SalesOrderId: "",
          status: "failed",
          lastError: "No Cin7 Sales Order linked to this line",
          payloadJson: JSON.stringify({ shopifyRefundId, slice }),
        });
        failed++;
        continue;
      }

      const freightOnly = slice.productAmount <= 0 && slice.freightShare > 0;
      const unitPrice = freightOnly
        ? slice.freightShare
        : slice.qty > 0
          ? money(slice.productAmount / slice.qty)
          : amount;
      if (!soBrief.has(slice.salesOrderId)) {
        const brief = await fetchCin7SalesOrderBrief(slice.salesOrderId);
        soBrief.set(slice.salesOrderId, brief);
      }
      const so = soBrief.get(slice.salesOrderId);
      const salesReference = String(so?.reference || so?.code || `${orderName}${slice.letter}`).trim();
      const memberId = Number(so?.memberId || 0) || 0;
      const memberEmail = String(so?.memberEmail || shopifyEmail).trim();
      log(
        LOG,
        `Cin7 SO ${slice.salesOrderId} salesReference=${salesReference} memberId=${memberId} email=${memberEmail || "(none)"}`,
      );
      const comments = [
        `Shopify refund ${shopifyRefundId} for ${orderName}${slice.letter}`,
        `Original Cin7 SO ${slice.salesOrderId} ref ${salesReference}`,
        `Method: ${method}`,
        slice.freightShare ? `Freight refund ${slice.freightShare}` : "",
      ]
        .filter(Boolean)
        .join(" | ");

      const cn = await createCin7CreditNote({
        salesOrderId: Number(slice.salesOrderId) || 0,
        salesReference,
        memberId: memberId || undefined,
        memberEmail: memberEmail || undefined,
        customerOrderNo: orderName,
        reference: `${orderName}${slice.letter}-R${shopifyRefundId}`.slice(0, 50),
        internalComments: comments,
        freightTotal: freightOnly ? undefined : slice.freightShare || undefined,
        freightDescription: !freightOnly && slice.freightShare ? "Shopify freight refund" : undefined,
        lineItems: [
          {
            code: slice.sku || "REFUND",
            name: slice.title,
            qty: slice.qty,
            unitPrice,
          },
        ],
      });

      const status = cn.ok ? "sent" : "failed";
      await upsertCreditSync({
        shop,
        orderId,
        variantId: slice.variantId,
        letterSuffix: slice.letter,
        shopifyRefundId,
        shopifyOrderName: orderName,
        amount,
        freightAmount: slice.freightShare,
        refundMethod: method,
        cin7SalesOrderId: slice.salesOrderId,
        cin7CreditNoteId: cn.id ? String(cn.id) : existing?.cin7CreditNoteId || "",
        cin7CreditNoteCode: cn.code || existing?.cin7CreditNoteCode || "",
        status,
        lastError: cn.ok ? "" : cn.error || "Credit note failed",
        payloadJson: JSON.stringify({ shopifyRefundId, slice, cin7: cn }),
      });

      await logActivity({
        shop,
        orderId,
        variantId: slice.variantId,
        activityType: "cin7_note",
        channel: "cin7",
        sentBy: "shopify-refund-sync",
        subject: cn.ok ? "Cin7 Credit Note created" : "Cin7 Credit Note failed",
        body: cn.ok
          ? `Shopify refund ${shopifyRefundId} → Cin7 Credit Note ${cn.code || cn.id} (left open) for ${orderName}${slice.letter}. Amount ${amount} (${method}). Cin7 Sales Order not amended.`
          : `Shopify refund ${shopifyRefundId} Credit Note failed: ${cn.error}`,
        deliveryStatus: cn.ok ? "synced" : "failed",
        metadata: {
          shopifyRefundId,
          amount,
          method,
          cin7CreditNoteId: cn.id,
          cin7SalesOrderId: slice.salesOrderId,
        },
      });

      if (cn.ok) {
        created++;
        const pay = normalizePaymentStatus(
          String((order as any).financial_status || snap?.financialStatus || "partially_refunded"),
        ) || "Partial";
        await prisma.orderLineItemOperationalData.updateMany({
          where: { shop, orderId, variantId: slice.variantId },
          data: { paymentStatus: pay },
        });
        log(
          LOG,
          `OK Credit Note created ${orderName}${slice.letter} refund=${shopifyRefundId} cin7Id=${cn.id} code=${cn.code} amount=${amount} method=${method} SO left open paymentStatus=${pay} customerStatus unchanged`,
        );
      } else {
        failed++;
        console.error(
          `${LOG} FAIL Credit Note ${orderName}${slice.letter} refund=${shopifyRefundId} cin7SO=${slice.salesOrderId} error=${cn.error}`,
        );
      }
    }
  }

  log(LOG, `done orderId=${orderId} name=${orderName} processed=${processed} created=${created} skipped=${skipped} failed=${failed}`);
  return { processed, created, skipped, failed };
}

async function upsertCreditSync(data: {
  shop: string;
  orderId: string;
  variantId: string;
  letterSuffix: string;
  shopifyRefundId: string;
  shopifyOrderName: string;
  amount: number;
  freightAmount: number;
  refundMethod: string;
  cin7SalesOrderId: string;
  cin7CreditNoteId?: string;
  cin7CreditNoteCode?: string;
  status: string;
  lastError: string;
  payloadJson: string;
}) {
  await prisma.cin7CreditNoteSync.upsert({
    where: {
      shop_shopifyRefundId_variantId: {
        shop: data.shop,
        shopifyRefundId: data.shopifyRefundId,
        variantId: data.variantId,
      },
    },
    create: {
      shop: data.shop,
      orderId: data.orderId,
      variantId: data.variantId,
      letterSuffix: data.letterSuffix,
      shopifyRefundId: data.shopifyRefundId,
      shopifyOrderName: data.shopifyOrderName,
      amount: data.amount,
      freightAmount: data.freightAmount,
      refundMethod: data.refundMethod,
      cin7SalesOrderId: data.cin7SalesOrderId,
      cin7CreditNoteId: data.cin7CreditNoteId || "",
      cin7CreditNoteCode: data.cin7CreditNoteCode || "",
      status: data.status,
      lastError: data.lastError,
      payloadJson: data.payloadJson,
    },
    update: {
      amount: data.amount,
      freightAmount: data.freightAmount,
      refundMethod: data.refundMethod,
      cin7SalesOrderId: data.cin7SalesOrderId,
      ...(data.cin7CreditNoteId ? { cin7CreditNoteId: data.cin7CreditNoteId } : {}),
      ...(data.cin7CreditNoteCode ? { cin7CreditNoteCode: data.cin7CreditNoteCode } : {}),
      status: data.status,
      lastError: data.lastError,
      payloadJson: data.payloadJson,
    },
  });
}

export async function processShopifyAddressToCin7(shop: string, order: OrderPayload) {
  const orderId = String(order.id ?? "");
  const orderName = String(order.name ?? "");
  if (!orderId) {
    console.warn(`${LOG_ADDR} SKIP no orderId`);
    return { updated: 0, skipped: 0, failed: 0 };
  }
  const shipping = getShippingAddress(order);
  const ops = await prisma.orderLineItemOperationalData.findMany({
    where: { shop, orderId },
    select: { variantId: true, cin7SalesOrderId: true },
  });
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const seen = new Set<string>();
  log(
    LOG_ADDR,
    `start shop=${shop} orderId=${orderId} name=${orderName} lines=${ops.length} city=${shipping.city || ""} zip=${shipping.zip || ""}`,
  );
  for (const line of ops) {
    const link = await resolveCin7SalesOrderId({ shop, orderId, variantId: line.variantId });
    const salesOrderId = isLinkedCin7Id(link.salesOrderId) ? link.salesOrderId : "";
    if (!salesOrderId) {
      log(LOG_ADDR, `SKIP no Cin7 SO variantId=${line.variantId}`);
      continue;
    }
    if (seen.has(salesOrderId)) continue;
    seen.add(salesOrderId);
    const open = await isCin7SalesOrderOpen(salesOrderId);
    log(LOG_ADDR, `SO ${salesOrderId} open=${open} variantId=${line.variantId}`);
    if (!open) {
      log(LOG_ADDR, `SKIP Cin7 SO not open (completed/dispatched) id=${salesOrderId}`);
      skipped++;
      continue;
    }
    const brief = await fetchCin7SalesOrderBrief(salesOrderId);
    const sameAddr =
      String(brief?.deliveryAddress1 || "").toLowerCase() === String(shipping.address1 || "").trim().toLowerCase() &&
      String(brief?.deliveryCity || "").toLowerCase() === String(shipping.city || "").trim().toLowerCase() &&
      String(brief?.deliveryPostalCode || "").replace(/\s/g, "") === String(shipping.zip || "").replace(/\s/g, "");
    if (sameAddr) {
      log(LOG_ADDR, `SKIP address unchanged cin7SO=${salesOrderId}`);
      skipped++;
      continue;
    }
    const r = await syncCin7DeliveryAddress({
      salesOrderId,
      firstName: shipping.first_name,
      lastName: shipping.last_name,
      address1: shipping.address1,
      address2: shipping.address2,
      city: shipping.city,
      state: shipping.province,
      postalCode: shipping.zip,
      country: shipping.country || shipping.country_code,
    });
    if (r.updated) {
      updated++;
      log(LOG_ADDR, `OK address updated cin7SO=${salesOrderId} ${shipping.address1 || ""} ${shipping.city || ""}`);
    } else if (r.error) {
      failed++;
      console.error(`${LOG_ADDR} FAIL cin7SO=${salesOrderId} error=${r.error}`);
      await logActivity({
        shop,
        orderId,
        variantId: line.variantId,
        activityType: "address_update",
        channel: "cin7",
        sentBy: "shopify-address-sync",
        subject: "Cin7 address sync failed",
        body: r.error,
        deliveryStatus: "failed",
      });
    } else {
      skipped++;
      log(LOG_ADDR, `SKIP no change cin7SO=${salesOrderId}`);
    }
  }
  log(LOG_ADDR, `done orderId=${orderId} updated=${updated} skipped=${skipped} failed=${failed}`);
  return { updated, skipped, failed };
}

export async function processShopifyLaunchCin7Sync(shop: string, order: OrderPayload) {
  const orderId = String(order.id ?? "");
  log(LOG, `launch sync begin shop=${shop} orderId=${orderId} name=${String(order.name ?? "")}`);
  const refunds = await processShopifyRefundsToCin7(shop, order);
  const address = await processShopifyAddressToCin7(shop, order);
  log(LOG, `launch sync end orderId=${orderId}`, { refunds, address });
  return { refunds, address };
}
