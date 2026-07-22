/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { fetchMondayItem } from "../lib/monday.server";
import { pushLineItemToAllSystems } from "../lib/sync-middleware.server";

// ───────────────────────────────────────────────────────────────────────────
// Monday.com fires this webhook whenever a column value changes on an item
// (EDD, tracking number, customer status, etc). We pull the full fresh item
// from Monday and write only the fields that actually changed back into our
// DB — this is a one-directional PULL (Monday → app), so it never writes
// back to Monday and cannot create a sync loop.
//
// Register in Monday: Board → Integrations → Webhooks → "When a column
// changes" → POST to https://<your-app-domain>/api/monday-webhook
// ───────────────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  return new Response(null, { status: 405 });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── Monday's one-time webhook verification handshake ──
  // When you register the webhook, Monday POSTs { challenge: "..." } once.
  // Must echo it back unchanged or the webhook registration fails.
  if (body?.challenge) {
    return Response.json({ challenge: body.challenge });
  }

  const event = body?.event;
  if (!event) {
    // Not a column-change event we care about — ack quietly.
    return Response.json({ ok: true });
  }

  const boardId = String(event.boardId ?? "");
  const itemId = String(event.pulseId ?? "");

  if (!itemId) {
    return Response.json({ ok: true });
  }

  // Ignore events from other boards, if MONDAY_BOARD_ID is configured.
  if (process.env.MONDAY_BOARD_ID && boardId && boardId !== String(process.env.MONDAY_BOARD_ID)) {
    return Response.json({ ok: true });
  }

  try {
    // Find every local line item linked to this Monday item.
    const records = await prisma.orderLineItemOperationalData.findMany({
      where: { mondayItemId: itemId },
    });

    if (records.length === 0) {
      // Item isn't tracked locally (or hasn't been synced yet) — nothing to do.
      return Response.json({ ok: true });
    }

    // Pull the current, authoritative state of the item from Monday.
    const mondayData = await fetchMondayItem(itemId);
    if (!mondayData) {
      // Item deleted/archived/inactive on Monday's side — skip.
      return Response.json({ ok: true });
    }

    for (const record of records) {
      const updates: Record<string, any> = {};

      const newStatus = (mondayData.customerStatus ?? "").toLowerCase();
      if (newStatus && newStatus !== record.customerStatus) {
        updates.customerStatus = newStatus;
        updates.customerStatusUpdatedAt = new Date();
      }

      if (mondayData.eddDate && mondayData.eddDate !== record.eddDate) {
        updates.eddDate = mondayData.eddDate;
        updates.eddDateUpdatedAt = new Date();
      }

      if (mondayData.originalEddDate && mondayData.originalEddDate !== record.originalEddDate) {
        updates.originalEddDate = mondayData.originalEddDate;
      }

      if (mondayData.trackingNumber && mondayData.trackingNumber !== record.trackingNumber) {
        updates.trackingNumber = mondayData.trackingNumber;
        updates.trackingNumberUpdatedAt = new Date();
      }

      if (Object.keys(updates).length > 0) {
        await prisma.orderLineItemOperationalData.update({
          where: { id: record.id },
          data: updates,
        });
        console.log(
          `[Monday][Webhook] Updated shop=${record.shop} orderId=${record.orderId} variantId=${record.variantId}:`,
          updates,
        );

        // Push pulled changes to Shopify + Cin7 (fire-and-forget)
        pushLineItemToAllSystems(
          {
            shop: record.shop,
            orderId: record.orderId,
            variantId: record.variantId,
            ...(updates.eddDate !== undefined ? { eddDate: updates.eddDate } : {}),
            ...(updates.trackingNumber !== undefined ? { trackingNumber: updates.trackingNumber } : {}),
            ...(updates.customerStatus !== undefined ? { customerStatus: updates.customerStatus } : {}),
          },
          "monday",
        ).catch((e) =>
          console.error("[Monday][Webhook] Push to other systems failed:", e),
        );
      }
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("[Monday][Webhook] Error:", error);
    // Return 200 anyway — Monday retries aggressively on non-2xx and can
    // disable the webhook after repeated failures. Log and move on.
    return Response.json({ ok: false, error: String(error) });
  }
}