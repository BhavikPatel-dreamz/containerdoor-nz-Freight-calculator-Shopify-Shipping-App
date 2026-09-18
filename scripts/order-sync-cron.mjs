#!/usr/bin/env node
/**
 * Historical / catch-up Order Sync cron (PM2 / DigitalOcean).
 *
 * POST /api/order-sync-step with CRON_SECRET — one eligible order per tick
 * (Shopify → OMS → Cin7 → Monday). Cursor stays in this process.
 *
 * Env:
 *   APP_URL or ORDER_SYNC_CRON_APP_URL  — usually http://127.0.0.1:3000
 *   CRON_SECRET
 *   ORDER_SYNC_SHOP or SHOPIFY_SHOP     — e.g. store.myshopify.com
 *   ORDER_SYNC_CRON_INTERVAL_MS         — pause after an order (default 10000)
 *   ORDER_SYNC_CRON_IDLE_MS             — pause when caught up (default 300000)
 *   ORDER_SYNC_MODE                     — full | dry_run (default full)
 */
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env") });

const INTERVAL_MS = Number(process.env.ORDER_SYNC_CRON_INTERVAL_MS || "10000");
const IDLE_MS = Number(process.env.ORDER_SYNC_CRON_IDLE_MS || "300000");
const APP_URL = (
  process.env.ORDER_SYNC_CRON_APP_URL ||
  process.env.APP_URL ||
  process.env.APP_BASE_URL ||
  ""
).replace(/\/$/, "");
const CRON_SECRET = process.env.CRON_SECRET || "";
const SHOP = String(
  process.env.ORDER_SYNC_SHOP || process.env.SHOPIFY_SHOP || process.env.SHOP || "",
).trim();
const MODE = process.env.ORDER_SYNC_MODE === "dry_run" ? "dry_run" : "full";

if (!APP_URL) {
  console.error("[order-sync-cron] Missing APP_URL or ORDER_SYNC_CRON_APP_URL");
  process.exit(1);
}
if (!CRON_SECRET) {
  console.error("[order-sync-cron] Missing CRON_SECRET");
  process.exit(1);
}
if (!SHOP) {
  console.error("[order-sync-cron] Missing ORDER_SYNC_SHOP (e.g. your-store.myshopify.com)");
  process.exit(1);
}

const endpoint = `${APP_URL}/api/order-sync-step`;
let after = null;
let skipIds = [];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function step() {
  const started = Date.now();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
        "X-Cron-Secret": CRON_SECRET,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      shop: SHOP,
      mode: MODE,
      newestFirst: true,
      after,
      skipIds,
    }),
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text.slice(0, 200) };
  }
  if (json.after) after = json.after;
  const oid = String(json.order?.id || "");
  if (oid && !skipIds.includes(oid)) {
    skipIds.push(oid);
    if (skipIds.length > 2000) skipIds = skipIds.slice(-1500);
  }
  const label = json.order
    ? `${json.order.name || json.order.id} ${json.order.ok ? "OK" : "FAIL"}`
    : json.message || json.error || "";
  console.log(`[order-sync-cron] ${res.status} ${Date.now() - started}ms ${label}`.slice(0, 400));
  return json;
}

async function loop() {
  console.log(
    `[order-sync-cron] starting → ${endpoint} shop=${SHOP} mode=${MODE} wait=${INTERVAL_MS}ms`,
  );
  for (;;) {
    let json;
    try {
      json = await step();
    } catch (err) {
      console.error(
        "[order-sync-cron] fetch failed:",
        err instanceof Error ? err.message : err,
      );
      await sleep(INTERVAL_MS);
      continue;
    }
    if (json.done) {
      after = null;
      skipIds = [];
      console.log(`[order-sync-cron] caught up — idle ${IDLE_MS}ms then rescan`);
      await sleep(IDLE_MS);
      continue;
    }
    if (json.continueScan) continue;
    await sleep(INTERVAL_MS);
  }
}

loop();
