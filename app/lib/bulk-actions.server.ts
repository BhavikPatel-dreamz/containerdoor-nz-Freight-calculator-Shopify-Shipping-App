/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from "../db.server";
import { pushLineItemToAllSystems } from "./sync-middleware.server";
import { createMondayUpdate } from "./monday.server";
import { serializeNotes, formatNoteDateTime } from "../components/freight/helpers";
import type { NoteItem } from "../components/freight/types";
import { logActivity } from "./communication-log.server";
import { enqueueCustomerEmails } from "./email-queue.server";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BulkActionItem {
  orderId: string;
  variantId: string;
}

export interface BulkActions {
  eddDate?: string;
  paymentStatus?: string;
  supplier?: string;
  note?: string;
  noteOptions?: { sendToMonday?: boolean; sendToCin7?: boolean; addToShopify?: boolean };
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

  // ── EDD ──
  if (hasOwn(actions, "eddDate") && actions.eddDate) {
    const nextVal = actions.eddDate;
    const oldVal = existing?.eddDate ?? "";
    if (nextVal !== oldVal) {
      updateData.eddDate = nextVal;
      updateData.eddDateUpdatedAt = new Date();
      if (!existing?.originalEddDate && oldVal) {
        updateData.originalEddDate = oldVal;
      } else if (!existing?.originalEddDate) {
        updateData.originalEddDate = nextVal;
      }
      oldValues.eddDate = oldVal;
      newValues.eddDate = nextVal;
      const fmt = (d: string) => {
        try {
          return new Date(d).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
        } catch {
          return d;
        }
      };
      notesToAdd.push(
        oldVal
          ? `EDD changed from ${fmt(oldVal)} to ${fmt(nextVal)} (bulk by ${performedBy}).`
          : `EDD set to ${fmt(nextVal)} (bulk by ${performedBy}).`,
      );
    }
  }

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
  const sendNoteToMonday = Boolean(actions.note && actions.noteOptions?.sendToMonday);
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
      const isUserNote = actions.note === noteText;
      parsedNotes.unshift({
        author: performedBy,
        role: "internal",
        scheme: "internal",
        time: formatNoteDateTime(),
        text: noteText,
        pushToMonday: isUserNote && sendNoteToMonday,
      });
    }
    updateData.notes = serializeNotes(parsedNotes);

    // Upsert ops + audit + activity log in one transaction (audit alone used to succeed
    // while CommunicationLog writes failed silently outside the txn).
    const updated = await prisma.$transaction(async (tx) => {
      let record;
      if (existing) {
        record = await tx.orderLineItemOperationalData.update({
          where: { id: existing.id },
          data: updateData,
        });
      } else {
        record = await tx.orderLineItemOperationalData.create({
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

      const now = new Date();
      const activityRows: Array<{
        activityType: string;
        channel: string;
        subject: string;
        body: string;
        deliveryStatus: string;
        syncTargets?: string[];
        metadata?: Record<string, string>;
      }> = [];

      if (actions.note) {
        activityRows.push({
          activityType: "internal_note",
          channel: "oms",
          subject: "Internal note",
          body: actions.note,
          // Monday sync status filled in after the external call below
          deliveryStatus: sendNoteToMonday ? "pending" : "internal",
          syncTargets: sendNoteToMonday ? ["monday"] : undefined,
        });
      }
      if (hasOwn(newValues, "eddDate")) {
        activityRows.push({
          activityType: "edd_update",
          channel: "system",
          subject: "EDD",
          body: `EDD changed from "${oldValues.eddDate || "none"}" to "${newValues.eddDate || "none"}"`,
          deliveryStatus: "internal",
          metadata: { field: "eddDate", oldValue: oldValues.eddDate ?? "", newValue: newValues.eddDate },
        });
      }
      if (hasOwn(newValues, "paymentStatus")) {
        activityRows.push({
          activityType: "payment_update",
          channel: "system",
          subject: "Payment status",
          body: `Payment status changed from "${oldValues.paymentStatus || "none"}" to "${newValues.paymentStatus || "none"}"`,
          deliveryStatus: "internal",
        });
      }
      if (hasOwn(newValues, "supplierContainer")) {
        activityRows.push({
          activityType: "supplier_update",
          channel: "system",
          subject: "Supplier",
          body: `Supplier changed from "${oldValues.supplierContainer || "none"}" to "${newValues.supplierContainer || "none"}"`,
          deliveryStatus: "internal",
        });
      }

      for (const row of activityRows) {
        await tx.communicationLog.create({
          data: {
            shop,
            orderId,
            variantId,
            opsRecordId: record.id,
            activityType: row.activityType,
            channel: row.channel,
            subject: row.subject,
            body: row.body,
            recipientEmail: "",
            recipientName: "",
            sentBy: performedBy,
            deliveryStatus: row.deliveryStatus,
            syncTargets: (row.syncTargets as any) ?? undefined,
            metadata: (row.metadata as any) ?? undefined,
            sentAt: now,
          },
        });
      }

      return record;
    });

    // ── Sync to external systems ──
    const syncFields: any = { shop, orderId, variantId };
    let shouldSync = false;
    if (hasOwn(updateData, "paymentStatus")) {
      syncFields.paymentStatus = updateData.paymentStatus;
      shouldSync = true;
    }
    if (hasOwn(updateData, "supplierContainer")) {
      syncFields.supplierContainer = updateData.supplierContainer;
      shouldSync = true;
    }
    if (hasOwn(updateData, "eddDate")) {
      syncFields.eddDate = updateData.eddDate;
      shouldSync = true;
    }
    if (shouldSync) {
      pushLineItemToAllSystems(syncFields, "admin").catch((e: any) =>
        console.error("[BulkActions] Sync failed", e),
      );
    }

    // Push user note to Monday as an update (when requested), then update activity status
    if (sendNoteToMonday && actions.note && updated.mondayItemId && updated.mondayItemId !== "pending") {
      let mondayOk = false;
      try {
        await createMondayUpdate(updated.mondayItemId, actions.note);
        mondayOk = true;
        await prisma.orderLineItemOperationalData.update({
          where: { id: updated.id },
          data: {
            notesPushedMondayItemId: updated.mondayItemId,
            notesPushedCount: { increment: 1 },
          },
        });
      } catch (e: any) {
        console.error("[BulkActions] Monday note push failed", e);
      }

      try {
        await prisma.communicationLog.updateMany({
          where: {
            shop,
            orderId,
            variantId,
            opsRecordId: updated.id,
            activityType: "internal_note",
            body: actions.note,
            deliveryStatus: "pending",
          },
          data: {
            deliveryStatus: mondayOk ? "synced" : "failed",
            syncResults: { monday: { ok: mondayOk } },
          },
        });
        await logActivity({
          shop,
          orderId,
          variantId,
          opsRecordId: updated.id,
          activityType: "monday_note",
          channel: "monday",
          subject: "Monday note",
          body: actions.note,
          sentBy: performedBy,
          deliveryStatus: mondayOk ? "synced" : "failed",
          syncTargets: ["monday"],
          syncResults: { monday: { ok: mondayOk } },
        });
      } catch (logErr) {
        console.error("[BulkActions] Monday activity log update failed", logErr);
      }
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
    hasOwn(actions, "eddDate") ? "eddDate" : "",
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
  const recipients = [];

  for (const item of items) {
    const snap = await prisma.orderSnapshot.findUnique({
      where: { shop_orderId: { shop, orderId: item.orderId } },
      select: { email: true, orderName: true, shippingFirstName: true, shippingLastName: true },
    });
    if (!snap?.email) continue;

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

  return enqueueCustomerEmails({
    shop,
    subject: notify.subject,
    body: notify.body,
    sentBy: performedBy,
    recipients,
    filters,
  });
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
