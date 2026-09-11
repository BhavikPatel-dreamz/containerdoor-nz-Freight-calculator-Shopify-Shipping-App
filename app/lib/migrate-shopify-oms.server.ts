/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shopify → OMS migration for historical orders.
 * Search Shopify, choose an order, ingest OMS if missing, then link-or-create Cin7 + Monday.
 * Every run writes OrderMigrateReport (one row per order) so it can be re-synced.
 */
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  createCin7EntryForOrder,
  createMondayEntriesForOrder,
  getOperationalLines,
  ingestShopifyOrderIntoOms,
  type OrderPayload,
} from "./order-webhook.server";
import { isLinkedCin7Id } from "./cin7-adapter.server";

export type MigrateLogStep = {
  at: string;
  step: string;
  ok: boolean;
  message: string;
};

export type MigrateLineReport = {
  variantId: string;
  sku: string;
  title: string;
  oms: "existed" | "created" | "missing";
  monday: string;
  mondayItemId: string;
  cin7: string;
  cin7SalesOrderId: string;
};

export type ShopifyOrderHit = {
  id: string;
  name: string;
  createdAt: string;
  email: string;
  financialStatus: string;
  customer: string;
  skuPreview: string;
  lineCount: number;
};

export type MigrateOrderResult = {
  input: string;
  ok: boolean;
  orderId?: string;
  orderName?: string;
  omsAction?: string;
  monday?: { created: number; linked: number; skipped: number; failed: number };
  cin7?: { created: number; linked: number; skipped: number; failed: number };
  steps?: MigrateLogStep[];
  lines?: MigrateLineReport[];
  error?: string;
};

const ORDER_FIELDS = `
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
`;

const SEARCH_QUERY = `#graphql
  query SearchShopifyOrders($query: String!) {
    orders(first: 25, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        createdAt
        email
        displayFinancialStatus
        shippingAddress { firstName lastName }
        lineItems(first: 8) { nodes { sku title quantity } }
      }
    }
  }
`;

const ORDER_BY_ID_QUERY = `#graphql
  query MigrateShopifyOrderById($id: ID!) {
    order(id: $id) { ${ORDER_FIELDS} }
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

function toHit(node: any): ShopifyOrderHit {
  const lines = node?.lineItems?.nodes ?? [];
  const ship = node?.shippingAddress ?? {};
  const customer = [ship.firstName, ship.lastName].filter(Boolean).join(" ").trim() || "—";
  const skus = lines.map((li: any) => String(li?.sku || "").trim()).filter(Boolean);
  return {
    id: String(gidNum(node?.id) || ""),
    name: String(node?.name || ""),
    createdAt: String(node?.createdAt || ""),
    email: String(node?.email || ""),
    financialStatus: String(node?.displayFinancialStatus || ""),
    customer,
    skuPreview: skus.slice(0, 4).join(", "),
    lineCount: lines.length,
  };
}

type AdminGraphql = {
  graphql: (q: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

function nameMatchesSearch(orderName: string, term: string): boolean {
  const n = String(term || "")
    .trim()
    .replace(/^#/, "")
    .toLowerCase();
  if (!n) return false;
  const name = String(orderName || "").toLowerCase();
  const stripped = name.replace(/^#/, "");
  return stripped === n || name === `#${n}` || stripped.endsWith(n) || name.includes(n);
}

function buildShopifySearchQueries(raw: string): string[] {
  const q = String(raw || "").trim();
  if (!q) return [];
  const noHash = q.replace(/^#/, "").replace(/^gid:\/\/shopify\/Order\//, "");
  const withHash = q.startsWith("#") ? q : `#${noHash}`;
  const isDigits = /^\d+$/.test(noHash);
  const looksLikeShopifyId = isDigits && noHash.length >= 10;
  const out: string[] = [];
  const add = (value: string) => {
    const withStatus = /\bstatus:/i.test(value) ? value : `(${value}) AND status:any`;
    if (!out.includes(withStatus)) out.push(withStatus);
  };

  if (looksLikeShopifyId) {
    add(`id:${noHash}`);
    return out;
  }

  if (isDigits) {
    add(`name:"${withHash}"`);
    add(`name:"${noHash}"`);
    add(`name:${withHash}`);
    add(`name:${noHash}`);
    return out;
  }

  add(`name:${withHash}`);
  add(`name:${noHash}`);
  if (q.includes("@")) add(`email:${q}`);
  return out;
}

export async function searchShopifyOrders(
  admin: AdminGraphql,
  query: string,
  shop?: string,
): Promise<{ hits: ShopifyOrderHit[]; error?: string; tried: string[] }> {
  const tried = buildShopifySearchQueries(query);
  if (!tried.length) return { hits: [], error: "Empty search", tried };

  const seen = new Set<string>();
  const hits: ShopifyOrderHit[] = [];
  let lastError = "";

  for (const q of tried) {
    const res = await admin.graphql(SEARCH_QUERY, { variables: { query: q } });
    const json = await res.json();
    if (json?.errors?.length) {
      lastError = json.errors.map((e: any) => e?.message || String(e)).join("; ");
      console.error("[Migrate] search GraphQL error", q, json.errors);
      continue;
    }
    const nodes = json?.data?.orders?.nodes ?? [];
    for (const node of nodes) {
      const hit = toHit(node);
      if (!hit.id || seen.has(hit.id)) continue;
      if (!nameMatchesSearch(hit.name, query)) continue;
      seen.add(hit.id);
      hits.push(hit);
    }
    if (hits.length) break;
  }

  if (!hits.length && shop) {
    const noHash = String(query || "").trim().replace(/^#/, "");
    const local = await prisma.orderSnapshot.findMany({
      where: {
        shop,
        OR: [
          { orderName: { equals: noHash, mode: "insensitive" } },
          { orderName: { equals: `#${noHash}`, mode: "insensitive" } },
          { orderName: { contains: noHash, mode: "insensitive" } },
        ],
      },
      take: 20,
      orderBy: { createdAt: "desc" },
    });
    for (const row of local) {
      if (!row.orderId || seen.has(row.orderId)) continue;
      seen.add(row.orderId);
      hits.push({
        id: row.orderId,
        name: row.orderName || row.orderId,
        createdAt: row.createdAt.toISOString(),
        email: row.email,
        financialStatus: row.financialStatus,
        customer: [row.shippingFirstName, row.shippingLastName].filter(Boolean).join(" ") || "—",
        skuPreview: "",
        lineCount: 0,
      });
    }
  }

  return {
    hits,
    error: hits.length ? undefined : lastError || undefined,
    tried,
  };
}

async function fetchShopifyOrderById(
  admin: { graphql: (q: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> },
  orderId: string,
): Promise<OrderPayload | null> {
  const numeric = String(orderId).replace(/^gid:\/\/shopify\/Order\//, "").trim();
  if (!numeric) return null;
  const gid = numeric.startsWith("gid://") ? numeric : `gid://shopify/Order/${numeric}`;
  const res = await admin.graphql(ORDER_BY_ID_QUERY, { variables: { id: gid } });
  const json = await res.json();
  const node = json?.data?.order;
  if (!node) return null;
  return mapShopifyOrderNode(node);
}

function summarizeAction(stats: { created: number; linked: number; skipped: number; failed: number } | undefined) {
  if (!stats) return "skipped";
  if (stats.failed && !stats.created && !stats.linked) return "failed";
  if (stats.linked && !stats.created) return "linked";
  if (stats.created && !stats.linked) return "created";
  if (stats.created || stats.linked) return "mixed";
  if (stats.skipped) return "skipped";
  return "none";
}

async function persistReport(input: {
  shop: string;
  orderId: string;
  orderName: string;
  status: string;
  omsAction: string;
  mondayAction: string;
  cin7Action: string;
  lastError: string;
  steps: MigrateLogStep[];
  lines: MigrateLineReport[];
  sentBy: string;
}) {
  const existing = await prisma.orderMigrateReport.findUnique({
    where: { shop_orderId: { shop: input.shop, orderId: input.orderId } },
    select: { id: true, runCount: true },
  }).catch(() => null);
  const runCount = (existing?.runCount || 0) + 1;
  try {
    await prisma.orderMigrateReport.upsert({
    where: { shop_orderId: { shop: input.shop, orderId: input.orderId } },
    create: {
      shop: input.shop,
      orderId: input.orderId,
      orderName: input.orderName,
      status: input.status,
      omsAction: input.omsAction,
      mondayAction: input.mondayAction,
      cin7Action: input.cin7Action,
      lastError: input.lastError,
      runCount: 1,
      stepsJson: JSON.stringify(input.steps),
      linesJson: JSON.stringify(input.lines),
    },
    update: {
      orderName: input.orderName,
      status: input.status,
      omsAction: input.omsAction,
      mondayAction: input.mondayAction,
      cin7Action: input.cin7Action,
      lastError: input.lastError,
      runCount,
      stepsJson: JSON.stringify(input.steps),
      linesJson: JSON.stringify(input.lines),
    },
  });

  await prisma.communicationLog.create({
    data: {
      shop: input.shop,
      orderId: input.orderId,
      activityType: "system_event",
      channel: "oms",
      subject: `Migrate run ${runCount}: ${input.status}`,
      body: input.steps.map((s) => `${s.ok ? "OK" : "FAIL"} ${s.step}: ${s.message}`).join("\n"),
      sentBy: input.sentBy || "system",
      deliveryStatus: input.status === "failed" ? "failed" : "internal",
      metadata: {
        kind: "shopify_oms_migrate",
        omsAction: input.omsAction,
        mondayAction: input.mondayAction,
        cin7Action: input.cin7Action,
        runCount,
      },
      sentAt: new Date(),
    },
    });
  } catch (err) {
    console.error("[Migrate] persist report failed", err);
  }
}

export async function listMigrateReports(shop: string, take = 30) {
  try {
    const rows = await prisma.orderMigrateReport.findMany({
      where: { shop },
      orderBy: { updatedAt: "desc" },
      take,
    });
    return rows.map((r) => ({
      ...r,
      steps: safeJson(r.stepsJson, [] as MigrateLogStep[]),
      lines: safeJson(r.linesJson, [] as MigrateLineReport[]),
    }));
  } catch (err) {
    console.error("[Migrate] list reports failed (run prisma migrate deploy?)", err);
    return [];
  }
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function migrateShopifyOrdersToOms(input: {
  shop: string;
  namesOrIds: string[];
  sentBy?: string;
}): Promise<{ shop: string; results: MigrateOrderResult[] }> {
  const shop = input.shop;
  const sentBy = input.sentBy || "system";
  const { admin } = await unauthenticated.admin(shop);
  const results: MigrateOrderResult[] = [];

  for (const raw of input.namesOrIds) {
    const token = String(raw || "").trim();
    if (!token) continue;
    results.push(await migrateOneShopifyOrder({ shop, admin, token, sentBy }));
  }

  return { shop, results };
}

async function migrateOneShopifyOrder(args: {
  shop: string;
  admin: { graphql: (q: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> };
  token: string;
  sentBy: string;
}): Promise<MigrateOrderResult> {
  const { shop, admin, token, sentBy } = args;
  const steps: MigrateLogStep[] = [];
  const log = (step: string, ok: boolean, message: string) => {
    steps.push({ at: new Date().toISOString(), step, ok, message });
  };

  let orderId = "";
  let orderName = "";
  let omsAction = "";
  let mondayStats: MigrateOrderResult["monday"];
  let cin7Stats: MigrateOrderResult["cin7"];
  let lines: MigrateLineReport[] = [];

  const finish = async (ok: boolean, error?: string) => {
    const mondayAction = summarizeAction(mondayStats);
    const cin7Action = summarizeAction(cin7Stats);
    const status = !ok ? "failed" : mondayStats?.failed || cin7Stats?.failed ? "partial" : "success";
    if (orderId) {
      await persistReport({
        shop,
        orderId,
        orderName,
        status,
        omsAction,
        mondayAction,
        cin7Action,
        lastError: error || "",
        steps,
        lines,
        sentBy,
      });
    }
    return {
      input: token,
      ok,
      orderId: orderId || undefined,
      orderName: orderName || undefined,
      omsAction,
      monday: mondayStats,
      cin7: cin7Stats,
      steps,
      lines,
      error,
    };
  };

  try {
    log("search", true, `Looking up Shopify order ${token}`);
    const order = await fetchShopifyOrderById(admin, token);
    if (!order?.id) {
      log("search", false, "Not found in Shopify");
      return finish(false, "Not found in Shopify");
    }
    orderId = String(order.id);
    orderName = String(order.name || "");
    log("search", true, `Found ${orderName} (id ${orderId})`);

    const shopifyLines = order.line_items ?? [];
    if (!shopifyLines.length) {
      log("validate_items", false, "Order has no line items");
      return finish(false, "No line items");
    }
    const missingSku = shopifyLines.filter((li) => !String(li.sku || "").trim());
    log(
      "validate_items",
      missingSku.length === 0,
      `${shopifyLines.length} line item(s)` +
        (missingSku.length ? `; ${missingSku.length} missing SKU` : "; SKUs present"),
    );

    const snapshot = await prisma.orderSnapshot.findUnique({
      where: { shop_orderId: { shop, orderId } },
      select: { id: true },
    });
    const existingOps = await prisma.orderLineItemOperationalData.findMany({
      where: { shop, orderId },
      select: { variantId: true, mondayItemId: true, cin7SalesOrderId: true },
    });
    const opsByVariant = new Map(existingOps.map((r) => [r.variantId, r]));
    const omsExisted = Boolean(snapshot) && existingOps.length > 0;
    omsAction = omsExisted ? "existed" : "created";
    log(
      "oms_check",
      true,
      omsExisted
        ? `OMS already has this order (${existingOps.length} line ops)`
        : "OMS does not have this order yet — will add",
    );

    await ingestShopifyOrderIntoOms(shop, order, admin);
    log("oms_ingest", true, omsExisted ? "OMS snapshot/index refreshed" : "OMS snapshot + line ops created");

    const opLines = getOperationalLines(order);
    log("oms_lines", opLines.length > 0, `${opLines.length} operational line(s) ready`);

    mondayStats = await createMondayEntriesForOrder(shop, order);
    log(
      "monday",
      (mondayStats.failed || 0) === 0,
      `Monday linked=${mondayStats.linked} created=${mondayStats.created} skipped=${mondayStats.skipped} failed=${mondayStats.failed}`,
    );

    cin7Stats = await createCin7EntryForOrder(shop, order);
    log(
      "cin7",
      (cin7Stats.failed || 0) === 0,
      `Cin7 linked=${cin7Stats.linked} created=${cin7Stats.created} skipped=${cin7Stats.skipped} failed=${cin7Stats.failed}`,
    );

    const afterOps = await prisma.orderLineItemOperationalData.findMany({
      where: { shop, orderId },
    });
    lines = opLines.map((li) => {
      const before = opsByVariant.get(li.variantId);
      const after = afterOps.find((r) => r.variantId === li.variantId);
      const mondayId = String(after?.mondayItemId || "").trim();
      const cin7Id = String(after?.cin7SalesOrderId || "").trim();
      return {
        variantId: li.variantId,
        sku: li.sku,
        title: li.title,
        oms: before ? "existed" : after ? "created" : "missing",
        monday: mondayId && mondayId !== "pending" ? (before?.mondayItemId && before.mondayItemId !== "pending" ? "existed" : "linked_or_created") : "missing",
        mondayItemId: mondayId,
        cin7: isLinkedCin7Id(cin7Id) ? (isLinkedCin7Id(before?.cin7SalesOrderId) ? "existed" : "linked_or_created") : cin7Id || "missing",
        cin7SalesOrderId: isLinkedCin7Id(cin7Id) ? cin7Id : "",
      };
    });
    log("report", true, `Saved migrate report for ${orderName}`);
    return finish(true);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log("error", false, error);
    return finish(false, error);
  }
}
