/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { tryGetEmailProvider } from "../lib/email-providers.server";
import { finalizeQueuedEmailLog } from "../lib/communication-log.server";
import { authenticate } from "../shopify.server";

// ─── Cron Worker — process pending bulk email jobs from OUR queue tables ──────
// Tables: BulkEmailJob + BulkEmailRecipient → send → update CommunicationLog
// Hit via:
//   - Vercel Cron GET /api/bulk-notify/process (Authorization: Bearer CRON_SECRET)
//   - External cron POST with CRON_SECRET
//   - Admin session POST (embedded app kick while queue chip polls)
// Auth: Bearer CRON_SECRET, X-Cron-Secret, or Shopify admin session.

const BATCH_SIZE = Number(process.env.EMAIL_BATCH_SIZE || "50");
const STUCK_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes — auto-fail stuck jobs

function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get("Authorization") ?? request.headers.get("X-Cron-Secret");
  return authHeader === `Bearer ${secret}` || authHeader === secret;
}

async function authorizeWorker(request: Request): Promise<{ ok: boolean; shop?: string }> {
  if (verifyCronSecret(request)) return { ok: true };
  // Allow embedded admin to kick the queue worker (local tunnel / no cron yet)
  try {
    const { session } = await authenticate.admin(request);
    return { ok: true, shop: session.shop };
  } catch {
    return { ok: false };
  }
}

// ─── POST — process next batch, cancel, retry, or resume ────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const auth = await authorizeWorker(request);
  if (!auth.ok) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as { command?: string; jobId?: string };

  if (body.command === "cancel" && body.jobId) return cancelJob(body.jobId);
  if (body.command === "retry" && body.jobId) return retryJob(body.jobId);
  if (body.command === "resume" && body.jobId) return resumeJob(body.jobId);

  return processNextBatch(auth.shop);
}

type ClaimedRecipient = {
  id: string;
  jobId: string;
  email: string;
  name: string;
  orderName: string;
  orderId: string;
  variantId: string;
  orderData: any;
};

function renderTemplate(template: string, recipient: ClaimedRecipient, appUrl: string) {
  const od = (recipient.orderData ?? {}) as Record<string, string>;
  return template
    .replace(/\{name\}/g, recipient.name)
    .replace(/\{order\}/g, recipient.orderName)
    .replace(/\{link\}/g, `${appUrl}/app/order/${recipient.orderId}`)
    .replace(/\{supplier\}/g, od.supplier || "")
    .replace(/\{edd\}/g, od.edd || "")
    .replace(/\{carrier\}/g, od.carrier || "")
    .replace(/\{tracking\}/g, od.trackingNumber || "")
    .replace(/\{product\}/g, od.productName || od.product || "")
    .replace(/\{product_name\}/g, od.productName || od.product || "")
    .replace(/\{variants\}/g, od.variants || od.variant || "")
    .replace(/\{variant\}/g, od.variants || od.variant || "");
}

function toHtml(text: string) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const linked = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  const withParagraphs = linked.replace(/\r?\n\r?\n/g, "<br><br>");
  const body = withParagraphs.replace(/\r?\n/g, "<br>");
  return `<div style="max-width:600px;margin:0 auto;padding:24px 32px;line-height:1.6;color:#333;font-size:15px;">${body}</div>`;
}

// ─── Cancel ─────────────────────────────────────────────────────────────────

async function cancelJob(jobId: string) {
  const job = await prisma.bulkEmailJob.findUnique({ where: { id: jobId } });
  if (!job) return Response.json({ ok: false, error: "Job not found" }, { status: 404 });
  if (job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED") {
    return Response.json({ ok: false, error: "Job already finished" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.bulkEmailRecipient.updateMany({
      where: { jobId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    await tx.bulkEmailJob.update({
      where: { id: jobId },
      data: { status: "CANCELLED", error: "Cancelled by user", completedAt: new Date() },
    });
    await tx.communicationLog.updateMany({
      where: { jobId, activityType: "email", deliveryStatus: "pending" },
      data: { deliveryStatus: "failed" },
    });
  });

  return Response.json({ ok: true, message: "Job cancelled" });
}

// ─── Retry (re-queue only failed/cancelled recipients) ──────────────────────

async function retryJob(jobId: string) {
  const job = await prisma.bulkEmailJob.findUnique({ where: { id: jobId } });
  if (!job) return Response.json({ ok: false, error: "Job not found" }, { status: 404 });
  if (job.status === "PROCESSING") {
    return Response.json({ ok: false, error: "Job is currently running" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    // Reset FAILED + CANCELLED recipients back to PENDING
    await tx.bulkEmailRecipient.updateMany({
      where: { jobId, status: { in: ["FAILED", "CANCELLED"] } },
      data: { status: "PENDING", error: null, sentAt: null },
    });

    const recount = await tx.bulkEmailRecipient.groupBy({
      by: ["status"],
      where: { jobId },
      _count: true,
    });

    const sentCount = recount.find((r) => r.status === "SENT")?._count ?? 0;

    await tx.bulkEmailJob.update({
      where: { id: jobId },
      data: {
        status: "PENDING",
        error: null,
        sentCount,
        failedCount: 0,
        startedAt: null,
        completedAt: null,
      },
    });
  });

  return Response.json({ ok: true, message: "Job reset to PENDING — will be picked up by next cron run" });
}

// ─── Resume (continue a COMPLETED/FAILED job from where it left off) ────────

async function resumeJob(jobId: string) {
  const job = await prisma.bulkEmailJob.findUnique({ where: { id: jobId } });
  if (!job) return Response.json({ ok: false, error: "Job not found" }, { status: 404 });
  if (job.status === "PROCESSING" || job.status === "PENDING") {
    return Response.json({ ok: false, error: "Job is already active" }, { status: 400 });
  }

  // Only resume if there are still PENDING recipients
  const pendingCount = await prisma.bulkEmailRecipient.count({
    where: { jobId, status: "PENDING" },
  });

  if (pendingCount === 0) {
    return Response.json({ ok: false, error: "No pending recipients left to process" }, { status: 400 });
  }

  await prisma.bulkEmailJob.update({
    where: { id: jobId },
    data: { status: "PENDING", error: null, completedAt: null },
  });

  return Response.json({ ok: true, message: `Job resumed — ${pendingCount} recipients remaining` });
}

// ─── Process next batch ──────────────────────────────────────────────────────

async function processNextBatch(shopFilter?: string) {
  try {
    const providerSetup = tryGetEmailProvider();
    if ("error" in providerSetup) {
      // Don't 500 the OMS poller — surface config error clearly
      return Response.json(
        {
          ok: false,
          error: providerSetup.error,
          hint: "Set EMAIL_PROVIDER + API key (e.g. RESEND_API_KEY) then retry. Queue jobs stay PENDING.",
        },
        { status: 503 },
      );
    }
    const { provider, fromEmail } = providerSetup;

    // ── Step 1: Auto-fail stuck jobs ──
    const stuckThreshold = new Date(Date.now() - STUCK_TIMEOUT_MS);
    const stuckJobs = await prisma.bulkEmailJob.findMany({
      where: {
        status: "PROCESSING",
        startedAt: { lt: stuckThreshold },
        ...(shopFilter ? { shop: shopFilter } : {}),
      },
    });

    for (const stuck of stuckJobs) {
      const recentSent = await prisma.bulkEmailRecipient.count({
        where: { jobId: stuck.id, status: "SENT", sentAt: { gte: stuckThreshold } },
      });
      if (recentSent === 0) {
        await prisma.bulkEmailJob.update({
          where: { id: stuck.id },
          data: { status: "FAILED", error: `Stuck — no progress for ${STUCK_TIMEOUT_MS / 60000} min`, completedAt: new Date() },
        });
        await prisma.bulkEmailRecipient.updateMany({
          where: { jobId: stuck.id, status: "PENDING" },
          data: { status: "FAILED", error: "Job stuck with no progress" },
        });
        // Mark pending CommunicationLog rows failed too
        await prisma.communicationLog.updateMany({
          where: { jobId: stuck.id, activityType: "email", deliveryStatus: "pending" },
          data: { deliveryStatus: "failed" },
        });
      }
    }

    // ── Step 2: Find next job (oldest PENDING, or resume PROCESSING) ──
    const claimRows = shopFilter
      ? await prisma.$queryRawUnsafe<ClaimedRecipient[]>(`
      WITH next_job AS (
        SELECT "id"
        FROM "BulkEmailJob"
        WHERE "status" IN ('PENDING', 'PROCESSING') AND "shop" = $3
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      ),
      mark_job AS (
        UPDATE "BulkEmailJob"
        SET "status" = 'PROCESSING',
            "startedAt" = COALESCE("startedAt", NOW()),
            "provider" = $1,
            "updatedAt" = NOW()
        WHERE "id" IN (SELECT "id" FROM next_job)
        RETURNING "id"
      ),
      claim_recipients AS (
        SELECT "id"
        FROM "BulkEmailRecipient"
        WHERE "jobId" IN (SELECT "id" FROM next_job)
          AND "status" = 'PENDING'
        ORDER BY "createdAt" ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "BulkEmailRecipient"
      SET "status" = 'PROCESSING'
      WHERE "id" IN (SELECT "id" FROM claim_recipients)
      RETURNING "id", "jobId", "email", "name", "orderName", "orderId", "variantId", "orderData"
    `, provider.name, BATCH_SIZE, shopFilter)
      : await prisma.$queryRawUnsafe<ClaimedRecipient[]>(`
      WITH next_job AS (
        SELECT "id"
        FROM "BulkEmailJob"
        WHERE "status" IN ('PENDING', 'PROCESSING')
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      ),
      mark_job AS (
        UPDATE "BulkEmailJob"
        SET "status" = 'PROCESSING',
            "startedAt" = COALESCE("startedAt", NOW()),
            "provider" = $1,
            "updatedAt" = NOW()
        WHERE "id" IN (SELECT "id" FROM next_job)
        RETURNING "id"
      ),
      claim_recipients AS (
        SELECT "id"
        FROM "BulkEmailRecipient"
        WHERE "jobId" IN (SELECT "id" FROM next_job)
          AND "status" = 'PENDING'
        ORDER BY "createdAt" ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "BulkEmailRecipient"
      SET "status" = 'PROCESSING'
      WHERE "id" IN (SELECT "id" FROM claim_recipients)
      RETURNING "id", "jobId", "email", "name", "orderName", "orderId", "variantId", "orderData"
    `, provider.name, BATCH_SIZE);

    const jobId = claimRows[0]?.jobId;
    const job = jobId
      ? await prisma.bulkEmailJob.findUnique({ where: { id: jobId } })
      : null;

    if (!job) {
      await finalizeDrainedJobs();
      return Response.json({ ok: true, message: "No pending jobs" });
    }

    const appUrl = process.env.APP_URL || "https://containerdoor-nz-freight-calculator.vercel.app";

    // ── Step 3: Send batch via provider (only from our queue tables) ──
    let sent = 0;
    let failed = 0;

    for (const r of claimRows) {
      try {
        const personalizedBody = renderTemplate(job.body, r, appUrl);
        const personalizedSubject = renderTemplate(job.subject, r, appUrl);

        const result = await provider.send({
          from: fromEmail,
          to: r.email,
          subject: personalizedSubject,
          text: personalizedBody,
          html: toHtml(personalizedBody),
        });

        if (!result.success) throw new Error(result.error || "Send failed");

        await prisma.bulkEmailRecipient.update({
          where: { id: r.id },
          data: { status: "SENT", sentAt: new Date(), error: null },
        });

        await finalizeQueuedEmailLog({
          shop: job.shop,
          jobId: job.id,
          orderId: r.orderId,
          variantId: r.variantId,
          recipientEmail: r.email,
          recipientName: r.name,
          subject: personalizedSubject,
          body: personalizedBody,
          sentBy: job.sentBy ?? "system",
          deliveryStatus: "sent",
          providerMessageId: result.id,
          recipientId: r.id,
        }).catch((e: any) => console.error("[BulkNotifyWorker] CommunicationLog finalize failed", e));

        sent++;
      } catch (e: any) {
        failed++;
        await prisma.bulkEmailRecipient.update({
          where: { id: r.id },
          data: { status: "FAILED", error: e.message || "Unknown error" },
        });
        await finalizeQueuedEmailLog({
          shop: job.shop,
          jobId: job.id,
          orderId: r.orderId,
          variantId: r.variantId,
          recipientEmail: r.email,
          recipientName: r.name,
          subject: job.subject,
          body: job.body,
          sentBy: job.sentBy ?? "system",
          deliveryStatus: "failed",
          error: e.message || "Unknown error",
          recipientId: r.id,
        }).catch((err: any) => console.error("[BulkNotifyWorker] CommunicationLog fail-log failed", err));
      }
    }

    // ── Step 4: Update job counters ──
    await prisma.bulkEmailJob.update({
      where: { id: job.id },
      data: { sentCount: { increment: sent }, failedCount: { increment: failed }, updatedAt: new Date() },
    });

    // ── Step 5: Check if job is complete ──
    const remaining = await prisma.bulkEmailRecipient.count({
      where: { jobId: job.id, status: "PENDING" },
    });

    if (remaining === 0) {
      await prisma.bulkEmailJob.update({
        where: { id: job.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }

    // Count queued jobs behind this one + active count
    const [queuedBehind, activeCount] = await Promise.all([
      prisma.bulkEmailJob.count({ where: { status: "PENDING", createdAt: { gt: job.createdAt } } }),
      prisma.bulkEmailJob.count({ where: { shop: job.shop, status: { in: ["PENDING", "PROCESSING"] } } }),
    ]);

    return Response.json({
      ok: true,
      jobId: job.id,
      processed: sent + failed,
      sent,
      failed,
      remaining,
      jobStatus: remaining === 0 ? "COMPLETED" : "PROCESSING",
      queuedBehind,
      activeCount,
      provider: provider.name,
    });
  } catch (e: any) {
    console.error("[BulkNotifyWorker] Error:", e);
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

async function finalizeDrainedJobs() {
  const activeJobs = await prisma.bulkEmailJob.findMany({
    where: { status: { in: ["PENDING", "PROCESSING"] } },
    select: { id: true },
    take: 10,
  });

  for (const activeJob of activeJobs) {
    const remaining = await prisma.bulkEmailRecipient.count({
      where: { jobId: activeJob.id, status: "PENDING" },
    });
    if (remaining === 0) {
      await prisma.bulkEmailJob.update({
        where: { id: activeJob.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }
  }
}

// ─── GET — Vercel Cron worker OR admin job status ────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  // Vercel Cron sends GET with Authorization: Bearer <CRON_SECRET>
  if (verifyCronSecret(request)) {
    return processNextBatch();
  }

  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  const shop = url.searchParams.get("shop");

  // Single job status: admin-authenticated because recipients contain customer data.
  if (jobId) {
    const job = await prisma.bulkEmailJob.findUnique({
      where: { id: jobId },
      include: { recipients: { orderBy: { createdAt: "asc" } } },
    });
    if (!job) return Response.json({ ok: false, error: "Job not found" }, { status: 404 });
    if (job.shop !== session.shop) return Response.json({ ok: false, error: "Not found" }, { status: 404 });

    const [queuePosition, activeCount] = await Promise.all([
      job.status === "PENDING"
        ? prisma.bulkEmailJob.count({ where: { status: "PENDING", createdAt: { lt: job.createdAt } } })
        : Promise.resolve(0),
      prisma.bulkEmailJob.count({ where: { shop: job.shop, status: { in: ["PENDING", "PROCESSING"] } } }),
    ]);

    return Response.json({ ok: true, job, queuePosition, activeCount });
  }

  // List recent jobs + active count for a shop
  if (shop) {
    if (shop !== session.shop) return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    const [jobs, activeCount] = await Promise.all([
      prisma.bulkEmailJob.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { _count: { select: { recipients: true } } },
      }),
      prisma.bulkEmailJob.count({
        where: { shop, status: { in: ["PENDING", "PROCESSING"] } },
      }),
    ]);
    return Response.json({ ok: true, jobs, activeCount });
  }

  return Response.json({ ok: false, error: "Missing jobId or shop param" }, { status: 400 });
}
