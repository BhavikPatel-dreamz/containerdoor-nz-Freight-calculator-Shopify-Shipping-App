#!/usr/bin/env node
/**
 * Order webhook queue cron (PM2 / self-hosted).
 *
 * Polls GET /api/order-webhook/process with CRON_SECRET.
 * Env:
 *   APP_URL or ORDER_WEBHOOK_CRON_APP_URL — e.g. https://containerdoor-nz-freight-calculator.vercel.app
 *   CRON_SECRET                         — same as API worker
 *   ORDER_WEBHOOK_CRON_INTERVAL_MS      — default 30000 (30s)
 */
import dotenv from "dotenv";
import { resolve } from "path";

// Load project .env (if present) before reading process.env
dotenv.config({ path: resolve(process.cwd(), ".env") });

const INTERVAL_MS = Number(process.env.ORDER_WEBHOOK_CRON_INTERVAL_MS || "30000");
// Prefer ORDER_WEBHOOK_CRON_APP_URL, then APP_URL, then APP_BASE_URL
const APP_URL = (
  process.env.ORDER_WEBHOOK_CRON_APP_URL || process.env.APP_URL || process.env.APP_BASE_URL || ""
).replace(/\/$/, "");
const CRON_SECRET = process.env.CRON_SECRET || "";

if (!APP_URL) {
  console.error("[order-webhook-cron] Missing APP_URL or ORDER_WEBHOOK_CRON_APP_URL");
  process.exit(1);
}
if (!CRON_SECRET) {
  console.error("[order-webhook-cron] Missing CRON_SECRET");
  process.exit(1);
}

const endpoint = `${APP_URL}/api/order-webhook/process`;

async function tick() {
  const started = Date.now();
  try {
    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
        Accept: "application/json",
      },
    });
    const text = await res.text();
    let body = text;
    try {
      body = JSON.stringify(JSON.parse(text));
    } catch {
      /* keep raw */
    }
    console.log(
      `[order-webhook-cron] ${res.status} ${Date.now() - started}ms ${body.slice(0, 400)}`,
    );
  } catch (err) {
    console.error(
      `[order-webhook-cron] fetch failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}

console.log(`[order-webhook-cron] starting → ${endpoint} every ${INTERVAL_MS}ms`);
tick();
setInterval(tick, INTERVAL_MS);
