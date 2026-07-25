/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { enqueueCustomerEmails, buildRecipientOrderData } from "../lib/email-queue.server";

// ─── POST — enqueue bulk email job (queue only — cron/worker sends) ───────────

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
      filters?: Record<string, any>;
      performedBy?: string;
    };

    if (!body.subject || !body.body || !body.recipients?.length) {
      return Response.json({ ok: false, error: "Missing subject, body, or recipients" }, { status: 400 });
    }

    const performedBy = body.performedBy || "admin";

    const recipients = await Promise.all(
      body.recipients.map(async (r) => ({
        ...r,
        orderData: {
          subject: body.subject,
          body: body.body,
          recipient: r.email,
          orderName: r.orderName,
          ...(await buildRecipientOrderData(shop, r.orderId, r.variantId, {
            filters: body.filters ?? {},
          })),
        },
      })),
    );

    const job = await enqueueCustomerEmails({
      shop,
      subject: body.subject,
      body: body.body,
      sentBy: performedBy,
      recipients,
      filters: body.filters,
    });

    if (!job) {
      return Response.json({ ok: false, error: "No valid email recipients" }, { status: 400 });
    }

    const created = await prisma.bulkEmailJob.findUnique({ where: { id: job.jobId } });
    const [queuePosition, activeCount] = await Promise.all([
      prisma.bulkEmailJob.count({
        where: { shop, status: "PENDING", createdAt: { lt: created!.createdAt } },
      }),
      prisma.bulkEmailJob.count({
        where: { shop, status: { in: ["PENDING", "PROCESSING"] } },
      }),
    ]);

    return Response.json({
      ok: true,
      jobId: job.jobId,
      total: job.recipientCount,
      queuePosition,
      activeCount,
    });
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
