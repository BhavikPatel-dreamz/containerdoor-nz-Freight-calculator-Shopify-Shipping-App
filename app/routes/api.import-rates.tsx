import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { importRatesCsv } from "../models/freight.server";

const uploads = new Map<string, { csv: string; created: number }>();

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, entry] of uploads) {
    if (entry.created < cutoff) uploads.delete(id);
  }
}, 30 * 60 * 1000);

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { session } = await authenticate.admin(request);
    const body = (await request.json()) as {
      intent?: "init" | "chunk" | "commit";
      uploadId?: string;
      csv?: string;
      chunkIndex?: number;
      totalChunks?: number;
    };

    if (body.intent === "init") {
      const id = crypto.randomUUID();
      uploads.set(id, { csv: "", created: Date.now() });
      return Response.json({ ok: true, uploadId: id });
    }

    if (body.intent === "chunk") {
      if (!body.uploadId) {
        return Response.json({ ok: false, error: "Missing uploadId" }, { status: 400 });
      }
      const entry = uploads.get(body.uploadId);
      if (!entry) {
        return Response.json({ ok: false, error: "Upload not found or expired" }, { status: 404 });
      }
      entry.csv += body.csv ?? "";
      return Response.json({ ok: true, uploadId: body.uploadId });
    }

    if (body.intent === "commit") {
      if (!body.uploadId) {
        return Response.json({ ok: false, error: "Missing uploadId" }, { status: 400 });
      }
      const entry = uploads.get(body.uploadId);
      if (!entry) {
        return Response.json({ ok: false, error: "Upload not found or expired" }, { status: 404 });
      }
      const csv = entry.csv;
      uploads.delete(body.uploadId);
      return await importRatesCsv(session.shop, csv);
    }

    return Response.json({ ok: false, error: "Invalid intent" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed";
    console.error("[import-rates] Error:", message);
    return Response.json({ ok: false, message }, { status: 500 });
  }
}
