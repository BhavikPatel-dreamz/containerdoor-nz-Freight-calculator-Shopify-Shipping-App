#!/usr/bin/env bash
# Apply Prisma migrations using a direct (non-PgBouncer) URL.
#
# Vercel: skip by default. Concurrent preview/prod builds plus killed
# migrate processes leave pg_advisory_lock(72707369) held on Neon, so
# `prisma migrate deploy` fails with P1002 and the whole deploy dies.
# The JS bundle only needs `prisma generate`. Apply SQL from a laptop
# or AWS: pnpm exec prisma migrate deploy
# Opt-in on Vercel: RUN_PRISMA_MIGRATE=1
set -euo pipefail

if [ "${VERCEL:-}" = "1" ] && [ "${RUN_PRISMA_MIGRATE:-}" != "1" ]; then
  echo "[prisma] skipping migrate deploy on Vercel build (set RUN_PRISMA_MIGRATE=1 to force)"
  exit 0
fi

resolve_direct_url() {
  if [ -n "${DIRECT_URL:-}" ]; then
    printf '%s' "$DIRECT_URL"
    return
  fi
  if [ -n "${DATABASE_URL_UNPOOLED:-}" ]; then
    printf '%s' "$DATABASE_URL_UNPOOLED"
    return
  fi
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is not set" >&2
    exit 1
  fi
  node --input-type=module -e '
    const raw = process.env.DATABASE_URL;
    try {
      const u = new URL(raw);
      u.hostname = u.hostname.replace(/-pooler(?=\.|$)/, "");
      u.searchParams.delete("pgbouncer");
      process.stdout.write(u.toString());
    } catch {
      process.stdout.write(raw);
    }
  '
}

export DATABASE_URL
DATABASE_URL="$(resolve_direct_url)"

attempts="${PRISMA_MIGRATE_ATTEMPTS:-5}"
delay="${PRISMA_MIGRATE_RETRY_SECONDS:-8}"
i=1
while [ "$i" -le "$attempts" ]; do
  echo "[prisma] migrate deploy attempt ${i}/${attempts} (direct / unpooled URL)"
  if pnpm exec prisma migrate deploy; then
    exit 0
  fi
  if [ "$i" -eq "$attempts" ]; then
    echo "[prisma] migrate deploy failed after ${attempts} attempts" >&2
    echo "Set Vercel env DIRECT_URL (or DATABASE_URL_UNPOOLED) to the Neon non-pooler connection string." >&2
    exit 1
  fi
  echo "[prisma] retrying in ${delay}s (advisory lock or Neon timeout)..."
  sleep "$delay"
  i=$((i + 1))
done
