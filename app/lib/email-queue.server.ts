/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Central customer-email queue.
 * ALL outbound customer emails must go through BulkEmailJob + BulkEmailRecipient.
 * Cron/worker at /api/bulk-notify/process is the only sender.
 */
import prisma from "../db.server";
import { logQueuedEmails } from "./communication-log.server";

export type EmailQueueRecipient = {
  email: string;
  name: string;
  orderName: string;
  orderId: string;
  variantId: string;
  orderData?: Record<string, any>;
};

export type EnqueueCustomerEmailInput = {
  shop: string;
  subject: string;
  body: string;
  sentBy: string;
  recipients: EmailQueueRecipient[];
  filters?: Record<string, any>;
};

export type EnqueueCustomerEmailResult = {
  jobId: string;
  recipientCount: number;
};

/** Enqueue into email tables + pending CommunicationLog. Does NOT send. */
export async function enqueueCustomerEmails(
  input: EnqueueCustomerEmailInput,
): Promise<EnqueueCustomerEmailResult | null> {
  const recipients = input.recipients.filter((r) => r.email && r.email.trim() && r.email !== "—");
  if (recipients.length === 0) return null;

  const job = await prisma.$transaction(async (tx) => {
    const j = await tx.bulkEmailJob.create({
      data: {
        shop: input.shop,
        subject: input.subject,
        body: input.body,
        sentBy: input.sentBy,
        filters: input.filters ?? undefined,
        totalRecipients: recipients.length,
      },
    });

    await tx.bulkEmailRecipient.createMany({
      data: recipients.map((r) => ({
        jobId: j.id,
        email: r.email.trim(),
        name: r.name || "Customer",
        orderName: r.orderName,
        orderId: r.orderId,
        variantId: r.variantId,
        orderData: r.orderData ?? undefined,
      })),
    });

    return j;
  });

  const saved = await prisma.bulkEmailRecipient.findMany({
    where: { jobId: job.id },
    select: { id: true, email: true, name: true, orderId: true, variantId: true },
  });

  await logQueuedEmails({
    shop: input.shop,
    jobId: job.id,
    subject: input.subject,
    body: input.body,
    sentBy: input.sentBy,
    recipients: saved,
  }).catch((e) => console.error("[EmailQueue] CommunicationLog queue write failed", e));

  return { jobId: job.id, recipientCount: saved.length };
}

/** Build orderData snapshot for template vars {supplier} {edd} etc. */
export async function buildRecipientOrderData(
  shop: string,
  orderId: string,
  variantId: string,
  extras?: Record<string, any>,
) {
  const [ops, lineIndex] = await Promise.all([
    prisma.orderLineItemOperationalData.findUnique({
      where: { shop_orderId_variantId: { shop, orderId, variantId } },
      select: {
        supplierContainer: true,
        eddDate: true,
        carrier: true,
        trackingNumber: true,
        warehouseStatus: true,
        productTitle: true,
      },
    }),
    prisma.orderLineItemIndex.findUnique({
      where: { shop_orderId_variantId: { shop, orderId, variantId } },
      select: { productTitle: true, variantTitle: true },
    }),
  ]);

  const productName = lineIndex?.productTitle || ops?.productTitle || "";
  const variants = [lineIndex?.variantTitle].filter(Boolean).join(" / ");

  return {
    orderId,
    variantId,
    supplier: ops?.supplierContainer ?? "",
    edd: ops?.eddDate ?? "",
    carrier: ops?.carrier ?? "",
    trackingNumber: ops?.trackingNumber ?? "",
    warehouseStatus: ops?.warehouseStatus ?? "",
    productName,
    product: productName,
    product_name: productName,
    variants,
    variant: variants,
    variables: ["name", "order", "link", "supplier", "edd", "carrier", "tracking", "product", "product_name", "variants", "variant"],
    ...extras,
  };
}

export type NotifyKind = "edd" | "tracking" | "custom";

/**
 * Queue a single-line-item customer notification (EDD / tracking / custom).
 * Fast — writes queue tables only. Cron sends later.
 */
export async function enqueueLineItemCustomerNotify(params: {
  shop: string;
  orderId: string;
  variantId: string;
  sentBy: string;
  kind: NotifyKind;
  /** Required for kind=custom */
  subject?: string;
  body?: string;
  /** Optional overrides baked into template for edd/tracking */
  eddDate?: string;
  trackingNumber?: string;
  carrier?: string;
}): Promise<EnqueueCustomerEmailResult | null> {
  const snap = await prisma.orderSnapshot.findUnique({
    where: { shop_orderId: { shop: params.shop, orderId: params.orderId } },
    select: { email: true, orderName: true, shippingFirstName: true, shippingLastName: true },
  });
  if (!snap?.email) return null;

  const name = [snap.shippingFirstName, snap.shippingLastName].filter(Boolean).join(" ") || "Customer";
  const orderData = await buildRecipientOrderData(params.shop, params.orderId, params.variantId, {
    recipient: snap.email,
    orderName: snap.orderName,
    edd: params.eddDate || undefined,
    trackingNumber: params.trackingNumber || undefined,
    carrier: params.carrier || undefined,
  });

  let subject = params.subject || "";
  let body = params.body || "";

  if (params.kind === "edd") {
    const edd = params.eddDate || orderData.edd || "";
    subject = subject || `Delivery date update for order ${snap.orderName}`;
    body =
      body ||
      `Hi {name},\n\nYour estimated delivery date for order {order} has been updated to ${edd}.\n\nIf you have any questions, just reply to this email.\n\nThanks,\nContainerDoor`;
  } else if (params.kind === "tracking") {
    const tracking = params.trackingNumber || orderData.trackingNumber || "";
    const carrier = params.carrier || orderData.carrier || "";
    subject = subject || `Tracking update for order ${snap.orderName}`;
    body =
      body ||
      `Hi {name},\n\nYour order {order} has been dispatched${carrier ? ` with ${carrier}` : ""}.\n\nTracking number: ${tracking || "{tracking}"}\n\nThanks,\nContainerDoor`;
  } else {
    // custom
    if (!body.trim()) return null;
    subject = subject.trim() || `Update on your order ${snap.orderName}`;
  }

  return enqueueCustomerEmails({
    shop: params.shop,
    subject,
    body,
    sentBy: params.sentBy,
    recipients: [
      {
        email: snap.email,
        name,
        orderName: snap.orderName,
        orderId: params.orderId,
        variantId: params.variantId,
        orderData,
      },
    ],
    filters: { kind: params.kind, source: "oms_notify" },
  });
}
