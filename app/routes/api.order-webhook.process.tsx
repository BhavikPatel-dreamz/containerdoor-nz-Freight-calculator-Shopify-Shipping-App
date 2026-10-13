import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { processQueuedOrderWebhookJobs } from "../lib/order-webhook.server";
import { cronUnauthorized, verifyCronSecret } from "../lib/cron-auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  if (!verifyCronSecret(request)) {
    return cronUnauthorized(request);
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || "10");
  return Response.json(await processQueuedOrderWebhookJobs(Number.isFinite(limit) && limit > 0 ? limit : 10));
}

export async function action({ request }: ActionFunctionArgs) {
  if (!verifyCronSecret(request)) {
    return cronUnauthorized(request);
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || "10");
  return Response.json(await processQueuedOrderWebhookJobs(Number.isFinite(limit) && limit > 0 ? limit : 10));
}
