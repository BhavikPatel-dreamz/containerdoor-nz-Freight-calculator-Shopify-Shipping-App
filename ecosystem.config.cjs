/**
 * PM2 ecosystem — ContainerDoor OMS (AWS / self-host ready).
 *
 * Apps:
 *   1. oms-web              — React Router production server
 *   2. oms-email-queue-cron — polls GET /api/bulk-notify/process every minute
 *
 * Vercel Hobby cannot run minutely crons; on AWS run both via PM2.
 *
 * ── First-time on AWS ───────────────────────────────────────────────────────
 *   1. Clone repo, copy .env (SHOPIFY_*, DATABASE_URL, CRON_SECRET, APP_URL, RESEND_…)
 *   2. pnpm install --frozen-lockfile
 *   3. pnpm run build          # prisma generate + migrate + react-router build
 *   4. pm2 start ecosystem.config.cjs
 *   5. pm2 save && pm2 startup
 *
 * ── Start only one app ──────────────────────────────────────────────────────
 *   pm2 start ecosystem.config.cjs --only oms-web
 *   pm2 start ecosystem.config.cjs --only oms-email-queue-cron
 *
 * ── Useful ──────────────────────────────────────────────────────────────────
 *   pm2 status | logs | restart oms-web | stop oms-email-queue-cron
 *
 * Required env (web): PORT (default 3000), DATABASE_URL, Shopify app secrets
 * Required env (cron): APP_URL (public URL of oms-web), CRON_SECRET
 * Optional: EMAIL_CRON_INTERVAL_MS, EMAIL_BATCH_SIZE, RESEND_API_KEY / SMTP_*
 *
 * Note: cron can point APP_URL at this same host (http://127.0.0.1:3000)
 * or the public HTTPS URL behind nginx/ALB.
 */
module.exports = {
  apps: [
    {
      name: "oms-web",
      cwd: __dirname,
      script: "node_modules/.bin/react-router-serve",
      args: "./build/server/index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      kill_timeout: 5000,
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
    },
    {
      name: "oms-email-queue-cron",
      cwd: __dirname,
      script: "scripts/email-queue-cron.mjs",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "150M",
      // Starts with `pm2 start ecosystem.config.cjs` — stop if you only want web:
      //   pm2 stop oms-email-queue-cron
      env: {
        NODE_ENV: "production",
        // Prefer loopback when cron runs on the same box as oms-web
        EMAIL_CRON_APP_URL: "http://127.0.0.1:3000",
        EMAIL_CRON_INTERVAL_MS: "60000",
      },
    },
    {
      name: "oms-order-webhook-cron",
      cwd: __dirname,
      script: "scripts/order-webhook-cron.mjs",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "150M",
      env: {
        NODE_ENV: "production",
        ORDER_WEBHOOK_CRON_APP_URL: "http://127.0.0.1:3000",
        ORDER_WEBHOOK_CRON_INTERVAL_MS: "30000",
      },
    },
  ],
};
