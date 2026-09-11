/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shopify → OMS migration for historical orders.
 * Search Shopify, choose an order, ingest OMS if missing, then link-or-create Cin7 + Monday.
 * Every run writes OrderMigrateReport (one row per order) so it can be re-synced.
 */
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { type OrderPayload } from "./order-webhook.server";
import { runOrderPipeline } from "./migration-pipeline.server";
import { isLinkedCin7Id } from "./cin7-adapter.server";
import {
  bumpMigrationRunCounters,
  createMigrationRun,
  finishMigrationOrder,
  finishMigrationRun,
  markMigrationOrderRunning,
} from "./migration-run.server";

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
  mode?: "dry_run" | "full";
  critical?: boolean;
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
      variant { id sku product { id } }
    }
  }
`;

const ORDER_SCAN_QUERY = `#graphql
  query ScanShopifyOrdersPage($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: false) {
      pageInfo { hasNextPage endCursor }
      nodes { id name createdAt }
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

function extractConnectionNodes(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.nodes)) return value.nodes;
  if (Array.isArray(value.edges)) {
    return value.edges.map((e: any) => e?.node).filter(Boolean);
  }
  return [];
}

export function mapShopifyOrderNode(node: any): OrderPayload {
  const presentment = node?.currentTotalPriceSet?.presentmentMoney ?? node?.totalPriceSet?.presentmentMoney;
  const ship = node?.shippingAddress ?? {};
  const bill = node?.billingAddress ?? {};
  const financial = String(node?.displayFinancialStatus || "").toLowerCase();
  const lineNodes = extractConnectionNodes(node?.lineItems || node?.line_items);
  const shippingNodes = extractConnectionNodes(node?.shippingLines || node?.shipping_lines);
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
      country_code: ship.countryCodeV2 || ship.countryCode,
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
      country_code: bill.countryCodeV2 || bill.countryCode,
      phone: bill.phone,
    },
    customer: {
      first_name: ship.firstName,
      last_name: ship.lastName,
      email: node?.email,
      phone: node?.phone || ship.phone,
    },
    shipping_lines: shippingNodes.map((s: any) => ({
      title: s?.title,
      code: s?.code,
      price: s?.originalPriceSet?.presentmentMoney?.amount ?? s?.price,
    })),
    line_items: lineNodes.map((li: any) => {
      const lineId = gidNum(li?.id);
      const variantId = gidNum(li?.variant?.id) ?? gidNum(li?.variant_id) ?? lineId;
      return {
        id: lineId,
        variant_id: variantId,
        product_id: gidNum(li?.variant?.product?.id),
        title: li?.title || li?.name,
        variant_title: li?.variantTitle,
        sku: li?.sku || li?.variant?.sku,
        vendor: li?.vendor,
        quantity: li?.quantity,
        price: li?.originalUnitPriceSet?.presentmentMoney?.amount ?? li?.price,
        price_set: {
          presentment_money: {
            amount: li?.originalUnitPriceSet?.presentmentMoney?.amount ?? li?.price,
            currency_code: li?.originalUnitPriceSet?.presentmentMoney?.currencyCode,
          },
        },
      };
    }),
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

async function whichOrdersAlreadySynced(shop: string, orderIds: string[]): Promise<Set<string>> {
  const ids = orderIds.filter(Boolean);
  const synced = new Set<string>();
  if (!ids.length) return synced;
  const reports = await prisma.orderMigrateReport.findMany({
    where: { shop, orderId: { in: ids }, status: "success" },
    select: { orderId: true },
  }).catch(() => []);
  for (const row of reports) synced.add(row.orderId);
  const remaining = ids.filter((id) => !synced.has(id));
  if (!remaining.length) return synced;
  const ops = await prisma.orderLineItemOperationalData.findMany({
    where: { shop, orderId: { in: remaining } },
    select: { orderId: true, mondayItemId: true, cin7SalesOrderId: true },
  });
  const byOrder = new Map<string, typeof ops>();
  for (const row of ops) {
    const list = byOrder.get(row.orderId) || [];
    list.push(row);
    byOrder.set(row.orderId, list);
  }
  for (const [orderId, rows] of byOrder) {
    if (!rows.length) continue;
    const allLinked = rows.every((row) => {
      const monday = String(row.mondayItemId || "").trim();
      return isLinkedCin7Id(row.cin7SalesOrderId) && Boolean(monday && monday !== "pending");
    });
    if (allLinked) synced.add(orderId);
  }
  return synced;
}

export type FindNextEligibleResult =
  | {
      orderId: string;
      orderName: string;
      skippedCompleted: number;
      pagesScanned: number;
      scannedCount: number;
    }
  | {
      error: string;
      skippedCompleted: number;
      pagesScanned: number;
      scannedCount: number;
    };

const SCAN_PAGE_SIZE = 50;
/** Cap one Sync Next request so we do not walk the whole store in one HTTP call. */
const SCAN_MAX_PAGES = 20;

/**
 * Oldest-first Shopify scan with pagination. Skips orders already successfully
 * synced (migrate report success, or every line has Cin7 + Monday ids).
 * Does not re-select those completed orders. Persisted resume cursor is Task 5.
 */
export async function findNextEligibleShopifyOrder(
  admin: AdminGraphql,
  shop: string,
): Promise<FindNextEligibleResult> {
  let after: string | null = null;
  let skippedCompleted = 0;
  let scannedCount = 0;
  let pagesScanned = 0;

  for (let page = 0; page < SCAN_MAX_PAGES; page++) {
    const res = await admin.graphql(ORDER_SCAN_QUERY, {
      variables: { first: SCAN_PAGE_SIZE, after, query: "status:any" },
    });
    const json = await res.json();
    if (json?.errors?.length) {
      return {
        error: json.errors.map((e: { message?: string }) => e?.message || String(e)).join("; "),
        skippedCompleted,
        pagesScanned,
        scannedCount,
      };
    }
    const conn = json?.data?.orders;
    const nodes = conn?.nodes ?? [];
    pagesScanned += 1;
    if (!nodes.length) {
      break;
    }
    const pageIds = nodes.map((node: { id?: string }) => String(gidNum(node?.id) || "")).filter(Boolean);
    const synced = await whichOrdersAlreadySynced(shop, pageIds);
    for (const node of nodes) {
      const orderId = String(gidNum(node?.id) || "");
      if (!orderId) continue;
      scannedCount += 1;
      if (synced.has(orderId)) {
        skippedCompleted += 1;
        continue;
      }
      return {
        orderId,
        orderName: String(node?.name || orderId),
        skippedCompleted,
        pagesScanned,
        scannedCount,
      };
    }
    const pageInfo = conn?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo?.endCursor) {
      return {
        error: scannedCount
          ? `No unsynced Shopify orders in ${scannedCount} scanned (skipped ${skippedCompleted} already complete).`
          : "No Shopify orders found.",
        skippedCompleted,
        pagesScanned,
        scannedCount,
      };
    }
    after = String(pageInfo.endCursor);
  }

  return {
    error: `Reached scan limit (${SCAN_MAX_PAGES} pages / ${SCAN_PAGE_SIZE} each) after skipping ${skippedCompleted} completed order(s). Task 5 will persist cursor to continue.`,
    skippedCompleted,
    pagesScanned,
    scannedCount,
  };
}

export type SyncSystemMark = "ok" | "fail" | "pending";

export function summarizeSyncSystems(result: MigrateOrderResult): {
  shopify: SyncSystemMark;
  oms: SyncSystemMark;
  cin7: SyncSystemMark;
  monday: SyncSystemMark;
  statusLabel: string;
  failedStep?: string;
  failedMessage?: string;
} {
  const steps = result.steps || [];
  const mark = (names: string[]): SyncSystemMark => {
    const rows = steps.filter((s) => names.includes(s.step));
    if (!rows.length) return "pending";
    if (rows.some((s) => !s.ok)) return "fail";
    return "ok";
  };
  const shopify = mark(["search", "shopify"]);
  const oms = mark(["oms_sync", "oms_verify"]);
  const cin7 = mark(["cin7_sync", "cin7_verify"]);
  const monday = mark(["monday_sync", "monday_verify"]);
  const failed = steps.find((s) => !s.ok);
  const allOk = shopify === "ok" && oms === "ok" && cin7 === "ok" && monday === "ok";
  return {
    shopify: shopify === "pending" && result.orderId ? "ok" : shopify,
    oms,
    cin7,
    monday,
    statusLabel: allOk ? "Completed" : result.ok ? "Partial" : "Failed",
    failedStep: failed?.step,
    failedMessage: failed?.message || result.error,
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
  /** Admin UI already loaded this order (bypasses app-token Shopify GET). */
  orderNode?: any;
  mode?: "dry_run" | "full";
}): Promise<{ shop: string; runId?: string; results: MigrateOrderResult[] }> {
  const shop = input.shop;
  const sentBy = input.sentBy || "system";
  const { admin } = await unauthenticated.admin(shop);
  const tokens = input.namesOrIds.map((x) => String(x || "").trim()).filter(Boolean);
  const { run, orders } = await createMigrationRun({
    shop,
    mode: input.mode || "full",
    orderLimit: tokens.length,
    createdBy: sentBy,
    tokens,
  });
  const results: MigrateOrderResult[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const track = orders[i];
    await markMigrationOrderRunning(track.id);
    const one = await processShopifyOrder({
      shop,
      admin,
      token,
      shopifyOrderId: token,
      sentBy,
      orderNode: input.orderNode,
      trackingOrderId: track.id,
      mode: input.mode || "full",
      persistReport: (input.mode || "full") !== "dry_run",
    });
    results.push(one);
    const failed = one.ok === false || (one.monday?.failed || 0) > 0 || (one.cin7?.failed || 0) > 0;
    await finishMigrationOrder({
      id: track.id,
      shopifyOrderId: one.orderId || token,
      shopifyOrderName: one.orderName || "",
      status: !one.ok ? "failed" : failed ? "partial" : "completed",
      currentStep: one.steps?.length ? String(one.steps[one.steps.length - 1]?.step || "") : "",
      error: one.error,
    });
    await bumpMigrationRunCounters(run.id, !one.ok || failed ? "failed" : "success");
    if (one.error === "Missing shop") {
      await finishMigrationRun(run.id, "aborted");
      return { shop, runId: run.id, results };
    }
  }

  await finishMigrationRun(run.id, "completed");
  return { shop, runId: run.id, results };
}

/**
 * ONE source of truth for processing a single Shopify order:
 * load (or use payload) → OMS → Cin7 → Monday → status/logs.
 * Sync Next, bulk, retry, and admin Sync must call this — not the adapters directly.
 */
export async function processShopifyOrder(args: {
  shop: string;
  admin?: { graphql: (q: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> };
  /** Shopify numeric id, GID, or order name used to fetch when `order` is omitted. */
  shopifyOrderId?: string;
  token?: string;
  order?: OrderPayload;
  orderNode?: any;
  trackingOrderId?: string;
  mode?: "dry_run" | "full";
  sentBy?: string;
  persistReport?: boolean;
}): Promise<MigrateOrderResult> {
  const token = String(args.token || args.shopifyOrderId || args.order?.id || "").trim();
  const sentBy = args.sentBy || "system";
  const mode = args.mode || "full";
  const orderNode = args.orderNode;
  const shop = args.shop;
  const admin = args.admin || (await unauthenticated.admin(shop)).admin;
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
    if (orderId && mode !== "dry_run" && args.persistReport !== false) {
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
      mode: mode || "full",
      critical: false,
    };
  };

  let pipelineCritical = false;

  try {
    log("search", true, `Looking up Shopify order ${token || "(payload)"}`);
    let order: OrderPayload | null = args.order?.id ? args.order : null;
    const rawNode = orderNode?.data?.order || orderNode?.data?.node || orderNode?.order || orderNode;
    if (!order?.id && rawNode) {
      order = mapShopifyOrderNode(rawNode);
    }
    const fallbackId = gidNum(token) ?? (Number(String(token).replace(/\D/g, "")) || undefined);
    if (order && !order.id && fallbackId) {
      order.id = fallbackId;
    }
    if (!order?.id && token) {
      order = await fetchShopifyOrderById(admin, token);
    }
    if (!order?.id && fallbackId && rawNode) {
      order = { ...(order || {}), id: fallbackId, name: rawNode.name || `#${fallbackId}`, line_items: order?.line_items };
    }
    if (!order?.id) {
      log("search", false, rawNode || args.order ? "Payload had no order id" : "Not found in Shopify (app token cannot read this order)");
      return finish(false, "Not found in Shopify");
    }
    if (args.order?.id) {
      log("search", true, `Using provided payload (${order.name}, id ${order.id})`);
    } else if (orderNode) {
      log("search", true, `Loaded from Shopify Admin page (${order.name}, id ${order.id})`);
    } else {
      log("search", true, `Found ${order.name} (id ${order.id})`);
    }

    const pipeline = await runOrderPipeline({
      shop,
      order,
      admin,
      mode: mode || "full",
      trackingOrderId: args.trackingOrderId,
    });
    pipelineCritical = Boolean(pipeline.critical);
    for (const s of pipeline.steps) {
      log(s.step, s.ok, s.message);
    }
    orderId = pipeline.orderId;
    orderName = pipeline.orderName;
    omsAction = pipeline.omsAction;
    mondayStats = pipeline.monday;
    cin7Stats = pipeline.cin7;
    lines = pipeline.lines;
    if (pipeline.status === "completed" && args.persistReport !== false && mode !== "dry_run") {
      log("report", true, `Saved migrate report for ${orderName}`);
    }
    const out = await finish(pipeline.status !== "failed", pipeline.error);
    return { ...out, critical: pipelineCritical };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log("error", false, error);
    const out = await finish(false, error);
    return { ...out, critical: pipelineCritical };
  }
}
