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
 *   ORDER_SYNC_CRON_INTERVAL_MS         — pause after an order (default 500 ≈ 20–30/min)
 *   ORDER_SYNC_CRON_IDLE_MS             — pause when caught up (default 300000)
 *   ORDER_SYNC_MODE                     — full | dry_run (default full)
 */
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env") });

const INTERVAL_MS = Number(process.env.ORDER_SYNC_CRON_INTERVAL_MS || "500");
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text.slice(0, 200) };
  }
  return { res, json };
}

const headers = {
  Authorization: `Bearer ${CRON_SECRET}`,
  "X-Cron-Secret": CRON_SECRET,
  Accept: "application/json",
  "Content-Type": "application/json",
};

async function step() {
  const started = Date.now();
  const { res, json } = await fetchJson(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      shop: SHOP,
      mode: MODE,
      newestFirst: true,
      persist: true,
    }),
  });
  const label = json.order
    ? `${json.order.name || json.order.id} ${json.order.ok ? "OK" : "FAIL"}`
    : json.message || json.error || "";
  const resume = json.resumedFrom ? ` (after ${json.resumedFrom})` : "";
  console.log(
    `[order-sync-cron] ${res.status} ${Date.now() - started}ms ${label}${resume}`.slice(0, 400),
  );
  return json;
}

async function loop() {
  const { json: status } = await fetchJson(`${endpoint}?status=1&shop=${encodeURIComponent(SHOP)}`, {
    method: "GET",
    headers,
  });
  console.log(
    `[order-sync-cron] starting → ${endpoint} shop=${SHOP} mode=${MODE} wait=${INTERVAL_MS}ms`,
  );
  console.log(`[order-sync-cron] ${status.message || "no saved cursor"}`);
  if (status.cursor?.lastOrderName) {
    console.log(
      `[order-sync-cron] last=${status.cursor.lastOrderName} processed=${status.cursor.processed} ok=${status.cursor.success} fail=${status.cursor.failed}`,
    );
  }
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
      console.log(`[order-sync-cron] caught up — idle ${IDLE_MS}ms then rescan from newest unsynced`);
      await sleep(IDLE_MS);
      continue;
    }
    if (json.continueScan) continue;
    await sleep(INTERVAL_MS);
  }
}

loop();
