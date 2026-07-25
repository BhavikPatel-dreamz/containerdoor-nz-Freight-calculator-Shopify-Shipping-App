#!/usr/bin/env node
/**
 * OMS email queue cron (PM2 / self-hosted).
 *
 * Hits GET /api/bulk-notify/process with CRON_SECRET every interval.
 * Use when Vercel Hobby cannot run minutely crons.
 *
 * Env:
 *   APP_URL or EMAIL_CRON_APP_URL  — e.g. https://containerdoor-nz-freight-calculator.vercel.app
 *   CRON_SECRET                    — same as API worker
 *   EMAIL_CRON_INTERVAL_MS         — default 60000
 *
 * Start later:
 *   pm2 start ecosystem.config.cjs --only oms-email-queue-cron
 */
const INTERVAL_MS = Number(process.env.EMAIL_CRON_INTERVAL_MS || "60000");
const APP_URL = (
  process.env.EMAIL_CRON_APP_URL ||
  process.env.APP_URL ||
  ""
).replace(/\/$/, "");
const CRON_SECRET = process.env.CRON_SECRET || "";

if (!APP_URL) {
  console.error("[email-queue-cron] Missing APP_URL or EMAIL_CRON_APP_URL");
  process.exit(1);
}
if (!CRON_SECRET) {
  console.error("[email-queue-cron] Missing CRON_SECRET");
  process.exit(1);
}

const endpoint = `${APP_URL}/api/bulk-notify/process`;

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
      `[email-queue-cron] ${res.status} ${Date.now() - started}ms ${body.slice(0, 400)}`,
    );
  } catch (err) {
    console.error(
      `[email-queue-cron] fetch failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}

console.log(
  `[email-queue-cron] starting → ${endpoint} every ${INTERVAL_MS}ms`,
);
tick();
setInterval(tick, INTERVAL_MS);
