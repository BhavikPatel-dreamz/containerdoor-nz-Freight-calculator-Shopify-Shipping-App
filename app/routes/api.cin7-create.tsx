/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import {
  createCin7SalesOrder,
  fetchCin7SalesOrder,
  fetchCin7SalesOrderTotal,
  createCin7Payment,
  findCin7SalesOrderByReference,
} from "../lib/cin7.server";
import {
  buildCin7SalesOrderReference,
  buildCin7SalesOrderUrl,
} from "../lib/cin7-adapter.server";

type RequestPayload = {
  shop?: string;
  orderId?: string | number;
  variantId?: string;
};

function extractCarrierFromShippingCode(code?: string): string {
  if (!code) return "";
  // Format: "standard_delivery::TGE,MAINFREIGHT::4boxes::..."
  const parts = code.split("::");
  if (parts.length < 2) return "";
  // Get carriers part and extract first one
  const carriers = parts[1]?.split(",") ?? [];
  return carriers[0]?.trim() ?? "";
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const payload = (await request.json()) as RequestPayload;
    const { shop, orderId, variantId } = payload;

    if (!shop || !orderId) {
      return Response.json({ error: "Missing shop or orderId" }, { status: 400 });
    }

    const orderIdStr = String(orderId);

    const normalizedVariantId = variantId ? String(variantId).trim() : "";

    let existing: { cin7SalesOrderId: string } | null = null;
    let variantExisting: { cin7SalesOrderId: string } | null = null;

    if (normalizedVariantId) {
      variantExisting = await prisma.orderLineItemOperationalData.findUnique({
        where: { shop_orderId_variantId: { shop, orderId: orderIdStr, variantId: normalizedVariantId } },
        select: { cin7SalesOrderId: true },
      });
    }

    if (variantExisting?.cin7SalesOrderId && variantExisting.cin7SalesOrderId !== "pending") {
      const snapshot = await fetchCin7SalesOrder(variantExisting.cin7SalesOrderId);

      if (snapshot) {
        console.log(
          `[Cin7][API][${orderIdStr}] Verified variant ${normalizedVariantId} still exists in Cin7 with ID: ${variantExisting.cin7SalesOrderId}`,
        );
        return Response.json({
          ok: true,
          cin7SalesOrderId: variantExisting.cin7SalesOrderId,
          cin7SalesOrderUrl: buildCin7SalesOrderUrl(variantExisting.cin7SalesOrderId) ?? "",
        });
      }

      console.log(
        `[Cin7][API][${orderIdStr}] Variant ${normalizedVariantId} cached Cin7 ID ${variantExisting.cin7SalesOrderId} no longer exists in Cin7 — will recreate`,
      );
      await prisma.orderLineItemOperationalData.update({
        where: { shop_orderId_variantId: { shop, orderId: orderIdStr, variantId: normalizedVariantId } },
        data: { cin7SalesOrderId: "pending" },
      });
      variantExisting = { cin7SalesOrderId: "pending" };
    }

    if (!normalizedVariantId) {
      existing = await prisma.orderOperationalData.findUnique({
        where: { shop_orderId: { shop, orderId: orderIdStr } },
        select: { cin7SalesOrderId: true },
      });

      if (existing?.cin7SalesOrderId && existing.cin7SalesOrderId !== "pending") {
        const snapshot = await fetchCin7SalesOrder(existing.cin7SalesOrderId);

        if (snapshot) {
          console.log(
            `[Cin7][API][${orderIdStr}] Verified — order still exists in Cin7 with ID: ${existing.cin7SalesOrderId}`,
          );
          return Response.json({
            ok: true,
            cin7SalesOrderId: existing.cin7SalesOrderId,
            cin7SalesOrderUrl: buildCin7SalesOrderUrl(existing.cin7SalesOrderId) ?? "",
          });
        }

        console.log(
          `[Cin7][API][${orderIdStr}] Cached Cin7 ID ${existing.cin7SalesOrderId} no longer exists in Cin7 — will recreate`,
        );
        await prisma.orderOperationalData.update({
          where: { shop_orderId: { shop, orderId: orderIdStr } },
          data: { cin7SalesOrderId: "pending" },
        });
        existing = { cin7SalesOrderId: "pending" };
      }
    }

    // Fetch the order from Shopify
    const { admin } = await unauthenticated.admin(shop);
    const orderRes = await admin.graphql(
      `#graphql
        query GetOrder($id: ID!) {
          order(id: $id) {
            id
            name
            createdAt
            email
            phone
            billingAddress {
              firstName
              lastName
              company
              address1
              city
              province
              zip
              country
              countryCode
              phone
            }
            shippingAddress {
              firstName
              lastName
              company
              address1
              city
              province
              zip
              country
              countryCode
              phone
            }
            shippingLines(first: 5) {
              nodes {
                title
                code
                discountedPriceSet {
                  presentmentMoney {
                    amount
                  }
                }
              }
            }
            totalPriceSet {
              presentmentMoney {
                amount
                currencyCode
              }
            }
            totalOutstandingSet {
              presentmentMoney {
                amount
              }
            }
            totalDiscountsSet {
              presentmentMoney {
                amount
              }
            }
            discountCodes
            taxLines {
              rate
            }
            taxesIncluded
            lineItems(first: 50) {
              nodes {
                sku
                title
                quantity
                variant {
                  id
                  sku
                }
                originalUnitPriceSet {
                  presentmentMoney {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      `,
      { variables: { id: `gid://shopify/Order/${orderIdStr}` } },
    );

    const orderJson = await orderRes.json();
    if (!orderRes.ok || (orderJson as any)?.errors) {
      console.error(`[Cin7][API][${orderIdStr}] GraphQL error:`, (orderJson as any)?.errors);
      return Response.json(
        { ok: false, error: "Failed to fetch order from Shopify" },
        { status: 500 },
      );
    }

    const orderData = orderJson?.data?.order;
    if (!orderData) {
      console.error(`[Cin7][API][${orderIdStr}] Order not found in Shopify`);
      return Response.json(
        { ok: false, error: "Order not found in Shopify" },
        { status: 404 },
      );
    }

    // Build Cin7 line items (filter out items without SKU)
    const lineItems = (orderData.lineItems?.nodes ?? [])
      .map((li: any) => ({
        code: li.sku ?? li.variant?.sku ?? "",
        name: li.title ?? "",
        qty: li.quantity ?? 1,
        unitPrice: Number(li.originalUnitPriceSet?.presentmentMoney?.amount ?? 0),
        variantId: li.variant?.id ?? null,
      }))
      .filter((li: { code: any; }) => li.code);

    if (lineItems.length === 0) {
      console.log(`[Cin7][API][${orderIdStr}] SKIP - no line items with a SKU`);
      return Response.json(
        { ok: false, error: "No line items with SKU found" },
        { status: 400 },
      );
    }

    const targetLineItems = normalizedVariantId
      ? lineItems.filter((li: any) => {
          const currentId = String(li.variantId ?? "");
          return currentId === normalizedVariantId || currentId.endsWith(`/${normalizedVariantId}`) || currentId === `gid://shopify/ProductVariant/${normalizedVariantId}`;
        })
      : lineItems;

    if (normalizedVariantId && targetLineItems.length === 0) {
      console.log(`[Cin7][API][${orderIdStr}] SKIP - variant ${normalizedVariantId} not found on order`);
      return Response.json(
        { ok: false, error: "Selected variant not found on order" },
        { status: 404 },
      );
    }

    // Create or get the record safely. This is a legacy order-level row used only
    // as a compatibility fallback; never let repeated per-line clicks crash on
    // the unique `(shop, orderId)` constraint.
    if (!existing) {
      await prisma.orderOperationalData.upsert({
        where: { shop_orderId: { shop, orderId: orderIdStr } },
        create: { shop, orderId: orderIdStr, cin7SalesOrderId: "pending" },
        update: { cin7SalesOrderId: "pending" },
      });
      existing = await prisma.orderOperationalData.findUnique({
        where: { shop_orderId: { shop, orderId: orderIdStr } },
        select: { cin7SalesOrderId: true },
      });
    }

    // Create Cin7 sales order
    const shippingAddress = orderData.shippingAddress ?? {};
    const billingAddress = orderData.billingAddress ?? {};
    
    // Extract currency from Shopify presentment money or default to NZD
    const currencyCode = (orderData.lineItems?.nodes?.[0]?.originalUnitPriceSet?.presentmentMoney?.currencyCode ?? orderData.totalPriceSet?.presentmentMoney?.currencyCode ?? "NZD");
    
    // Extract carrier from first shipping line code (format: "service::CARRIER1,CARRIER2::boxes::...")
    const shippingLineCode = orderData.shippingLines?.nodes?.[0]?.code ?? "";
    const carrier = extractCarrierFromShippingCode(shippingLineCode);
    
    // Extract phone from various sources
    const phone = orderData.phone ?? shippingAddress.phone ?? billingAddress.phone ?? "";
    const freightTotal = Number(orderData.shippingLines?.nodes?.[0]?.discountedPriceSet?.presentmentMoney?.amount ?? orderData.totalPriceSet?.presentmentMoney?.amount ?? 0);
    const freightDescription = orderData.shippingLines?.nodes?.[0]?.title ?? "";
    const discountTotal = Number(orderData.totalDiscountsSet?.presentmentMoney?.amount ?? 0);
    const discountDescription = orderData.discountCodes?.[0] ?? "";
    const taxRate = Number(orderData.taxLines?.[0]?.rate ?? 0) * 100;
    const taxStatus = orderData.taxesIncluded ? "Incl" : "Excl";

    const allOrderLineItems = orderData.lineItems?.nodes ?? [];
    const targetLineIndex = normalizedVariantId
      ? allOrderLineItems.findIndex((li: any) => {
          const currentId = String(li?.variant?.id ?? "");
          return currentId === normalizedVariantId || currentId.endsWith(`/${normalizedVariantId}`) || currentId === `gid://shopify/ProductVariant/${normalizedVariantId}`;
        })
      : 0;
    const lineLetter = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.max(targetLineIndex, 0) % 26] ?? "A";
    const cin7Reference = buildCin7SalesOrderReference({
      orderName: orderData.name ?? orderIdStr,
      letterSuffix: lineLetter,
      orderId: orderIdStr,
      variantId: normalizedVariantId || undefined,
    });

    let result;
    try {
      result = await createCin7SalesOrder({
        reference: cin7Reference,
        firstName: shippingAddress.firstName ?? billingAddress.firstName ?? "",
        lastName: shippingAddress.lastName ?? billingAddress.lastName ?? "",
        company: shippingAddress.company ?? billingAddress.company ?? "",
        email: orderData.email ?? "",
        phone: phone,
        deliveryAddress1: shippingAddress.address1 ?? "",
        deliveryCity: shippingAddress.city ?? "",
        deliveryState: shippingAddress.province ?? "",
        deliveryPostalCode: shippingAddress.zip ?? "",
        deliveryCountry: shippingAddress.country ?? shippingAddress.countryCode ?? "",
        billingFirstName: billingAddress.firstName ?? "",
        billingLastName: billingAddress.lastName ?? "",
        billingCompany: billingAddress.company ?? "",
        billingAddress1: billingAddress.address1 ?? "",
        billingCity: billingAddress.city ?? "",
        billingState: billingAddress.province ?? "",
        billingPostalCode: billingAddress.zip ?? "",
        billingCountry: billingAddress.country ?? billingAddress.countryCode ?? "",
        logisticsCarrier: carrier,
        currencyCode: currencyCode,
        customerOrderNo: orderData.name ?? orderIdStr,
        internalComments: normalizedVariantId
          ? `Auto-created from Shopify order ${orderData.name ?? orderIdStr} variant ${normalizedVariantId}`
          : `Auto-created from Shopify order ${orderData.name ?? orderIdStr}`,
        freightTotal: freightTotal,
        freightDescription,
        discountTotal,
        discountDescription,
        taxRate,
        taxStatus,
        lineItems: targetLineItems.map((li: any) => ({
          code: li.code,
          name: li.name ?? "",
          qty: li.qty ?? 1,
          unitPrice: li.unitPrice ?? 0,
        })),
      });
    } catch (err) {
      if ((err as any)?.isDuplicate) {
        let knownSalesOrderId = "";

        if (normalizedVariantId) {
          const lineRow = await prisma.orderLineItemOperationalData.findUnique({
            where: { shop_orderId_variantId: { shop, orderId: orderIdStr, variantId: normalizedVariantId } },
            select: { cin7SalesOrderId: true, cin7SalesOrderRef: true },
          });
          knownSalesOrderId = String(lineRow?.cin7SalesOrderId ?? "").trim();
          if ((!knownSalesOrderId || ["pending", "duplicate"].includes(knownSalesOrderId)) && lineRow?.cin7SalesOrderRef) {
            const byRef = await findCin7SalesOrderByReference(lineRow.cin7SalesOrderRef);
            if (byRef?.id) {
              knownSalesOrderId = byRef.id;
            }
          }
        }

        if (!knownSalesOrderId) {
          const orderRow = await prisma.orderOperationalData.findUnique({
            where: { shop_orderId: { shop, orderId: orderIdStr } },
            select: { cin7SalesOrderId: true },
          });
          knownSalesOrderId = String(orderRow?.cin7SalesOrderId ?? "").trim();
        }

        if (!knownSalesOrderId || ["pending", "duplicate"].includes(knownSalesOrderId)) {
          const byRef = await findCin7SalesOrderByReference(cin7Reference);
          if (byRef?.id) {
            knownSalesOrderId = byRef.id;
          }
        }

        if (knownSalesOrderId && knownSalesOrderId !== "pending" && knownSalesOrderId !== "duplicate") {
          await prisma.orderLineItemOperationalData.upsert({
            where: { shop_orderId_variantId: { shop, orderId: orderIdStr, variantId: normalizedVariantId || "" } },
            create: {
              shop,
              orderId: orderIdStr,
              variantId: normalizedVariantId || "",
              cin7SalesOrderId: knownSalesOrderId,
              cin7SalesOrderRef: cin7Reference,
            },
            update: {
              cin7SalesOrderId: knownSalesOrderId,
              cin7SalesOrderRef: cin7Reference,
            },
          });
          console.log(`[Cin7][API][${orderIdStr}] DUPLICATE - reference already exists in Cin7; existing SO id=${knownSalesOrderId}`);
          return Response.json({
            ok: true,
            cin7SalesOrderId: knownSalesOrderId,
            cin7SalesOrderUrl: buildCin7SalesOrderUrl(knownSalesOrderId) ?? "",
            duplicate: true,
          });
        }

        if (normalizedVariantId) {
          await prisma.orderLineItemOperationalData.upsert({
            where: { shop_orderId_variantId: { shop, orderId: orderIdStr, variantId: normalizedVariantId } },
            create: { shop, orderId: orderIdStr, variantId: normalizedVariantId, cin7SalesOrderId: "duplicate" },
            update: { cin7SalesOrderId: "duplicate" },
          });
        }

        const orderRow = await prisma.orderOperationalData.findUnique({
          where: { shop_orderId: { shop, orderId: orderIdStr } },
          select: { cin7SalesOrderId: true },
        });
        const currentOrderLink = String(orderRow?.cin7SalesOrderId ?? "").trim();
        if (!currentOrderLink || currentOrderLink === "pending" || currentOrderLink === "duplicate") {
          await prisma.orderOperationalData.upsert({
            where: { shop_orderId: { shop, orderId: orderIdStr } },
            create: { shop, orderId: orderIdStr, cin7SalesOrderId: "duplicate" },
            update: { cin7SalesOrderId: "duplicate" },
          });
        }
        console.log(`[Cin7][API][${orderIdStr}] DUPLICATE - reference already exists in Cin7`);
        return Response.json(
          { ok: false, cin7Status: "error", error: err instanceof Error ? err.message : "Duplicate reference" },
          { status: 409 },
        );
      }
      throw err;
    }

    // Update the per-line record with the Cin7 ID. Keep the legacy order-level
    // field only as a first-valid-link fallback; never overwrite an existing real
    // order SO with a different line's SO ID.
    const orderRow = await prisma.orderOperationalData.findUnique({
      where: { shop_orderId: { shop, orderId: orderIdStr } },
      select: { cin7SalesOrderId: true },
    });
    const currentOrderLink = String(orderRow?.cin7SalesOrderId ?? "").trim();
    if (!currentOrderLink || currentOrderLink === "pending" || currentOrderLink === "duplicate") {
      await prisma.orderOperationalData.upsert({
        where: { shop_orderId: { shop, orderId: orderIdStr } },
        create: { shop, orderId: orderIdStr, cin7SalesOrderId: String(result.id), cin7StatusCheckedAt: null },
        update: { cin7SalesOrderId: String(result.id), cin7StatusCheckedAt: null },
      });
    }

    if (normalizedVariantId) {
      await prisma.orderLineItemOperationalData.upsert({
        where: { shop_orderId_variantId: { shop, orderId: orderIdStr, variantId: normalizedVariantId } },
        create: {
          shop,
          orderId: orderIdStr,
          variantId: normalizedVariantId,
          productTitle: targetLineItems[0]?.name ?? "",
          carrier,
          cin7SalesOrderId: String(result.id),
          cin7SalesOrderCode: String(result.code ?? ""),
          cin7SalesOrderRef: cin7Reference,
        },
        update: {
          cin7SalesOrderId: String(result.id),
          cin7SalesOrderCode: String(result.code ?? ""),
          cin7SalesOrderRef: cin7Reference,
          productTitle: targetLineItems[0]?.name ?? "",
          carrier,
        },
      });
    }

    console.log(`[Cin7][API][${orderIdStr}] SUCCESS - id=${result.id}, code=${result.code}`);

    // Match the cron job payment logic exactly: compute the paid ratio from the
    // Shopify order and apply it to the created Cin7 SO total, never the full
    // order total for a single line item.
    const totalPrice = Number(orderData.totalPriceSet?.presentmentMoney?.amount ?? 0);
    const totalOutstanding = Number(orderData.totalOutstandingSet?.presentmentMoney?.amount ?? 0);
    const paidAmount = Math.max(totalPrice - totalOutstanding, 0);
    const paidRatio = totalPrice > 0 ? Math.min(Math.max(paidAmount / totalPrice, 0), 1) : 0;

    if (paidRatio > 0) {
      const cin7Total = await fetchCin7SalesOrderTotal(String(result.id));
      const lineTotalInclTax = cin7Total ?? totalPrice;
      const paymentAmount = Math.round(Number(lineTotalInclTax) * paidRatio * 100) / 100;

      if (paymentAmount > 0) {
        const paymentResult = await createCin7Payment({
          orderId: Number(result.id),
          amount: paymentAmount,
          comments: `Auto-paid from Shopify order ${orderData.name ?? orderIdStr}`,
        });
        if (!paymentResult.ok) {
          console.error(`[Cin7][API][${orderIdStr}] Payment creation failed:`, paymentResult.error);
        } else {
          console.log(`[Cin7][API][${orderIdStr}] Payment created — id=${paymentResult.id}, amount=${paymentAmount} of ${lineTotalInclTax} (paidRatio=${paidRatio})`);
        }
      } else {
        console.log(`[Cin7][API][${orderIdStr}] SKIP payment - nothing paid yet (paidRatio=${paidRatio})`);
      }
    } else {
      console.log(`[Cin7][API][${orderIdStr}] SKIP payment - nothing paid yet (outstanding=${totalOutstanding})`);
    }

    return Response.json({
      ok: true,
      cin7SalesOrderId: String(result.id),
      cin7SalesOrderUrl: buildCin7SalesOrderUrl(String(result.id)) ?? "",
    });
  } catch (error) {
    console.error(`[Cin7][API] Error:`, error);
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
};
