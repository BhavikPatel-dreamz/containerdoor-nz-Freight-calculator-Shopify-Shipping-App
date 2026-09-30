#!/usr/bin/env node
/**
 * Standalone Monday board prune — no oms-web, no other new files required.
 *
 * On the droplet:
 *   nano scripts/monday-prune.mjs   # paste this file
 *   node scripts/monday-prune.mjs
 *   node scripts/monday-prune.mjs --all
 *   node scripts/monday-prune.mjs --all --apply
 *   node scripts/monday-prune.mjs --all --apply --drop-unmatched
 *
 * Low Monday API use:
 *   node scripts/monday-prune.mjs              # 1 board scan (500/page) + Shopify unfulfilled; writes cache
 *   node scripts/monday-prune.mjs --apply      # deletes 50 from cache — no extra board scan
 *   node scripts/monday-prune.mjs --apply --refresh   # rescan board (only if cache is stale)
 */
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

dotenv.config({ path: resolve(process.cwd(), ".env"), quiet: true });

const rawArgv = process.argv.slice(2);
const argv = new Set(rawArgv);
const dryRun = !argv.has("--apply");
const dropUnmatched = argv.has("--drop-unmatched");
const scanAll = !argv.has("--page");
const omsOnly = argv.has("--oms-only");
const refresh = argv.has("--refresh");
const useGroups = argv.has("--groups");
const archiveFallback = argv.has("--archive-fallback");
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-10";
const cursorArg = rawArgv.find((a) => a.startsWith("--cursor="))?.slice("--cursor=".length) || "";
const shop =
  String(process.env.ORDER_SYNC_SHOP || process.env.SHOPIFY_SHOP || "containerdoor-nz.myshopify.com").trim();
const boardId = String(process.env.MONDAY_BOARD_ID || "").trim();
const mondayToken = String(process.env.MONDAY_API_TOKEN || "").trim();
const PAGE_SIZE = 500;
const scanLimit = scanAll ? 10000 : 400;
const deleteLimit = Math.min(Math.max(Number(rawArgv.find((a) => a.startsWith("--limit="))?.slice(8) || 50), 1), 80);
const CACHE_PATH = resolve(process.cwd(), ".monday-prune-cache.json");
const CACHE_MAX_MS = 6 * 60 * 60 * 1000;

function norm(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function shouldPrune({ fulfillmentStatus, financialStatus, customerStatus }) {
  const customer = norm(customerStatus);
  if (customer === "cancelled" || customer === "canceled" || customer === "delivered") return true;
  const financial = norm(financialStatus);
  if (financial === "cancelled" || financial === "canceled" || financial === "voided" || financial === "expired") {
    return true;
  }
  const fulfillment = norm(fulfillmentStatus);
  return fulfillment === "fulfilled" || fulfillment === "restocked";
}

function normalizeOrderName(value) {
  return String(value || "")
    .trim()
    .replace(/^#/, "")
    .replace(/[A-Za-z]$/, "")
    .toLowerCase();
}

async function loadUnfulfilledShopifyNames() {
  const session = await prisma.session.findFirst({
    where: { shop, accessToken: { not: "" } },
    orderBy: { isOnline: "asc" },
    select: { accessToken: true, shop: true },
  });
  if (!session?.accessToken) {
    console.error("[monday-prune] no Shopify Session token — falling back to OMS fulfillment");
    return null;
  }
  const names = new Set();
  let cursor = null;
  const query = "fulfillment_status:unfulfilled AND -status:cancelled";
  for (let page = 0; page < 40; page++) {
    const res = await fetch(`https://${session.shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken,
      },
      body: JSON.stringify({
        query: `query Unfulfilled($query: String!, $cursor: String) {
          orders(first: 250, after: $cursor, query: $query) {
            pageInfo { hasNextPage endCursor }
            nodes { name displayFulfillmentStatus }
          }
        }`,
        variables: { query, cursor },
      }),
    });
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    const conn = json.data?.orders;
    for (const node of conn?.nodes ?? []) {
      const n = normalizeOrderName(node?.name);
      if (n) names.add(n);
    }
    console.error(`[monday-prune] Shopify unfulfilled page ${page + 1} names=${names.size}`);
    if (!conn?.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break;
    cursor = conn.pageInfo.endCursor;
  }
  return names;
}

function parsePulseOrderName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[A-Za-z]$/, "");
}

function orderNameKeys(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const withHash = raw.startsWith("#") ? raw : `#${raw}`;
  return [...new Set([raw, withHash, withHash.replace(/^#/, "")])];
}

function reasonFor(fulfillment, financial, customer) {
  const customerN = String(customer || "").toLowerCase();
  if (customerN === "cancelled" || customerN === "canceled") return "cancelled";
  if (customerN === "delivered") return "delivered";
  if (String(fulfillment || "").toLowerCase().includes("fulfill")) return "fulfilled";
  return "closed";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function mondayRequest(query, variables, retries = 4) {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: mondayToken,
      "API-Version": "2024-01",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  const complexity = json.errors?.find((e) => e?.extensions?.code === "COMPLEXITY_BUDGET_EXHAUSTED");
  if (complexity && retries > 0) {
    const wait = Math.min(Number(complexity.extensions?.retry_in_seconds || 5), 15);
    console.error(`[monday-prune] complexity wait ${wait}s (${retries} left)`);
    await sleep(wait * 1000);
    return mondayRequest(query, variables, retries - 1);
  }
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function listPage(cursor) {
  const variables = { boardId };
  const cursorArgGql = cursor
    ? `query ($boardId: ID!, $cursor: String!) {
      boards(ids: [$boardId]) {
        items_count
        items_page(limit: ${PAGE_SIZE}, cursor: $cursor) {
          cursor
          items { id name }
        }
      }
    }`
    : `query ($boardId: ID!) {
      boards(ids: [$boardId]) {
        items_count
        items_page(limit: ${PAGE_SIZE}) {
          cursor
          items { id name }
        }
      }
    }`;
  if (cursor) variables.cursor = cursor;
  const data = await mondayRequest(cursorArgGql, variables);
  const board = data?.boards?.[0];
  const page = board?.items_page;
  return {
    itemsCount: Number(board?.items_count || 0),
    cursor: page?.cursor ? String(page.cursor) : null,
    items: (page?.items ?? []).map((item) => ({
      id: String(item?.id || ""),
      name: String(item?.name || ""),
    })),
  };
}

async function listGroupPage(groupId, cursor) {
  const variables = { boardId, groupId };
  const gql = cursor
    ? `query ($boardId: ID!, $groupId: CompareValue!, $cursor: String!) {
        boards(ids: [$boardId]) {
          items_page(
            limit: 100
            cursor: $cursor
            query_params: { rules: [{ column_id: "group", compare_value: $groupId, operator: any_of }] }
          ) { cursor items { id name } }
        }
      }`
    : `query ($boardId: ID!, $groupId: CompareValue!) {
        boards(ids: [$boardId]) {
          items_page(
            limit: 100
            query_params: { rules: [{ column_id: "group", compare_value: $groupId, operator: any_of }] }
          ) { cursor items { id name } }
        }
      }`;
  if (cursor) variables.cursor = cursor;
  const data = await mondayRequest(gql, variables);
  const page = data?.boards?.[0]?.items_page;
  return {
    cursor: page?.cursor ? String(page.cursor) : null,
    items: (page?.items ?? []).map((item) => ({
      id: String(item?.id || ""),
      name: String(item?.name || ""),
    })),
  };
}

async function listAllBoardItems() {
  const seen = new Set();
  const items = [];
  let pages = 0;
  let cursor = cursorArg || null;
  let itemsCount = 0;
  while (items.length < scanLimit) {
    const page = await listPage(cursor);
    pages += 1;
    itemsCount = page.itemsCount || itemsCount;
    for (const row of page.items.filter((r) => r.id)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      items.push(row);
    }
    cursor = page.cursor;
    console.error(`[monday-prune] board page ${pages} items=${items.length}/${itemsCount || "?"} cursor=${cursor ? "yes" : "end"}`);
    if (!page.items.length || !cursor) break;
  }
  if (useGroups && itemsCount > items.length + 50 && items.length < scanLimit) {
    const data = await mondayRequest(
      `query ($boardId: ID!) { boards(ids: [$boardId]) { groups { id title archived deleted } } }`,
      { boardId },
    );
    const groups = (data?.boards?.[0]?.groups ?? []).filter((g) => !g.archived && !g.deleted);
    console.error(`[monday-prune] scanning ${groups.length} groups (board items_count=${itemsCount})`);
    for (const group of groups) {
      let gCursor = null;
      for (let i = 0; i < 120 && items.length < scanLimit; i++) {
        const page = await listGroupPage(group.id, gCursor);
        pages += 1;
        let added = 0;
        for (const row of page.items.filter((r) => r.id)) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          items.push(row);
          added += 1;
        }
        console.error(`[monday-prune] group ${group.title || group.id} +${added} total=${items.length}`);
        gCursor = page.cursor;
        if (!page.items.length || !gCursor) break;
      }
    }
  }
  return { items, pages, itemsCount, cursor };
}

async function deleteItem(id) {
  const data = await mondayRequest(`mutation ($id: ID!) { delete_item (item_id: $id) { id } }`, { id });
  return Boolean(data?.delete_item?.id);
}

async function archiveItem(id) {
  const data = await mondayRequest(`mutation ($id: ID!) { archive_item (item_id: $id) { id } }`, { id });
  return Boolean(data?.archive_item?.id);
}

async function removeItem(id) {
  try {
    return await deleteItem(id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Item not found") || msg.includes("InvalidItemIdException")) return true;
    if (msg.includes("UserUnauthorized") || msg.includes("unauthorized")) {
      if (!archiveFallback) throw err;
      return archiveItem(id);
    }
    throw err;
  }
}

function readCache() {
  try {
    const raw = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
    if (raw.shop !== shop) return null;
    if (Date.now() - Number(raw.at || 0) > CACHE_MAX_MS) return null;
    if (!Array.isArray(raw.targets)) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeCache(payload) {
  writeFileSync(CACHE_PATH, JSON.stringify(payload));
  console.error(`[monday-prune] wrote cache ${CACHE_PATH} eligible=${payload.targets?.length || 0}`);
}

if (!boardId || !mondayToken) {
  console.error("Missing MONDAY_BOARD_ID or MONDAY_API_TOKEN in .env");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

try {
  let items = [];
  let pages = 0;
  let cursor = null;
  let keep = 0;
  let unmatched = 0;
  let unmatchedSample = [];
  let targets = [];
  let itemsCount = 0;
  const cache = !refresh ? readCache() : null;
  const applyFromCache = !dryRun && Number(cache?.targets?.length || 0) > 0;

  if (applyFromCache) {
    items = cache.items || [];
    targets = cache.targets;
    keep = cache.keep || 0;
    unmatched = cache.unmatched || 0;
    unmatchedSample = cache.unmatchedSample || [];
    itemsCount = cache.itemsCount || items.length;
    console.error(
      `[monday-prune] APPLY from cache eligible=${targets.length} keep=${keep} (0 Monday list calls)`,
    );
  } else {
  const listed = await listAllBoardItems();
  items = listed.items;
  cursor = listed.cursor;
  pages = listed.pages;
  itemsCount = listed.itemsCount;
  console.error(
    `[monday-prune] ${dryRun ? "dry-run" : "APPLY"} shop=${shop} board=${boardId} examined=${items.length} boardCount=${itemsCount} mondayListPages=${pages}`,
  );

  const mondayIds = items.map((row) => row.id);
  const opsByMonday = new Map();
  if (mondayIds.length) {
    const ops = await prisma.orderLineItemOperationalData.findMany({
      where: { shop, mondayItemId: { in: mondayIds } },
      select: {
        id: true,
        orderId: true,
        mondayItemId: true,
        customerStatus: true,
        order: { select: { orderName: true, fulfillmentStatus: true, financialStatus: true } },
      },
    });
    for (const row of ops) {
      opsByMonday.set(row.mondayItemId, {
        id: row.id,
        orderId: row.orderId,
        customerStatus: row.customerStatus,
        fulfillmentStatus: row.order?.fulfillmentStatus || "",
        financialStatus: row.order?.financialStatus || "",
        orderName: row.order?.orderName || "",
      });
    }
  }

  const unmatchedNames = new Set();
  for (const item of items) {
    if (opsByMonday.has(item.id)) continue;
    for (const key of orderNameKeys(parsePulseOrderName(item.name))) unmatchedNames.add(key);
  }

  const snaps = unmatchedNames.size
    ? await prisma.orderSnapshot.findMany({
        where: { shop, orderName: { in: [...unmatchedNames] } },
        select: { orderId: true, orderName: true, fulfillmentStatus: true, financialStatus: true },
      })
    : [];
  const snapByName = new Map();
  for (const snap of snaps) {
    for (const key of orderNameKeys(snap.orderName)) snapByName.set(key, snap);
  }

  const lineStatusByOrder = new Map();
  if (snaps.length) {
    const lineOps = await prisma.orderLineItemOperationalData.findMany({
      where: { shop, orderId: { in: snaps.map((s) => s.orderId) } },
      select: { orderId: true, customerStatus: true },
    });
    for (const row of lineOps) {
      if (row.customerStatus && !lineStatusByOrder.has(row.orderId)) {
        lineStatusByOrder.set(row.orderId, row.customerStatus);
      }
    }
  }

  const shopifyUnfulfilled = omsOnly ? null : await loadUnfulfilledShopifyNames();
  if (shopifyUnfulfilled) {
    console.error(`[monday-prune] Shopify unfulfilled orders=${shopifyUnfulfilled.size} (source of truth for keep)`);
  }

  targets = [];
  unmatchedSample = [];
  keep = 0;
  unmatched = 0;

  for (const item of items) {
    const pulseName = normalizeOrderName(item.name);
    const linked = opsByMonday.get(item.id);
    const snap = !linked
      ? orderNameKeys(parsePulseOrderName(item.name))
          .map((key) => snapByName.get(key))
          .find(Boolean)
      : null;

    if (shopifyUnfulfilled) {
      if (pulseName && shopifyUnfulfilled.has(pulseName)) {
        keep += 1;
        continue;
      }
      if (!linked && !snap) {
        unmatched += 1;
        if (unmatchedSample.length < 15) unmatchedSample.push({ id: item.id, name: item.name });
      }
      targets.push({
        opsId: linked?.id,
        orderId: linked?.orderId || snap?.orderId || "",
        orderName: linked?.orderName || snap?.orderName || item.name,
        mondayItemId: item.id,
        reason: "shopify_not_unfulfilled",
      });
      continue;
    }

    if (linked) {
      if (
        shouldPrune({
          fulfillmentStatus: linked.fulfillmentStatus,
          financialStatus: linked.financialStatus,
          customerStatus: linked.customerStatus,
        })
      ) {
        targets.push({
          opsId: linked.id,
          orderId: linked.orderId,
          orderName: linked.orderName || item.name,
          mondayItemId: item.id,
          reason: reasonFor(linked.fulfillmentStatus, linked.financialStatus, linked.customerStatus),
        });
      } else keep += 1;
      continue;
    }

    if (snap) {
      const customerStatus = lineStatusByOrder.get(snap.orderId) || "";
      if (
        shouldPrune({
          fulfillmentStatus: snap.fulfillmentStatus,
          financialStatus: snap.financialStatus,
          customerStatus,
        })
      ) {
        targets.push({
          orderId: snap.orderId,
          orderName: snap.orderName || item.name,
          mondayItemId: item.id,
          reason: reasonFor(snap.fulfillmentStatus, snap.financialStatus, customerStatus),
        });
      } else keep += 1;
      continue;
    }

    unmatched += 1;
    if (unmatchedSample.length < 15) unmatchedSample.push({ id: item.id, name: item.name });
    if (dropUnmatched) {
      targets.push({
        orderId: "",
        orderName: item.name,
        mondayItemId: item.id,
        reason: "unmatched",
      });
    }
  }

  writeCache({
    at: Date.now(),
    shop,
    items,
    targets,
    keep,
    unmatched,
    unmatchedSample,
    itemsCount,
    pages,
  });
  }

  let deleted = 0;
  let cleared = 0;
  let failed = 0;
  if (!dryRun) {
    const batch = targets.slice(0, deleteLimit);
    console.error(`[monday-prune] deleting ${batch.length} of ${targets.length} eligible`);
    for (const row of batch) {
      try {
        await removeItem(row.mondayItemId);
        deleted += 1;
        if (deleted % 10 === 0) console.error(`[monday-prune] deleted ${deleted}/${batch.length}`);
      } catch (err) {
        failed += 1;
        console.error("delete failed", row.mondayItemId, err);
      }
      if (row.opsId) {
        await prisma.orderLineItemOperationalData.update({
          where: { id: row.opsId },
          data: { mondayItemId: "", mondayItemName: "" },
        });
        cleared += 1;
      } else {
        await prisma.orderLineItemOperationalData.updateMany({
          where: { shop, mondayItemId: row.mondayItemId },
          data: { mondayItemId: "", mondayItemName: "" },
        });
      }
    }
    writeCache({
      at: Date.now(),
      shop,
      items,
      targets: targets.slice(deleteLimit),
      keep,
      unmatched,
      unmatchedSample,
      itemsCount,
      pages,
    });
  }

  console.log(
    JSON.stringify(
      {
        pruneVersion: 2,
        source: "board",
        dryRun,
        shop,
        examined: items.length,
        keep,
        unmatched,
        unmatchedSample,
        eligible: targets.length,
        remaining: Math.max(0, targets.length - deleteLimit),
        deleted,
        cleared,
        failed,
        pages,
        mondayListPages: pages,
        boardCount: itemsCount,
        fromCache: applyFromCache,
        deleteLimit,
        hint: "Dry-run once (lists Monday 500/page). Then --apply uses cache and only deletes 50/run. No extra board scan. --refresh to list again.",
      },
      null,
      2,
    ),
  );
} catch (err) {
  console.error("[monday-prune] failed", err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
