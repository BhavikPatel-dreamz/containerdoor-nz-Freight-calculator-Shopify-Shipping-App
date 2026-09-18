import { timingSafeEqual } from "node:crypto";

function normalizeSecret(value: string | undefined | null): string {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\r/g, "");
}

/** Runtime lookup — avoid Vite inlining `process.env.CRON_SECRET` at build time. */
export function getCronSecret(): string {
  const env = process.env;
  const key = ["CRON", "SECRET"].join("_");
  return normalizeSecret(env[key]);
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifyCronSecret(request: Request): boolean {
  const secret = getCronSecret();
  if (!secret) return false;

  const authHeader = normalizeSecret(
    request.headers.get("Authorization") ?? request.headers.get("authorization"),
  );
  const xHeader = normalizeSecret(
    request.headers.get("X-Cron-Secret") ?? request.headers.get("x-cron-secret"),
  );

  if (authHeader && (safeEqual(authHeader, `Bearer ${secret}`) || safeEqual(authHeader, secret))) {
    return true;
  }
  if (xHeader && safeEqual(xHeader, secret)) return true;

  const url = new URL(request.url);
  const querySecret = normalizeSecret(url.searchParams.get("secret"));
  return Boolean(querySecret) && safeEqual(querySecret, secret);
}

export function cronUnauthorized(request: Request) {
  const secret = getCronSecret();
  const hasHeader = Boolean(
    request.headers.get("Authorization") || request.headers.get("X-Cron-Secret"),
  );
  const hint = !secret
    ? "oms-web has no CRON_SECRET — add it to .env and pm2 restart oms-web"
    : !hasHeader
      ? "request missing Authorization Bearer CRON_SECRET"
      : "CRON_SECRET on oms-web does not match the cron process";
  console.warn(
    `[cron-auth] unauthorized secretConfigured=${Boolean(secret)} secretLen=${secret.length} header=${hasHeader}`,
  );
  return Response.json({ ok: false, error: "Unauthorized", hint }, { status: 401 });
}
