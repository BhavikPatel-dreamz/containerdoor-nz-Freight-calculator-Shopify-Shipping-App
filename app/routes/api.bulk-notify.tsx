/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

// ─── POST — enqueue bulk email job ────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;
    const body = (await request.json()) as {
      subject?: string;
      body?: string;
      recipients?: Array<{ email: string; name: string; orderName: string; orderId: string; variantId: string }>;
      filters?: Record<string, any>; // snapshot of active filters at time of send
    };

    if (!body.subject || !body.body || !body.recipients?.length) {
      return Response.json({ ok: false, error: "Missing subject, body, or recipients" }, { status: 400 });
    }

    const job = await prisma.$transaction(async (tx) => {
      const j = await tx.bulkEmailJob.create({
        data: {
          shop,
          subject: body.subject!,
          body: body.body!,
          filters: body.filters ?? undefined,
          totalRecipients: body.recipients!.length,
        },
      });

      await tx.bulkEmailRecipient.createMany({
        data: body.recipients!.map((r) => ({
          jobId: j.id,
          email: r.email,
          name: r.name,
          orderName: r.orderName,
          orderId: r.orderId,
          variantId: r.variantId,
        })),
      });

      return j;
    });

    const [queuePosition, activeCount] = await Promise.all([
      prisma.bulkEmailJob.count({
        where: { shop, status: "PENDING", createdAt: { lt: job.createdAt } },
      }),
      prisma.bulkEmailJob.count({
        where: { shop, status: { in: ["PENDING", "PROCESSING"] } },
      }),
    ]);

    return Response.json({ ok: true, jobId: job.id, total: job.totalRecipients, queuePosition, activeCount });
  } catch (e: any) {
    console.error("[BulkNotify] Action error:", e);
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// ─── GET — check provider config ─────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const provider = process.env.EMAIL_PROVIDER || "resend";
  let configured = false;
  switch (provider) {
    case "resend": configured = Boolean(process.env.RESEND_API_KEY); break;
    case "smtp": configured = Boolean(process.env.SMTP_HOST); break;
    case "sendgrid": configured = Boolean(process.env.SENDGRID_API_KEY); break;
    case "postmark": configured = Boolean(process.env.POSTMARK_SERVER_TOKEN); break;
    case "mailgun": configured = Boolean(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN); break;
    default: configured = Boolean(process.env.RESEND_API_KEY);
  }
  return Response.json({ configured, provider });
}
