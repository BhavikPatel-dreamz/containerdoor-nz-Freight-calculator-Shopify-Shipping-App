/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { createCin7SalesOrder, fetchCin7SalesOrder } from "../lib/cin7.server";

type RequestPayload = {
  shop?: string;
  orderId?: string | number;
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
    const { shop, orderId } = payload;

    if (!shop || !orderId) {
      return Response.json({ error: "Missing shop or orderId" }, { status: 400 });
    }

    const orderIdStr = String(orderId);

    // Check if already processed
    let existing = await prisma.orderOperationalData.findUnique({
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
              }
            }
            lineItems(first: 50) {
              nodes {
                sku
                title
                quantity
                originalUnitPriceSet {
                  shopMoney {
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
    if (!orderRes.ok || orderJson.errors) {
      console.error(`[Cin7][API][${orderIdStr}] GraphQL error:`, orderJson.errors);
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
        code: li.sku ?? "",
        name: li.title ?? "",
        qty: li.quantity ?? 1,
        unitPrice: Number(li.originalUnitPriceSet?.shopMoney?.amount ?? 0),
      }))
      .filter((li) => li.code);

    if (lineItems.length === 0) {
      console.log(`[Cin7][API][${orderIdStr}] SKIP - no line items with a SKU`);
      return Response.json(
        { ok: false, error: "No line items with SKU found" },
        { status: 400 },
      );
    }

    // Create or get the record
    if (!existing) {
      existing = await prisma.orderOperationalData.create({
        data: { shop, orderId: orderIdStr, cin7SalesOrderId: "pending" },
      });
    }

    // Create Cin7 sales order
    const shippingAddress = orderData.shippingAddress ?? {};
    const billingAddress = orderData.billingAddress ?? {};
    
    // Extract currency from first line item or default to NZD
    const currencyCode = (orderData.lineItems?.nodes?.[0]?.originalUnitPriceSet?.shopMoney?.currencyCode ?? "NZD");
    
    // Extract carrier from first shipping line code (format: "service::CARRIER1,CARRIER2::boxes::...")
    const shippingLineCode = orderData.shippingLines?.nodes?.[0]?.code ?? "";
    const carrier = extractCarrierFromShippingCode(shippingLineCode);
    
    // Extract phone from various sources
    const phone = orderData.phone ?? shippingAddress.phone ?? billingAddress.phone ?? "";

    let result;
    try {
      result = await createCin7SalesOrder({
        reference: `Shopify-${orderData.name ?? orderIdStr}`,
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
        internalComments: `Auto-created from Shopify order ${orderData.name ?? orderIdStr}`,
        lineItems,
      });
    } catch (err) {
      if ((err as any)?.isDuplicate) {
        await prisma.orderOperationalData.update({
          where: { shop_orderId: { shop, orderId: orderIdStr } },
          data: { cin7SalesOrderId: "duplicate" },
        });
        console.log(`[Cin7][API][${orderIdStr}] DUPLICATE - reference already exists in Cin7`);
        return Response.json(
          { ok: false, cin7Status: "error", error: err instanceof Error ? err.message : "Duplicate reference" },
          { status: 409 },
        );
      }
      throw err;
    }

    // Update the record with the Cin7 ID
    await prisma.orderOperationalData.update({
      where: { shop_orderId: { shop, orderId: orderIdStr } },
      data: { cin7SalesOrderId: String(result.id), cin7StatusCheckedAt: null },
    });

    console.log(`[Cin7][API][${orderIdStr}] SUCCESS - id=${result.id}, code=${result.code}`);
    return Response.json({
      ok: true,
      cin7SalesOrderId: String(result.id),
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
