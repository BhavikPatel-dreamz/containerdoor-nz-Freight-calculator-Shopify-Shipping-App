/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  applyOrderAmendment,
  getOrderAmendmentDraft,
} from "../lib/order-amendments.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "";
  const orderId = url.searchParams.get("orderId") || "";
  const variantId = url.searchParams.get("variantId") || undefined;
  if (!shop || !orderId) {
    return Response.json(
      { ok: false, error: "Missing shop or orderId" },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  const draft = await getOrderAmendmentDraft(shop, orderId, variantId);
  if (!draft) {
    return Response.json(
      { ok: false, error: "Order not found" },
      { status: 404, headers: CORS_HEADERS },
    );
  }
  return Response.json({ ok: true, draft }, { headers: CORS_HEADERS });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return Response.json(
      { ok: false, error: "Method not allowed" },
      { status: 405, headers: CORS_HEADERS },
    );
  }

  try {
    const body = (await request.json()) as {
      shop?: string;
      orderId?: string;
      variantId?: string;
      performedBy?: string;
      contact?: {
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
      };
      address?: {
        firstName?: string;
        lastName?: string;
        address1?: string;
        address2?: string;
        city?: string;
        province?: string;
        zip?: string;
        country?: string;
        phone?: string;
      };
      deliveryInstructions?: string;
      cancelLineItem?: boolean;
      cancelOrder?: boolean;
    };

    const shop = String(body.shop || "").trim();
    const orderId = String(body.orderId || "").trim();
    const performedBy = String(body.performedBy || "SY").trim() || "SY";

    if (!shop || !orderId) {
      return Response.json(
        { ok: false, error: "Missing shop or orderId" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const result = await applyOrderAmendment({
      shop,
      orderId,
      variantId: body.variantId,
      performedBy,
      contact: body.contact,
      address: body.address,
      deliveryInstructions: body.deliveryInstructions,
      cancelLineItem: Boolean(body.cancelLineItem),
      cancelOrder: Boolean(body.cancelOrder),
    });

    if (!result.ok) {
      return Response.json(result, { status: 400, headers: CORS_HEADERS });
    }
    return Response.json(result, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("[api.order-amendments]", err);
    return Response.json(
      { ok: false, error: String(err) },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
