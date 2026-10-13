import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { cronUnauthorized, verifyCronSecret } from "../lib/cron-auth.server";
import { pruneClosedMondayItems } from "../lib/monday-prune.server";

function envShop(): string {
  return String(process.env.ORDER_SYNC_SHOP || process.env.SHOPIFY_SHOP || process.env.SHOP || "").trim();
}

function flag(value: unknown, fallback = false) {
  if (value == null || value === "") return fallback;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function run(request: Request) {
  if (!verifyCronSecret(request)) return cronUnauthorized(request);
  const url = new URL(request.url);
  const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
  const shop = String(body.shop || url.searchParams.get("shop") || envShop()).trim();
  const dryRun = String(body.dryRun ?? url.searchParams.get("dryRun") ?? "1") !== "0";
  const limit = Number(body.limit || url.searchParams.get("limit") || 50);
  const fromBoard = flag(body.fromBoard ?? url.searchParams.get("fromBoard"), false);
  const dropUnmatched = flag(body.dropUnmatched ?? url.searchParams.get("dropUnmatched"), false);
  const cursor = String(body.cursor ?? url.searchParams.get("cursor") ?? "").trim() || null;
  const scanLimit = Number(body.scanLimit || url.searchParams.get("scanLimit") || 400);
  return Response.json({
    pruneVersion: 2,
    ...(await pruneClosedMondayItems({
      shop,
      dryRun,
      limit,
      fromBoard,
      dropUnmatched,
      cursor,
      scanLimit,
    })),
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  return run(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return run(request);
}
