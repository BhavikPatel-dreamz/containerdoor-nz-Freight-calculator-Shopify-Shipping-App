#!/usr/bin/env node
/**
 * Fix existing OMS rows: copy Shopify order createdAt onto snapshot + line index.
 *
 *   set -a && source .env && set +a
 *   node scripts/backfill-shopify-created-at.mjs
 *   node scripts/backfill-shopify-created-at.mjs --dry-run
 *
 * Env: APP_URL (or http://127.0.0.1:3000), CRON_SECRET, ORDER_SYNC_SHOP
 */
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env") });

const APP_URL = (
  process.env.EMAIL_CRON_APP_URL ||
  process.env.ORDER_SYNC_CRON_APP_URL ||
  process.env.APP_URL ||
  process.env.APP_BASE_URL ||
  "http://127.0.0.1:3000"
).replace(/\/$/, "");
const CRON_SECRET = String(process.env.CRON_SECRET || "").trim();
const SHOP = String(process.env.ORDER_SYNC_SHOP || process.env.SHOPIFY_SHOP || process.env.SHOP || "").trim();
const dryRun = process.argv.includes("--dry-run");
const take = 100;

if (!CRON_SECRET) {
  console.error("Missing CRON_SECRET");
  process.exit(1);
}
if (!SHOP) {
  console.error("Missing ORDER_SYNC_SHOP");
  process.exit(1);
}

let cursor = "";
let totalUpdated = 0;
let totalProcessed = 0;
let page = 0;

while (true) {
  page++;
  const params = new URLSearchParams({
    shop: SHOP,
    take: String(take),
  });
  if (cursor) params.set("cursor", cursor);
  if (dryRun) params.set("dryRun", "1");

  const res = await fetch(`${APP_URL}/api/backfill-shopify-created-at?${params}`, {
    headers: {
      Authorization: `Bearer ${CRON_SECRET}`,
      "X-Cron-Secret": CRON_SECRET,
      Accept: "application/json",
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    console.error("batch failed", res.status, body);
    process.exit(1);
  }
  totalUpdated += Number(body.updated || 0);
  totalProcessed += Number(body.processed || 0);
  console.log(
    `[backfill-created-at] page=${page} processed=${body.processed} updated=${body.updated} skipped=${body.skipped} missing=${body.missing} done=${body.done}`,
  );
  if (body.done) break;
  cursor = body.nextCursor || "";
  if (!cursor) break;
}

console.log(`[backfill-created-at] finished processed=${totalProcessed} updated=${totalUpdated} dryRun=${dryRun}`);
