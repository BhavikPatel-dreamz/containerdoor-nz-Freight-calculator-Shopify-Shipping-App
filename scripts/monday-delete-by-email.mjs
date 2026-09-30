#!/usr/bin/env node
/**
 * Delete Monday pulses tied to test customer emails (OMS + board Email column).
 *
 *   node scripts/monday-delete-by-email.mjs
 *   node scripts/monday-delete-by-email.mjs --apply
 *   node scripts/monday-delete-by-email.mjs --apply --email=a@b.com --email=c@d.com
 */
import { resolve } from "node:path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

dotenv.config({ path: resolve(process.cwd(), ".env"), quiet: true });

const rawArgv = process.argv.slice(2);
const dryRun = !rawArgv.includes("--apply");
const emails = [
  ...rawArgv.filter((a) => a.startsWith("--email=")).map((a) => a.slice("--email=".length).trim().toLowerCase()),
  "trainee13.dynamicdreamz@gmail.com",
  "abhitest@yopmail.com",
].filter(Boolean);
const uniqueEmails = [...new Set(emails)];

const shop = String(
  process.env.ORDER_SYNC_SHOP || process.env.SHOPIFY_SHOP || "containerdoor-nz.myshopify.com",
).trim();
const boardId = String(process.env.MONDAY_BOARD_ID || "").trim();
const mondayToken = String(process.env.MONDAY_API_TOKEN || "").trim();

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
    console.error(`[monday-email] complexity wait ${wait}s`);
    await sleep(wait * 1000);
    return mondayRequest(query, variables, retries - 1);
  }
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  await sleep(200);
  return json.data;
}

async function deleteMondayItem(id) {
  const data = await mondayRequest(`mutation ($id: ID!) { delete_item (item_id: $id) { id } }`, { id });
  return Boolean(data?.delete_item?.id);
}

async function findEmailColumnId() {
  const data = await mondayRequest(
    `query ($boardId: ID!) { boards(ids: [$boardId]) { columns { id title type } } }`,
    { boardId },
  );
  const cols = data?.boards?.[0]?.columns ?? [];
  const match = cols.find((c) => String(c.type) === "email")
    || cols.find((c) => String(c.title || "").toLowerCase() === "email");
  return match?.id ? String(match.id) : "";
}

async function findMondayItemsByEmail(columnId, email) {
  const data = await mondayRequest(
    `query ($boardId: ID!, $columns: [ItemsPageByColumnValuesQuery!]) {
      items_page_by_column_values(board_id: $boardId, columns: $columns, limit: 100) {
        items { id name }
      }
    }`,
    { boardId, columns: [{ column_id: columnId, column_values: [email] }] },
  );
  return (data?.items_page_by_column_values?.items ?? []).map((item) => ({
    id: String(item.id),
    name: String(item.name || ""),
    email,
    source: "monday",
  }));
}

if (!boardId || !mondayToken) {
  console.error("Missing MONDAY_BOARD_ID or MONDAY_API_TOKEN");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

try {
  const targets = new Map();

  for (const email of uniqueEmails) {
    const indexRows = await prisma.orderLineItemIndex.findMany({
      where: { shop, email: { equals: email, mode: "insensitive" } },
      select: { orderId: true, orderName: true, email: true, variantId: true },
    });
    const snaps = await prisma.orderSnapshot.findMany({
      where: { shop, email: { equals: email, mode: "insensitive" } },
      select: { orderId: true, orderName: true, email: true },
    });
    const orderIds = [...new Set([...indexRows.map((r) => r.orderId), ...snaps.map((r) => r.orderId)])];
    if (!orderIds.length) {
      console.error(`[monday-email] OMS: no orders for ${email}`);
      continue;
    }
    const ops = await prisma.orderLineItemOperationalData.findMany({
      where: {
        shop,
        orderId: { in: orderIds },
        mondayItemId: { not: "" },
        NOT: { mondayItemId: "pending" },
      },
      select: { id: true, orderId: true, mondayItemId: true, mondayItemName: true, variantId: true },
    });
    for (const row of ops) {
      const snap = snaps.find((s) => s.orderId === row.orderId);
      const idx = indexRows.find((i) => i.orderId === row.orderId && i.variantId === row.variantId);
      targets.set(row.mondayItemId, {
        mondayItemId: row.mondayItemId,
        opsId: row.id,
        orderId: row.orderId,
        orderName: idx?.orderName || snap?.orderName || row.mondayItemName,
        email,
        source: "oms",
      });
    }
    console.error(`[monday-email] OMS ${email}: ${orderIds.length} order(s), ${ops.length} pulse id(s)`);
  }

  let emailCol = "";
  try {
    emailCol = await findEmailColumnId();
    console.error(`[monday-email] Monday email column=${emailCol || "(none)"}`);
    if (emailCol) {
      for (const email of uniqueEmails) {
        const items = await findMondayItemsByEmail(emailCol, email);
        console.error(`[monday-email] board search ${email}: ${items.length} item(s)`);
        for (const item of items) {
          if (targets.has(item.id)) continue;
          targets.set(item.id, {
            mondayItemId: item.id,
            orderName: item.name,
            email,
            source: "monday",
          });
        }
      }
    }
  } catch (err) {
    console.error("[monday-email] board email search failed", err);
  }

  const list = [...targets.values()];
  let deleted = 0;
  let cleared = 0;
  let failed = 0;
  if (!dryRun) {
    for (const row of list) {
      try {
        await deleteMondayItem(row.mondayItemId);
        deleted += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Item not found") || msg.includes("InvalidItemIdException")) {
          deleted += 1;
        } else {
          failed += 1;
          console.error("[monday-email] delete failed", row.mondayItemId, msg.slice(0, 180));
        }
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
        dryRun,
        shop,
        emails: uniqueEmails,
        eligible: list.length,
        deleted,
        cleared,
        failed,
        sample: list.slice(0, 40),
      },
      null,
      2,
    ),
  );
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
