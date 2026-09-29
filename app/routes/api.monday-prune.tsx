import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { cronUnauthorized, verifyCronSecret } from "../lib/cron-auth.server";
import { pruneClosedMondayItems } from "../lib/monday-prune.server";

function envShop(): string {
  return String(process.env.ORDER_SYNC_SHOP || process.env.SHOPIFY_SHOP || process.env.SHOP || "").trim();
}

async function run(request: Request) {
  if (!verifyCronSecret(request)) return cronUnauthorized(request);
  const url = new URL(request.url);
  const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
  const shop = String(body.shop || url.searchParams.get("shop") || envShop()).trim();
  const dryRun = String(body.dryRun ?? url.searchParams.get("dryRun") ?? "1") !== "0";
  const limit = Number(body.limit || url.searchParams.get("limit") || 50);
  return Response.json(await pruneClosedMondayItems({ shop, dryRun, limit }));
}

export async function loader({ request }: LoaderFunctionArgs) {
  return run(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return run(request);
}
