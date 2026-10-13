/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { applyFreightCsvImport, exportFreightCsv, previewFreightCsvImport } from "../lib/freight-csv.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      return Response.json({ ok: false, error: "Freight CSV import has been removed." }, { status: 410 });
    }

    const body = (await request.json()) as {
      kind?: "export";
      carrier?: string;
      items?: Array<{ orderId: string; variantId: string }>;
    };

    if (body.kind === "export") {
      if (!body.items?.length) {
        return Response.json({ ok: false, error: "No line items selected for export" }, { status: 400 });
      }
      if (!body.carrier) {
        return Response.json({ ok: false, error: "Select a carrier format for export" }, { status: 400 });
      }
      const { csv, skipped } = await exportFreightCsv(shop, body.carrier, body.items);
      return Response.json({ ok: true, csv, skipped });
    }

    return Response.json({ ok: false, error: "Unsupported freight CSV request" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Freight CSV request failed";
    console.error("[FreightCSV] Error:", message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
