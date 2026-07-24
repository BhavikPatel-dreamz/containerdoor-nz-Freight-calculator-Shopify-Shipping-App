/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from "../db.server";
import { pushLineItemToAllSystems } from "./sync-middleware.server";
import { serializeNotes, formatNoteDateTime } from "../components/freight/helpers";
import type { NoteItem } from "../components/freight/types";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BulkActionItem {
  orderId: string;
  variantId: string;
}

export interface BulkActions {
  paymentStatus?: string;
  supplier?: string;
  note?: string;
  notify?: { subject: string; body: string };
}

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

export interface BulkActionResult {
  orderId: string;
  variantId: string;
  success: boolean;
  error?: string;
}

export interface BulkActionsResponse {
  ok: boolean;
  results: BulkActionResult[];
  summary: { total: number; succeeded: number; failed: number };
  notifyJobId?: string;
  notifyRecipients?: number;
}

// ─── Core: process bulk actions ──────────────────────────────────────────────

export async function processBulkActions(
  shop: string,
  items: BulkActionItem[],
  actions: BulkActions,
  performedBy: string,
  filters?: Record<string, any>,
): Promise<BulkActionsResponse> {
  const results: BulkActionResult[] = [];

  // ── Phase 1: Apply data updates (payment status, supplier, notes) ──
  for (const item of items) {
    try {
      await applyDataActions(shop, item, actions, performedBy);
      results.push({ orderId: item.orderId, variantId: item.variantId, success: true });
    } catch (e: any) {
      await recordBulkActionAudit(shop, item, actions, performedBy, "FAILED", {}, {}, e.message).catch((auditError) =>
        console.error("[BulkActions] Audit create failed", auditError),
      );
      results.push({ orderId: item.orderId, variantId: item.variantId, success: false, error: e.message });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  // ── Phase 2: Queue email notification (if requested) ──
  let notifyJobId: string | undefined;
  let notifyRecipients: number | undefined;

  if (actions.notify) {
    const succeededItems = items.filter((_, i) => results[i].success);
    const job = await createNotifyJob(shop, succeededItems, actions.notify, performedBy, filters);
    if (job) {
      notifyJobId = job.jobId;
      notifyRecipients = job.recipientCount;
    }
  }

  return {
    ok: failed === 0,
    results,
    summary: { total: items.length, succeeded, failed },
    notifyJobId,
    notifyRecipients,
  };
}

// ─── Apply data actions to a single item ─────────────────────────────────────

async function applyDataActions(
  shop: string,
  item: BulkActionItem,
  actions: BulkActions,
  performedBy: string,
) {
  const { orderId, variantId } = item;

  // Find or create the operational data record
  const existing = await prisma.orderLineItemOperationalData.findUnique({
    where: { shop_orderId_variantId: { shop, orderId, variantId } },
  });

  const updateData: Record<string, any> = {};
  const notesToAdd: string[] = [];
  const oldValues: Record<string, string> = {};
  const newValues: Record<string, string> = {};

  // ── Payment Status ──
  if (hasOwn(actions, "paymentStatus")) {
    const nextVal = actions.paymentStatus ?? "";
    const oldVal = existing?.paymentStatus ?? "";
    if (nextVal !== oldVal) {
      updateData.paymentStatus = nextVal;
      oldValues.paymentStatus = oldVal;
      newValues.paymentStatus = nextVal;
      notesToAdd.push(`Payment status changed from "${oldVal || "none"}" to "${nextVal || "none"}" (bulk by ${performedBy}).`);
    }
  }

  // ── Supplier ──
  if (hasOwn(actions, "supplier")) {
    const nextVal = actions.supplier ?? "";
    const oldVal = existing?.supplierContainer ?? "";
    if (nextVal !== oldVal) {
      updateData.supplierContainer = nextVal;
      oldValues.supplierContainer = oldVal;
      newValues.supplierContainer = nextVal;
      notesToAdd.push(`Supplier changed from "${oldVal || "none"}" to "${nextVal || "none"}" (bulk by ${performedBy}).`);
    }
  }

  // ── Note ──
  if (actions.note) {
    notesToAdd.push(actions.note);
    oldValues.notes = existing?.notes ?? "";
    newValues.notes = actions.note;
  }

  // ── Apply DB update ──
  if (Object.keys(updateData).length > 0 || notesToAdd.length > 0) {
    // Build notes
    const currentNotes = existing?.notes ?? "";
    const parsedNotes = currentNotes ? parseNotesFromString(currentNotes) : [];
    for (const noteText of notesToAdd) {
      parsedNotes.unshift({
        author: performedBy,
        role: "internal",
        scheme: "internal",
        time: formatNoteDateTime(),
        text: noteText,
      });
    }
    updateData.notes = serializeNotes(parsedNotes);

    // Upsert
    await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.orderLineItemOperationalData.update({
          where: { id: existing.id },
          data: updateData,
        });
      } else {
        await tx.orderLineItemOperationalData.create({
          data: { shop, orderId, variantId, ...updateData },
        });
      }

      await tx.bulkActionAudit.create({
        data: {
          shop,
          user: performedBy,
          action: describeBulkAction(actions),
          status: "SUCCESS",
          orderId,
          variantId,
          changedFields: Object.keys(newValues),
          oldValues,
          newValues,
        },
      });
    });

    // ── Sync to external systems ──
    if (Object.keys(updateData).length > 1 || updateData.notes) {
      const syncFields: any = { shop, orderId, variantId };
      if (hasOwn(updateData, "paymentStatus")) syncFields.paymentStatus = updateData.paymentStatus;
      if (hasOwn(updateData, "supplierContainer")) syncFields.supplierContainer = updateData.supplierContainer;
      // Fire-and-forget sync
      pushLineItemToAllSystems(syncFields, "admin").catch((e: any) =>
        console.error("[BulkActions] Sync failed", e),
      );
    }
  } else {
    await recordBulkActionAudit(shop, item, actions, performedBy, "SUCCESS", oldValues, newValues);
  }
}

async function recordBulkActionAudit(
  shop: string,
  item: BulkActionItem,
  actions: BulkActions,
  performedBy: string,
  status: "SUCCESS" | "FAILED",
  oldValues: Record<string, string>,
  newValues: Record<string, string>,
  error?: string,
) {
  await prisma.bulkActionAudit.create({
    data: {
      shop,
      user: performedBy,
      action: describeBulkAction(actions),
      status,
      orderId: item.orderId,
      variantId: item.variantId,
      changedFields: Object.keys(newValues),
      oldValues,
      newValues,
      error,
    },
  });
}

function describeBulkAction(actions: BulkActions): string {
  return [
    hasOwn(actions, "paymentStatus") ? "paymentStatus" : "",
    hasOwn(actions, "supplier") ? "supplier" : "",
    actions.note ? "note" : "",
    actions.notify ? "notify" : "",
  ].filter(Boolean).join("+") || "bulk";
}

// ─── Create email notification job ───────────────────────────────────────────

async function createNotifyJob(
  shop: string,
  items: BulkActionItem[],
  notify: { subject: string; body: string },
  performedBy: string,
  filters?: Record<string, any>,
): Promise<{ jobId: string; recipientCount: number } | null> {
  // Build recipient list from items that have valid emails
  const recipients: Array<{
    email: string; name: string; orderName: string; orderId: string;
    variantId: string; orderData: Record<string, any>;
  }> = [];

  for (const item of items) {
    // Look up the order snapshot for email/name
    const snap = await prisma.orderSnapshot.findUnique({
      where: { shop_orderId: { shop, orderId: item.orderId } },
      select: { email: true, orderName: true, shippingFirstName: true, shippingLastName: true },
    });
    if (!snap?.email) continue;

    // Look up operational data for orderData snapshot
    const ops = await prisma.orderLineItemOperationalData.findUnique({
      where: { shop_orderId_variantId: { shop, orderId: item.orderId, variantId: item.variantId } },
      select: { supplierContainer: true, eddDate: true, carrier: true, trackingNumber: true, warehouseStatus: true },
    });

    const name = [snap.shippingFirstName, snap.shippingLastName].filter(Boolean).join(" ") || "Customer";

    recipients.push({
      email: snap.email,
      name,
      orderName: snap.orderName,
      orderId: item.orderId,
      variantId: item.variantId,
      orderData: {
        recipient: snap.email,
        orderId: item.orderId,
        orderName: snap.orderName,
        variables: ["name", "order", "link", "supplier", "edd", "carrier", "tracking"],
        filters: filters ?? {},
        supplier: ops?.supplierContainer ?? "",
        edd: ops?.eddDate ?? "",
        carrier: ops?.carrier ?? "",
        trackingNumber: ops?.trackingNumber ?? "",
        warehouseStatus: ops?.warehouseStatus ?? "",
      },
    });
  }

  if (recipients.length === 0) return null;

  // Create job + recipients in a transaction
  const job = await prisma.$transaction(async (tx) => {
    const j = await tx.bulkEmailJob.create({
      data: {
        shop,
        subject: notify.subject,
        body: notify.body,
        sentBy: performedBy,
        filters: filters ?? undefined,
        totalRecipients: recipients.length,
      },
    });

    await tx.bulkEmailRecipient.createMany({
      data: recipients.map((r) => ({
        jobId: j.id,
        email: r.email,
        name: r.name,
        orderName: r.orderName,
        orderId: r.orderId,
        variantId: r.variantId,
        orderData: r.orderData,
      })),
    });

    return j;
  });

  return { jobId: job.id, recipientCount: recipients.length };
}

// ─── Simple note parser (for appending to existing notes) ────────────────────

function parseNotesFromString(raw: string): NoteItem[] {
  if (!raw.trim()) return [];
  const blocks = raw.split(/\n\n+/).filter(Boolean);
  const notes: NoteItem[] = [];
  for (const block of blocks) {
    const m = block.match(/^\[(\w+(?::\w+)?)\|([^|]*)\|([^\]]+)\]\s*([\s\S]*)$/);
    if (m) {
      notes.push({ scheme: m[1], author: m[2], time: m[3], text: m[4].trim(), role: m[1].split(":")[0] });
    } else {
      notes.push({ scheme: "internal", author: "SY", time: formatNoteDateTime(), text: block.trim(), role: "internal" });
    }
  }
  return notes;
}
