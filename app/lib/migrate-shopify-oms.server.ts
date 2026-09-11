/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shopify → OMS migration for historical orders (imported into Shopify).
 *
 * Always writes OMS first. Then Monday and Cin7:
 *   - link if a record already exists (old platform / prior Cin7 or Monday)
 *   - create only when no match is found
 */
import { unauthenticated } from "../shopify.server";
import {
  createCin7EntryForOrder,
  createMondayEntriesForOrder,
  ingestShopifyOrderIntoOms,
  type OrderPayload,
} from "./order-webhook.server";

const ORDER_QUERY = `#graphql
  query MigrateShopifyOrder($query: String!) {
    orders(first: 5, query: $query) {
      nodes {
        id
        name
        email
        phone
        createdAt
        displayFinancialStatus
        taxesIncluded
        customAttributes { key value }
        shippingAddress {
          firstName lastName company address1 address2 city province zip country countryCodeV2 phone
        }
        billingAddress {
          firstName lastName company address1 address2 city province zip country countryCodeV2 phone
        }
        currentTotalPriceSet { presentmentMoney { amount currencyCode } }
        totalPriceSet { presentmentMoney { amount currencyCode } }
        totalDiscountsSet { presentmentMoney { amount } }
        discountCodes
        taxLines { rate }
        shippingLines(first: 10) {
          nodes {
            title
            code
            originalPriceSet { presentmentMoney { amount } }
          }
        }
        lineItems(first: 80) {
          nodes {
            id
            sku
            title
            variantTitle
            quantity
            vendor
            originalUnitPriceSet { presentmentMoney { amount currencyCode } }
            variant { id product { id } }
          }
        }
      }
    }
  }
`;

function gidNum(gid?: string | null): number | undefined {
  const m = String(gid || "").match(/(\d+)$/);
  return m ? Number(m[1]) : undefined;
}

function mapShopifyOrderNode(node: any): OrderPayload {
  const presentment = node?.currentTotalPriceSet?.presentmentMoney ?? node?.totalPriceSet?.presentmentMoney;
  const ship = node?.shippingAddress ?? {};
  const bill = node?.billingAddress ?? {};
  const financial = String(node?.displayFinancialStatus || "").toLowerCase();
  return {
    id: gidNum(node?.id),
    name: node?.name,
    created_at: node?.createdAt,
    email: node?.email,
    phone: node?.phone,
    taxes_included: Boolean(node?.taxesIncluded),
    financial_status: financial,
    current_total_price: presentment?.amount,
    total_price: node?.totalPriceSet?.presentmentMoney?.amount,
    current_total_price_set: {
      presentment_money: {
        amount: presentment?.amount,
        currency_code: presentment?.currencyCode,
      },
    },
    total_discounts: node?.totalDiscountsSet?.presentmentMoney?.amount,
    discount_codes: Array.isArray(node?.discountCodes)
      ? node.discountCodes.map((code: string) => ({ code }))
      : [],
    tax_lines: (node?.taxLines ?? []).map((t: any) => ({ rate: t?.rate })),
    note_attributes: (node?.customAttributes ?? []).map((a: any) => ({
      name: a?.key,
      value: a?.value,
    })),
    shipping_address: {
      first_name: ship.firstName,
      last_name: ship.lastName,
      company: ship.company,
      address1: ship.address1,
      address2: ship.address2,
      city: ship.city,
      province: ship.province,
      zip: ship.zip,
      country: ship.country,
      country_code: ship.countryCodeV2,
      phone: ship.phone,
    },
    billing_address: {
      first_name: bill.firstName,
      last_name: bill.lastName,
      company: bill.company,
      address1: bill.address1,
      address2: bill.address2,
      city: bill.city,
      province: bill.province,
      zip: bill.zip,
      country: bill.country,
      country_code: bill.countryCodeV2,
      phone: bill.phone,
    },
    customer: {
      first_name: ship.firstName,
      last_name: ship.lastName,
      email: node?.email,
      phone: node?.phone || ship.phone,
    },
    shipping_lines: (node?.shippingLines?.nodes ?? []).map((s: any) => ({
      title: s?.title,
      code: s?.code,
      price: s?.originalPriceSet?.presentmentMoney?.amount,
    })),
    line_items: (node?.lineItems?.nodes ?? []).map((li: any) => ({
      id: gidNum(li?.id),
      variant_id: gidNum(li?.variant?.id),
      product_id: gidNum(li?.variant?.product?.id),
      title: li?.title,
      variant_title: li?.variantTitle,
      sku: li?.sku,
      vendor: li?.vendor,
      quantity: li?.quantity,
      price: li?.originalUnitPriceSet?.presentmentMoney?.amount,
      price_set: {
        presentment_money: {
          amount: li?.originalUnitPriceSet?.presentmentMoney?.amount,
          currency_code: li?.originalUnitPriceSet?.presentmentMoney?.currencyCode,
        },
      },
    })),
  } as OrderPayload;
}

async function fetchShopifyOrderByNameOrId(
  admin: { graphql: (q: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> },
  nameOrId: string,
): Promise<OrderPayload | null> {
  const raw = String(nameOrId || "").trim();
  if (!raw) return null;
  const numeric = raw.replace(/^gid:\/\/shopify\/Order\//, "");
  const query = /^\d+$/.test(numeric)
    ? `id:${numeric}`
    : `name:${raw.startsWith("#") ? raw : `#${raw}`}`;

  const res = await admin.graphql(ORDER_QUERY, { variables: { query } });
  const json = await res.json();
  const node = json?.data?.orders?.nodes?.[0];
  if (!node) return null;
  return mapShopifyOrderNode(node);
}

export type MigrateOrderResult = {
  input: string;
  ok: boolean;
  orderId?: string;
  orderName?: string;
  monday?: { created: number; linked: number; skipped: number; failed: number };
  cin7?: { created: number; linked: number; skipped: number; failed: number };
  error?: string;
};

export async function migrateShopifyOrdersToOms(input: {
  shop: string;
  namesOrIds: string[];
}): Promise<{ shop: string; results: MigrateOrderResult[] }> {
  const shop = input.shop;
  const { admin } = await unauthenticated.admin(shop);
  const results: MigrateOrderResult[] = [];

  for (const raw of input.namesOrIds) {
    const token = String(raw || "").trim();
    if (!token) continue;
    try {
      const order = await fetchShopifyOrderByNameOrId(admin, token);
      if (!order?.id) {
        results.push({ input: token, ok: false, error: "Not found in Shopify" });
        continue;
      }
      await ingestShopifyOrderIntoOms(shop, order, admin);
      const monday = await createMondayEntriesForOrder(shop, order);
      const cin7 = await createCin7EntryForOrder(shop, order);
      results.push({
        input: token,
        ok: true,
        orderId: String(order.id),
        orderName: order.name,
        monday,
        cin7,
      });
    } catch (err) {
      results.push({
        input: token,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { shop, results };
}
