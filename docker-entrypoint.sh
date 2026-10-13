#!/bin/sh
set -e

ROLE="${1:-web}"

case "$ROLE" in
  web)
    echo "[docker] prisma migrate deploy"
    pnpm exec prisma migrate deploy
    echo "[docker] starting oms-web on PORT=${PORT:-3000}"
    exec pnpm start
    ;;
  email-cron)
    echo "[docker] starting email queue cron"
    exec node scripts/email-queue-cron.mjs
    ;;
  webhook-cron)
    echo "[docker] starting order webhook cron"
    exec node scripts/order-webhook-cron.mjs
    ;;
  *)
    echo "Unknown role: $ROLE (use web | email-cron | webhook-cron)" >&2
    exit 1
    ;;
esac
