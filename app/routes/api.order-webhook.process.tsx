import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { processQueuedOrderWebhookJobs } from "../lib/order-webhook.server";

function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  // Check header first
  const authHeader = request.headers.get("Authorization") ?? request.headers.get("X-Cron-Secret");
  if (authHeader === `Bearer ${secret}` || authHeader === secret) {
    return true;
  }

  // Fall back to query parameter
  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret");
  return querySecret === secret;
}

export async function loader({ request }: LoaderFunctionArgs) {
  // TODO: Re-enable auth once CRON_SECRET env var issue is resolved on Vercel
  // if (!verifyCronSecret(request)) {
  //   return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  // }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || "10");
  return Response.json(await processQueuedOrderWebhookJobs(Number.isFinite(limit) && limit > 0 ? limit : 10));
}

export async function action({ request }: ActionFunctionArgs) {
  // TODO: Re-enable auth once CRON_SECRET env var issue is resolved on Vercel
  // if (!verifyCronSecret(request)) {
  //   return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  // }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || "10");
  return Response.json(await processQueuedOrderWebhookJobs(Number.isFinite(limit) && limit > 0 ? limit : 10));
}
