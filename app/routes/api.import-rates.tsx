import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { importRatesCsv } from "../models/freight.server";

type UploadJob = {
  shop: string;
  created: number;
  updated: number;
  createdAt: number;
};

const uploads = new Map<string, UploadJob>();

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [id, entry] of uploads) {
    if (entry.createdAt < cutoff) uploads.delete(id);
  }
}, 30 * 60 * 1000);

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  let session;
  try {
    ({ session } = await authenticate.admin(request));
  } catch {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!session?.shop) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      intent?: "init" | "chunk" | "commit";
      uploadId?: string;
      csv?: string;
    };

    if (body.intent === "init") {
      const id = crypto.randomUUID();
      uploads.set(id, { shop: session.shop, created: 0, updated: 0, createdAt: Date.now() });
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
      if (entry.shop !== session.shop) {
        return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
      const csv = body.csv ?? "";
      if (!csv.trim()) {
        return Response.json({
          ok: true,
          created: 0,
          updated: 0,
          createdTotal: entry.created,
          updatedTotal: entry.updated,
        });
      }
      const result = await importRatesCsv(session.shop, csv);
      if (!result.ok) {
        return Response.json(result, { status: 400 });
      }
      entry.created += result.created ?? 0;
      entry.updated += result.updated ?? 0;
      return Response.json({
        ok: true,
        created: result.created ?? 0,
        updated: result.updated ?? 0,
        createdTotal: entry.created,
        updatedTotal: entry.updated,
        message: result.message,
      });
    }

    if (body.intent === "commit") {
      if (!body.uploadId) {
        return Response.json({ ok: false, error: "Missing uploadId" }, { status: 400 });
      }
      const entry = uploads.get(body.uploadId);
      if (!entry) {
        return Response.json({ ok: false, error: "Upload not found or expired" }, { status: 404 });
      }
      if (entry.shop !== session.shop) {
        return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
      const created = entry.created;
      const updated = entry.updated;
      uploads.delete(body.uploadId);
      return Response.json({
        ok: true,
        created,
        updated,
        message: `${created} rates created, ${updated} rates updated`,
      });
    }

    return Response.json({ ok: false, error: "Invalid intent" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed";
    console.error("[import-rates] Error:", message);
    return Response.json({ ok: false, message }, { status: 500 });
  }
}
