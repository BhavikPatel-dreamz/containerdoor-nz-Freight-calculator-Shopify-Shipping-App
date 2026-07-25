/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from "../db.server";
import type { Prisma } from "@prisma/client";

/** Central activity types — extend freely; no schema redesign needed. */
export type ActivityType =
  | "email"
  | "internal_note"
  | "monday_note"
  | "cin7_note"
  | "shopify_note"
  | "system_event"
  | "edd_update"
  | "payment_update"
  | "supplier_update"
  | "tracking_update"
  | "contact_update"
  | "address_update"
  | "delivery_instructions_update"
  | "cancel_update"
  | "variant_update"
  | "sms"
  | "whatsapp";

export type ActivityChannel =
  | "email"
  | "oms"
  | "monday"
  | "cin7"
  | "shopify"
  | "sms"
  | "whatsapp"
  | "system";

export type SyncTarget = "monday" | "cin7" | "shopify";

export type SyncResultMap = Partial<
  Record<SyncTarget, { ok: boolean; id?: string; error?: string }>
>;

export interface LogActivityInput {
  shop: string;
  orderId: string;
  variantId?: string | null;
  opsRecordId?: string | null;
  jobId?: string | null;
  activityType: ActivityType | string;
  channel?: ActivityChannel | string;
  subject?: string;
  body?: string;
  recipientEmail?: string;
  recipientName?: string;
  sentBy: string;
  deliveryStatus?: string;
  providerMessageId?: string | null;
  syncTargets?: SyncTarget[];
  syncResults?: SyncResultMap;
  metadata?: Record<string, unknown>;
  sentAt?: Date;
}

/** @deprecated Use LogActivityInput — kept for bulk-notify call sites */
export interface CreateCommunicationLogEntry {
  shop: string;
  orderId: string;
  jobId?: string;
  channel?: string;
  subject: string;
  body: string;
  recipientEmail: string;
  recipientName: string;
  sentBy: string;
  deliveryStatus?: string;
  providerMessageId?: string;
  sentAt?: Date;
  variantId?: string;
}

export async function logActivity(entry: LogActivityInput) {
  // Always inserts into OUR Postgres CommunicationLog — this is the source of truth.
  // Shopify / Monday / Cin7 are optional mirrors updated separately via syncTargets.
  return prisma.communicationLog.create({
    data: {
      shop: entry.shop,
      orderId: entry.orderId,
      variantId: entry.variantId ?? null,
      opsRecordId: entry.opsRecordId ?? null,
      jobId: entry.jobId ?? null,
      activityType: entry.activityType,
      channel: entry.channel ?? defaultChannel(entry.activityType),
      subject: entry.subject ?? "",
      body: entry.body ?? "",
      recipientEmail: entry.recipientEmail ?? "",
      recipientName: entry.recipientName ?? "",
      sentBy: entry.sentBy,
      deliveryStatus: entry.deliveryStatus ?? defaultStatus(entry.activityType),
      providerMessageId: entry.providerMessageId ?? null,
      syncTargets:
        entry.syncTargets && entry.syncTargets.length > 0
          ? (entry.syncTargets as Prisma.InputJsonValue)
          : undefined,
      syncResults: (entry.syncResults as Prisma.InputJsonValue | undefined) ?? undefined,
      metadata: (entry.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
      sentAt: entry.sentAt ?? new Date(),
    },
  });
}

export async function createCommunicationLog(entry: CreateCommunicationLogEntry) {
  return logActivity({
    shop: entry.shop,
    orderId: entry.orderId,
    variantId: entry.variantId,
    jobId: entry.jobId,
    activityType: "email",
    channel: entry.channel ?? "email",
    subject: entry.subject,
    body: entry.body,
    recipientEmail: entry.recipientEmail,
    recipientName: entry.recipientName,
    sentBy: entry.sentBy,
    deliveryStatus: entry.deliveryStatus ?? "sent",
    providerMessageId: entry.providerMessageId,
    sentAt: entry.sentAt,
  });
}

/** Queue-time email rows — Activity History shows "pending" until cron sends. */
export async function logQueuedEmails(params: {
  shop: string;
  jobId: string;
  subject: string;
  body: string;
  sentBy: string;
  recipients: Array<{
    id: string;
    email: string;
    name: string;
    orderId: string;
    variantId: string;
  }>;
}) {
  const now = new Date();
  const data = params.recipients.map((r) => ({
    shop: params.shop,
    orderId: r.orderId,
    variantId: r.variantId,
    jobId: params.jobId,
    activityType: "email",
    channel: "email",
    subject: params.subject,
    body: params.body,
    recipientEmail: r.email,
    recipientName: r.name,
    sentBy: params.sentBy,
    deliveryStatus: "pending",
    metadata: { recipientId: r.id, source: "email_queue" } as Prisma.InputJsonValue,
    sentAt: now,
  }));

  if (data.length === 0) return { count: 0 };
  await prisma.communicationLog.createMany({ data });
  return { count: data.length };
}

/** After cron send — flip pending queue log to sent/failed (or insert if missing). */
export async function finalizeQueuedEmailLog(params: {
  shop: string;
  jobId: string;
  orderId: string;
  variantId: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  body: string;
  sentBy: string;
  deliveryStatus: "sent" | "failed";
  providerMessageId?: string | null;
  error?: string | null;
  recipientId?: string;
}) {
  const pending = await prisma.communicationLog.findFirst({
    where: {
      shop: params.shop,
      jobId: params.jobId,
      orderId: params.orderId,
      variantId: params.variantId,
      recipientEmail: params.recipientEmail,
      activityType: "email",
      deliveryStatus: "pending",
    },
    orderBy: { createdAt: "desc" },
  });

  if (pending) {
    return prisma.communicationLog.update({
      where: { id: pending.id },
      data: {
        subject: params.subject,
        body: params.body,
        deliveryStatus: params.deliveryStatus,
        providerMessageId: params.providerMessageId ?? null,
        sentAt: new Date(),
        metadata: {
          ...(typeof pending.metadata === "object" && pending.metadata && !Array.isArray(pending.metadata)
            ? (pending.metadata as Record<string, unknown>)
            : {}),
          recipientId: params.recipientId,
          source: "email_queue",
          ...(params.error ? { error: params.error } : {}),
        } as Prisma.InputJsonValue,
      },
    });
  }

  return createCommunicationLog({
    shop: params.shop,
    orderId: params.orderId,
    variantId: params.variantId,
    jobId: params.jobId,
    channel: "email",
    subject: params.subject,
    body: params.body,
    recipientEmail: params.recipientEmail,
    recipientName: params.recipientName,
    sentBy: params.sentBy,
    deliveryStatus: params.deliveryStatus,
    providerMessageId: params.providerMessageId ?? undefined,
    sentAt: new Date(),
  });
}

export async function updateActivitySyncResults(
  id: string,
  syncResults: SyncResultMap,
  deliveryStatus?: string,
) {
  return prisma.communicationLog.update({
    where: { id },
    data: {
      syncResults,
      ...(deliveryStatus ? { deliveryStatus } : {}),
    },
  });
}

/** Line-item timeline: newest first (latest on top). */
export async function getActivityLogForLineItem(
  shop: string,
  orderId: string,
  variantId: string,
) {
  return prisma.communicationLog.findMany({
    where: {
      shop,
      orderId,
      OR: [{ variantId }, { variantId: null }],
    },
    orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });
}

export async function getCommunicationLogForOrder(shop: string, orderId: string) {
  return prisma.communicationLog.findMany({
    where: { shop, orderId },
    orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });
}

export async function getCommunicationLogForJob(jobId: string) {
  return prisma.communicationLog.findMany({
    where: { jobId },
    orderBy: [{ sentAt: "asc" }, { createdAt: "asc" }],
  });
}

function defaultChannel(activityType: string): string {
  switch (activityType) {
    case "email":
      return "email";
    case "monday_note":
      return "monday";
    case "cin7_note":
      return "cin7";
    case "shopify_note":
      return "shopify";
    case "sms":
      return "sms";
    case "whatsapp":
      return "whatsapp";
    case "internal_note":
      return "oms";
    default:
      return "system";
  }
}

function defaultStatus(activityType: string): string {
  if (activityType === "internal_note") return "internal";
  if (activityType.endsWith("_update") || activityType === "system_event") return "internal";
  return "sent";
}
