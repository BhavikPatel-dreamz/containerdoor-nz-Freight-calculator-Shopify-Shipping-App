/**
 * PM2 ecosystem — ContainerDoor OMS (DigitalOcean / self-host).
 *
 * Apps:
 *   oms-web                 — React Router production server (PORT 3000)
 *   oms-email-queue-cron    — GET /api/bulk-notify/process every 60s
 *   oms-order-webhook-cron  — GET /api/order-webhook/process every 30s
 *   oms-order-sync-cron     — POST /api/order-sync-step (one order, then 10s)
 *
 * ── DigitalOcean droplet (first time) ───────────────────────────────────────
 *   1. Node 22, pnpm, pm2:  npm i -g pm2 pnpm
 *   2. Clone repo, copy .env onto the droplet
 *   3. In .env set at least:
 *        DATABASE_URL, SHOPIFY_*, CRON_SECRET, APP_URL
 *        ORDER_SYNC_SHOP=your-store.myshopify.com
 *   4. pnpm install --frozen-lockfile
 *   5. pnpm run setup && pnpm run build
 *   6. cd /path/to/app && pm2 start ecosystem.config.cjs
 *   7. pm2 save && pm2 startup
 *
 * Cron workers call 127.0.0.1:3000 with Authorization: Bearer CRON_SECRET.
 * Do not put the secret in the URL.
 *
 * Start / stop one job:
 *   pm2 start ecosystem.config.cjs --only oms-order-sync-cron
 *   pm2 stop oms-order-sync-cron
 *   pm2 logs oms-email-queue-cron
 */
module.exports = {
  apps: [
    {
      name: "oms-web",
      cwd: __dirname,
      script: "node_modules/@react-router/serve/dist/cli.js",
      args: "./build/server/index.js",
      interpreter: "node",
      interpreter_args: "--import ./scripts/preload-env.mjs",
      env_file: ".env",
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
      env: {
        NODE_ENV: "production",
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
    {
      name: "oms-order-sync-cron",
      cwd: __dirname,
      script: "scripts/order-sync-cron.mjs",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "150M",
      env: {
        NODE_ENV: "production",
        ORDER_SYNC_CRON_APP_URL: "http://127.0.0.1:3000",
        ORDER_SYNC_CRON_INTERVAL_MS: "10000",
        ORDER_SYNC_CRON_IDLE_MS: "300000",
      },
    },
  ],
};
