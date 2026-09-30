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
 * Keep: unfulfilled / pending (including paid + unfulfilled).
 * Remove: fulfilled, cancelled, delivered. Unmatched (old pulses) only with --drop-unmatched.
 */
import { resolve } from "node:path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

dotenv.config({ path: resolve(process.cwd(), ".env"), quiet: true });

const rawArgv = process.argv.slice(2);
const argv = new Set(rawArgv);
const dryRun = !argv.has("--apply");
const dropUnmatched = argv.has("--drop-unmatched");
const scanAll = argv.has("--all");
const cursorArg = rawArgv.find((a) => a.startsWith("--cursor="))?.slice("--cursor=".length) || "";
const shop =
  String(process.env.ORDER_SYNC_SHOP || process.env.SHOPIFY_SHOP || "containerdoor-nz.myshopify.com").trim();
const boardId = String(process.env.MONDAY_BOARD_ID || "").trim();
const mondayToken = String(process.env.MONDAY_API_TOKEN || "").trim();
const scanLimit = scanAll ? 10000 : 400;
const deleteLimit = scanAll ? 400 : 200;

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
  await sleep(200);
  return json.data;
}

async function listPage(cursor) {
  const data = await mondayRequest(
    `query ($boardId: ID!, $cursor: String) {
      boards(ids: [$boardId]) {
        items_page(limit: 100, cursor: $cursor) {
          cursor
          items { id name }
        }
      }
    }`,
    { boardId, cursor: cursor || null },
  );
  const page = data?.boards?.[0]?.items_page;
  return {
    cursor: page?.cursor ? String(page.cursor) : null,
    items: (page?.items ?? []).map((item) => ({
      id: String(item?.id || ""),
      name: String(item?.name || ""),
    })),
  };
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
      return archiveItem(id);
    }
    throw err;
  }
}

if (!boardId || !mondayToken) {
  console.error("Missing MONDAY_BOARD_ID or MONDAY_API_TOKEN in .env");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

try {
  const items = [];
  let cursor = cursorArg || null;
  let pages = 0;
  console.error(
    `[monday-prune] ${dryRun ? "dry-run" : "APPLY"} shop=${shop} board=${boardId} all=${scanAll} dropUnmatched=${dropUnmatched} startCursor=${cursor ? "yes" : "start"}`,
  );
  while (items.length < scanLimit) {
    const page = await listPage(cursor);
    pages += 1;
    items.push(...page.items.filter((row) => row.id));
    cursor = page.cursor;
    console.error(`[monday-prune] page ${pages} items=${items.length} cursor=${cursor ? "yes" : "end"}`);
    if (!page.items.length || !cursor) break;
  }

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

  const targets = [];
  const unmatchedSample = [];
  let keep = 0;
  let unmatched = 0;

  for (const item of items) {
    const linked = opsByMonday.get(item.id);
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

    const snap = orderNameKeys(parsePulseOrderName(item.name))
      .map((key) => snapByName.get(key))
      .find(Boolean);
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
        nextCursor: cursor,
        sample: targets.slice(0, 20),
        hint: "keep = unfulfilled (Monday queue). eligible = fulfilled/cancelled/delivered. unmatched = not in OMS — add --drop-unmatched for old pulses. Repeat --all --apply until remaining=0.",
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
