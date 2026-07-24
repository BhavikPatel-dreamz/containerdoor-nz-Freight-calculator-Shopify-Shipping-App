/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { processBulkActions } from "../lib/bulk-actions.server";

// ─── POST — execute bulk actions ─────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;
    const body = (await request.json()) as {
      items?: Array<{ orderId: string; variantId: string }>;
      actions?: {
        paymentStatus?: string;
        supplier?: string;
        note?: string;
        notify?: { subject: string; body: string };
      };
      performedBy?: string;
      filters?: Record<string, any>;
    };

    if (!body.items?.length || !body.actions) {
      return Response.json({ ok: false, error: "Missing items or actions" }, { status: 400 });
    }

    // Check if at least one action is defined
    const { paymentStatus, supplier, note, notify } = body.actions;
    if (!paymentStatus && !supplier && !note && !notify) {
      return Response.json({ ok: false, error: "No actions specified" }, { status: 400 });
    }

    const performedBy = body.performedBy || "CS";
    const result = await processBulkActions(shop, body.items, body.actions, performedBy, body.filters);

    return Response.json(result);
  } catch (e: any) {
    console.error("[BulkActions] Error:", e);
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
