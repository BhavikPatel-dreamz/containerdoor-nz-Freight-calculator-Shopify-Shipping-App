import prisma from "../db.server";

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
}

export async function createCommunicationLog(entry: CreateCommunicationLogEntry) {
  return prisma.communicationLog.create({
    data: {
      shop: entry.shop,
      orderId: entry.orderId,
      jobId: entry.jobId,
      channel: entry.channel ?? "email",
      subject: entry.subject,
      body: entry.body,
      recipientEmail: entry.recipientEmail,
      recipientName: entry.recipientName,
      sentBy: entry.sentBy,
      deliveryStatus: entry.deliveryStatus ?? "sent",
      providerMessageId: entry.providerMessageId,
      sentAt: entry.sentAt ?? new Date(),
    },
  });
}

export async function getCommunicationLogForOrder(shop: string, orderId: string) {
  return prisma.communicationLog.findMany({
    where: { shop, orderId },
    orderBy: { sentAt: "desc" },
  });
}

export async function getCommunicationLogForJob(jobId: string) {
  return prisma.communicationLog.findMany({
    where: { jobId },
    orderBy: { sentAt: "asc" },
  });
}
