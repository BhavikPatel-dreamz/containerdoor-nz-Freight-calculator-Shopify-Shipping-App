#!/usr/bin/env node
/**
 * Find a Shopify order on a connected shop (from Postgres Session).
 *
 * Shopify's orders(query: "number:572480 status:any") IGNORES invalid filters
 * and returns the latest 20 orders — that is why 572480 looked like "#CDL…".
 * This script only accepts hits whose order name actually contains the term,
 * then REST-looks-up by name, then paginates/scans.
 *
 *   pnpm oms:search-orders --list-shops
 *   pnpm oms:search-orders --shop=containerdoor-nz.myshopify.com --search=572480
 *   pnpm oms:search-orders --shop=containerdoor-nz.myshopify.com --search=572480 --scan=40
 */
import dotenv from "dotenv";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve } from "node:path";
import pg from "pg";

dotenv.config({ path: resolve(process.cwd(), ".env") });

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-10";
const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const out = { search: "", shop: "", listShops: false, recent: 0, scan: 25, force: false };
  for (const a of argv) {
    if (a === "--list-shops") out.listShops = true;
    else if (a === "--no-scan") out.scan = 0;
    else if (a === "--force") out.force = true;
    else if (a.startsWith("--shop=")) out.shop = a.slice("--shop=".length).trim();
    else if (a.startsWith("--search=")) out.search = a.slice("--search=".length).trim();
    else if (a.startsWith("--recent=")) out.recent = Number(a.slice("--recent=".length)) || 0;
    else if (a.startsWith("--scan=")) out.scan = Number(a.slice("--scan=".length)) || 0;
    else if (!a.startsWith("--") && !out.search) out.search = a;
  }
  return out;
}

function maskToken(token) {
  const t = String(token || "");
  if (t.length < 8) return "(none)";
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

function needle(term) {
  return String(term || "")
    .trim()
    .replace(/^#/, "")
    .toLowerCase();
}

function nameMatches(orderName, term) {
  const n = needle(term);
  if (!n) return false;
  const name = String(orderName || "").toLowerCase();
  const stripped = name.replace(/^#/, "");
  return stripped === n || name === `#${n}` || stripped.endsWith(n) || name.includes(n);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Missing DATABASE_URL in .env");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url });
  try {
    const shops = await listShops(pool);
    if (!shops.length) {
      console.error("No shops with an access token in Session.");
      process.exit(1);
    }

    if (args.listShops) {
      printShops(shops);
      return;
    }

    const shop = args.shop || (await pickShop(shops));
    const row = shops.find((s) => s.shop === shop) || shops.find((s) => s.shop.includes(shop));
    if (!row) {
      console.error(`Shop not found: ${shop}`);
      printShops(shops);
      process.exit(1);
    }

    console.log(`\nStore: ${row.shop}`);
    console.log(`Token: ${maskToken(row.accessToken)}  online=${row.isOnline}`);
    console.log(`Scope: ${row.scope || "(none)"}`);
    console.log(`API:   ${API_VERSION}`);
    warnScopes(row.scope, row.shop);
    const parts = String(row.scope || "")
      .split(",")
      .map((s) => s.trim());
    if (!parts.includes("read_orders") && !args.force) {
      const appUrl = (process.env.SHOPIFY_APP_URL || process.env.APPLICATION_URL || "https://containerdoor-nz-freight-calculator.vercel.app").replace(/\/$/, "");
      const authUrl = `${appUrl}/auth?shop=${encodeURIComponent(row.shop)}`;
      console.log("STOP: this Session token still does not have read_orders.");
      console.log("Deploying an app version does not update the token. The merchant must re-open the app and approve scopes.");
      console.log("");
      console.log("1. Shopify admin → Apps → ContainerDoor OMS (open the app)");
      console.log("   or visit:");
      console.log(`   ${authUrl}`);
      console.log("2. Approve read_orders when Shopify asks.");
      console.log("3. Re-run this command. Scope must include read_orders.");
      console.log("   (Use --force to scan anyway with the limited token.)");
      process.exit(3);
    }

    const q = args.search || (await prompt("Search order name/number (e.g. 572480 or #CDL215343): "));
    if (!q) {
      console.error("No search term.");
      process.exit(1);
    }

    console.log(`\nLooking for name containing: ${q}\n`);
    await searchOms(pool, row.shop, q);

    const gqlHits = await searchGraphqlFiltered(row, q);
    const restHits = await searchRestByName(row, q);
    const byIdHits = await searchShopifyById(row, q);
    let scanHits = [];
    if (!gqlHits.length && !restHits.length && !byIdHits.length && args.scan > 0) {
      scanHits = await scanOrders(row, q, args.scan);
    }

    const cin7Hits = await searchCin7(q);
    const mondayHits = await searchMonday(q);

    const all = uniqueById([...gqlHits, ...restHits, ...byIdHits, ...scanHits]);
    console.log("\n── RESULT ──");
    if (all.length) {
      for (const n of all) {
        console.log(`SHOPIFY FOUND  ${n.name}  ${n.id}  ${n.createdAt || ""}  ${n.email || ""}`);
      }
    } else {
      console.log(`Shopify: not found (${q}) on ${row.shop}`);
    }
    if (cin7Hits.length) {
      console.log("Cin7: found — you can link this in OMS without Shopify having the old number.");
    }
    if (mondayHits.length) {
      console.log("Monday: found — same, link by pulse name/SKU.");
    }
    if (!all.length && !cin7Hits.length && !mondayHits.length) {
      console.log("Not in Shopify, Cin7, or Monday under that number.");
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
}

function warnScopes(scope) {
  const parts = String(scope || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.includes("read_orders")) {
    console.log("WARN: token is missing read_orders — Shopify may hide many orders.");
  }
  if (!parts.includes("read_all_orders")) {
    console.log("WARN: token is missing read_all_orders — orders older than 60 days are often invisible.");
  }
  console.log("");
}

async function listShops(pool) {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (shop)
      shop,
      "accessToken",
      "isOnline",
      scope
    FROM "Session"
    WHERE "accessToken" IS NOT NULL AND "accessToken" <> ''
    ORDER BY shop, "isOnline" ASC, id DESC
  `);
  return rows;
}

function printShops(shops) {
  console.log("Connected shops:");
  shops.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.shop}  (${s.isOnline ? "online" : "offline"})  ${maskToken(s.accessToken)}`);
  });
}

async function pickShop(shops) {
  printShops(shops);
  if (shops.length === 1) return shops[0].shop;
  const answer = await prompt("Pick shop number or domain: ");
  const n = Number(answer);
  if (Number.isFinite(n) && shops[n - 1]) return shops[n - 1].shop;
  return answer.trim();
}

async function prompt(question) {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function shopifyGraphql(shopRow, query, variables) {
  const res = await fetch(`https://${shopRow.shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": shopRow.accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  return { status: res.status, json: await res.json() };
}

async function shopifyRest(shopRow, path) {
  const res = await fetch(`https://${shopRow.shop}/admin/api/${API_VERSION}/${path}`, {
    headers: { "X-Shopify-Access-Token": shopRow.accessToken },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, json };
}

const SEARCH_GQL = `query SearchOrders($query: String!) {
  orders(first: 50, query: $query, sortKey: CREATED_AT, reverse: true) {
    nodes { id name createdAt email displayFinancialStatus displayFulfillmentStatus }
  }
}`;

const SCAN_GQL = `query ScanOrders($cursor: String) {
  orders(first: 100, query: "status:any", after: $cursor, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes { id name createdAt email }
  }
}`;

function buildQueries(raw) {
  const noHash = needle(raw);
  const withHash = `#${noHash}`;
  const isDigits = /^\d+$/.test(noHash);
  const queries = [];
  const add = (label, value) => queries.push({ label, value });
  if (isDigits && noHash.length >= 10) add("id", `id:${noHash}`);
  add("name-quoted-hash", `name:"${withHash}"`);
  add("name-quoted-plain", `name:"${noHash}"`);
  add("name-hash", `name:${withHash}`);
  add("name-plain", `name:${noHash}`);
  if (isDigits) add("number", `number:${noHash}`);
  return queries;
}

function uniqueById(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const id = String(r.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

async function searchShopifyById(shopRow, term) {
  const id = String(term || "").replace(/^gid:\/\/shopify\/Order\//, "").trim();
  if (!/^\d{8,}$/.test(id)) return [];
  console.log("── Shopify GET by id ──");
  const hits = [];
  const { status, json } = await shopifyRest(shopRow, `orders/${id}.json`);
  const o = json?.order;
  console.log(`  GET orders/${id}.json  http=${status}${json?.errors ? ` errors=${JSON.stringify(json.errors)}` : ""}`);
  if (o?.id) {
    hits.push({
      id: `gid://shopify/Order/${o.id}`,
      name: o.name,
      createdAt: o.created_at,
      email: o.email,
    });
    console.log(`    MATCH name=${o.name}  id=${o.id}  ${o.financial_status}/${o.fulfillment_status}  ${o.created_at}  ${o.email || ""}`);
  }
  const gql = await shopifyGraphql(
    shopRow,
    `query ($id: ID!) { order(id: $id) { id name createdAt email displayFinancialStatus } }`,
    { id: `gid://shopify/Order/${id}` },
  );
  const node = gql.json?.data?.order;
  console.log(`  GraphQL order(id:)  http=${gql.status} found=${Boolean(node)}`);
  if (gql.json?.errors) console.log(`    errors: ${JSON.stringify(gql.json.errors)}`);
  if (node?.id) {
    hits.push(node);
    console.log(`    MATCH ${node.name}  ${node.id}  ${node.createdAt}  ${node.email || ""}`);
  }
  if (!hits.length) console.log("  (none)\n");
  else console.log("");
  return uniqueById(hits);
}

async function searchGraphqlFiltered(shopRow, term) {
  console.log("── GraphQL (name must match) ──");
  const hits = [];
  for (const { label, value } of buildQueries(term)) {
    const { status, json } = await shopifyGraphql(shopRow, SEARCH_GQL, { query: `${value} status:any` });
    const errors = json?.errors;
    const nodes = json?.data?.orders?.nodes ?? [];
    const matched = nodes.filter((n) => nameMatches(n.name, term));
    const ignored = nodes.length && !matched.length;
    console.log(
      `  [${label}] ${value}  http=${status} raw=${nodes.length} matched=${matched.length}${ignored ? "  (filter ignored — latest orders, not this name)" : ""}`,
    );
    if (errors?.length) console.log(`    errors: ${JSON.stringify(errors)}`);
    for (const n of matched) {
      console.log(`    MATCH ${n.name}  ${n.id}`);
      hits.push(n);
    }
  }
  return uniqueById(hits);
}

async function searchRestByName(shopRow, term) {
  console.log("\n── REST name= ──");
  const noHash = term.replace(/^#/, "");
  const paths = [
    `orders.json?status=any&name=${encodeURIComponent(noHash)}`,
    `orders.json?status=any&name=${encodeURIComponent(`#${noHash}`)}`,
  ];
  const hits = [];
  for (const path of paths) {
    const { status, json } = await shopifyRest(shopRow, path);
    const orders = json?.orders ?? [];
    const matched = orders.filter((o) => nameMatches(o.name, term));
    console.log(`  GET ${path}  http=${status} raw=${orders.length} matched=${matched.length}`);
    if (json?.errors) console.log(`    errors: ${JSON.stringify(json.errors)}`);
    for (const o of matched) {
      hits.push({
        id: `gid://shopify/Order/${o.id}`,
        name: o.name,
        createdAt: o.created_at,
        email: o.email,
      });
      console.log(`    MATCH ${o.name}  id=${o.id}`);
    }
  }
  return uniqueById(hits);
}

async function scanOrders(shopRow, term, maxPages) {
  console.log(`\n── Scan up to ${maxPages} pages (100 orders each) ──`);
  let cursor = null;
  let page = 0;
  let seen = 0;
  const hits = [];
  while (page < maxPages) {
    page += 1;
    const { status, json } = await shopifyGraphql(shopRow, SCAN_GQL, { cursor });
    if (json?.errors?.length) {
      console.log(`  page ${page} errors: ${JSON.stringify(json.errors)}`);
      break;
    }
    const conn = json?.data?.orders;
    const nodes = conn?.nodes ?? [];
    seen += nodes.length;
    for (const n of nodes) {
      if (nameMatches(n.name, term)) {
        console.log(`  MATCH page=${page} ${n.name}  ${n.id}  ${n.createdAt}`);
        hits.push(n);
      }
    }
    process.stdout.write(`  scanned page ${page}: ${seen} orders\r`);
    if (!conn?.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  console.log(`  scanned ${seen} orders, matches=${hits.length}                    `);
  return uniqueById(hits);
}

async function searchOms(pool, shop, term) {
  console.log("── OMS database (OrderSnapshot) ──");
  const noHash = term.replace(/^#/, "");
  const { rows } = await pool.query(
    `SELECT "orderId", "orderName", email, "financialStatus", "createdAt"
     FROM "OrderSnapshot"
     WHERE shop = $1
       AND (
         "orderName" ILIKE $2
         OR "orderName" ILIKE $3
         OR "orderId" = $4
       )
     ORDER BY "createdAt" DESC
     LIMIT 20`,
    [shop, `%${noHash}%`, `%#${noHash}%`, noHash],
  );
  if (!rows.length) {
    console.log("  (none in OMS for this shop)\n");
    return;
  }
  for (const r of rows) {
    console.log(
      `  ${r.orderName}  shopifyId=${r.orderId}  ${r.financialStatus}  ${r.createdAt?.toISOString?.() || r.createdAt}`,
    );
  }
  console.log("");
}

function cin7Esc(value) {
  return String(value).replace(/'/g, "''");
}

async function searchCin7(term) {
  console.log("── Cin7 Sales Orders ──");
  const base = String(process.env.CIN7_SYNC_URL || "").replace(/\/\d+$/, "") ||
    `${String(process.env.CIN7_BASE_URL || "").replace(/\/$/, "")}/SalesOrders`;
  const user = process.env.CIN7_USERNAME;
  const token = process.env.CIN7_SYNC_TOKEN;
  if (!base || !user || !token) {
    console.log("  skipped (CIN7_SYNC_URL / CIN7_USERNAME / CIN7_SYNC_TOKEN not set)\n");
    return [];
  }
  const auth = "Basic " + Buffer.from(`${user}:${token}`).toString("base64");
  const noHash = term.replace(/^#/, "");
  const keys = [...new Set([noHash, `#${noHash}`, term])];
  const hits = [];
  for (const field of ["customerOrderNo", "reference"]) {
    for (const key of keys) {
      const where = `${field}='${cin7Esc(key)}'`;
      const url = `${base}?where=${encodeURIComponent(where)}&fields=${encodeURIComponent("id,code,reference,customerOrderNo")}&rows=20`;
      try {
        const res = await fetch(url, { headers: { Authorization: auth } });
        const json = await res.json().catch(() => null);
        const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
        console.log(`  ${field}=${key}  http=${res.status} hits=${rows.length}`);
        for (const row of rows) {
          const id = String(row?.id ?? row?.Id ?? "");
          if (!id) continue;
          hits.push(row);
          console.log(
            `    MATCH id=${id} code=${row.code || row.Code || ""} ref=${row.reference || row.Reference || ""} customerOrderNo=${row.customerOrderNo || row.CustomerOrderNo || ""}`,
          );
        }
      } catch (err) {
        console.log(`  ${field}=${key}  error=${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  if (!hits.length) console.log("  (none)\n");
  else console.log("");
  return hits;
}

async function searchMonday(term) {
  console.log("── Monday board ──");
  const token = process.env.MONDAY_API_TOKEN;
  const boardId = process.env.MONDAY_BOARD_ID;
  if (!token || !boardId) {
    console.log("  skipped (MONDAY_API_TOKEN / MONDAY_BOARD_ID not set)\n");
    return [];
  }
  const noHash = term.replace(/^#/, "");
  const names = [...new Set([noHash, `#${noHash}`, term])];
  const hits = [];
  for (const name of names) {
    try {
      const res = await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token,
          "API-Version": "2024-01",
        },
        body: JSON.stringify({
          query: `query ($boardId: [ID!], $term: CompareValue) {
            boards(ids: $boardId) {
              items_page(limit: 25, query_params: {
                rules: [{ column_id: "name", compare_value: $term, operator: contains_text }]
              }) { items { id name } }
            }
          }`,
          variables: { boardId: [boardId], term: [name] },
        }),
      });
      const json = await res.json();
      if (json.errors) {
        console.log(`  name~${name}  errors=${JSON.stringify(json.errors).slice(0, 300)}`);
        continue;
      }
      const items = json?.data?.boards?.[0]?.items_page?.items ?? [];
      console.log(`  name~${name}  hits=${items.length}`);
      for (const item of items) {
        hits.push(item);
        console.log(`    MATCH ${item.name}  id=${item.id}`);
      }
    } catch (err) {
      console.log(`  name~${name}  error=${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!hits.length) console.log("  (none)\n");
  else console.log("");
  return hits;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
