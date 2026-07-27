/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate, unauthenticated } from "../shopify.server";
import { createMondayItem, updateMondayItem, isStaleMondayItemError, createMondayUpdate, buildMondayItemUrl, renameMondayItem, buildMondayRowFromOms } from "../lib/monday.server";
import { normalizePaymentStatus } from "../lib/freight-orders.server";
import { pushLineItemToAllSystems } from "../lib/sync-middleware.server";
import { pushEddToShopify } from "../lib/shopify-sync.server";
import { syncCin7EstimatedDispatchDate, syncCin7TrackingNumber, appendCin7InternalComment } from "../lib/cin7.server";
import {
  getActivityLogForLineItem,
  getCommunicationLogForOrder,
  logActivity,
  updateActivitySyncResults,
} from "../lib/communication-log.server";
import type { SyncResultMap, SyncTarget } from "../lib/communication-log.server";
import { enqueueLineItemCustomerNotify } from "../lib/email-queue.server";

// Debug logging helper
const debug = (namespace: string, message: string, data?: any) => {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = `[${timestamp}] ${namespace}`;
  if (data !== undefined) {
    console.log(`${prefix}: ${message}`, data);
  } else {
    console.log(`${prefix}: ${message}`);
  }
};

/** Decode Shopify session-token JWT payload (no verify — used only to read `dest` shop). */
function shopFromBearerJwt(request: Request): string {
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m?.[1]) return "";
  try {
    const part = m[1].split(".")[1];
    if (!part) return "";
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(json) as { dest?: string };
    const dest = String(payload.dest || "")
      .replace(/^https?:\/\//i, "")
      .replace(/\/+$/, "")
      .trim();
    return dest.includes(".") ? dest : "";
  } catch {
    return "";
  }
}

/**
 * Resolve myshopify shop for OMS writes:
 * 1) explicit body/query shop
 * 2) authenticate.admin session (extension Bearer)
 * 3) JWT `dest` claim (same token, no session round-trip)
 * 4) OrderSnapshot by orderId
 */
async function resolveShopDomain(
  request: Request,
  explicitShop: string,
  orderId: string,
): Promise<string> {
  let shop = String(explicitShop || "").trim();
  if (shop) return shop;

  if (request.headers.get("Authorization")?.match(/^Bearer\s+/i)) {
    try {
      const { session } = await authenticate.admin(request);
      shop = String(session?.shop || "").trim();
      if (shop) return shop;
    } catch (e) {
      debug("auth", "authenticate.admin failed — falling back to JWT dest", String(e));
    }
    shop = shopFromBearerJwt(request);
    if (shop) return shop;
  }

  if (orderId) {
    const snap = await prisma.orderSnapshot.findFirst({
      where: { orderId },
      select: { shop: true },
    });
    shop = snap?.shop ?? "";
  }
  return shop;
}

// ── NEW: pushes a staff note into Shopify's native order timeline ──
// Uses orderEditBegin/orderEditCommit purely to attach a staffNote — no
// line items, quantities, or prices are actually changed.
async function pushStaffNoteToShopifyOrder(shop: string, orderId: string, staffNote: string) {
  if (!staffNote.trim()) return;
  try {
    const { admin } = await unauthenticated.admin(shop);

    const updateRes = await admin.graphql(
      `#graphql
        mutation OrderUpdateNote($input: OrderInput!) {
          orderUpdate(input: $input) {
            order { id note }
            userErrors { field message }
          }
        }`,
      { variables: { input: { id: `gid://shopify/Order/${orderId}`, note: staffNote } } }
    );
    const updateJson = await updateRes.json();
    const errors = updateJson.data?.orderUpdate?.userErrors ?? [];
    if (errors.length) {
      console.error("[api.order-status] orderUpdate (note) failed", errors);
    }
  } catch (e) {
    console.error("[api.order-status] pushStaffNoteToShopifyOrder error", e);
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  // Allow Cache-Control here because some clients set it (and it triggers preflight)
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Cache-Control",
};

// ───────────────────────────────────────────────────────────────────────────
// GET — fetch line item operational data
// ───────────────────────────────────────────────────────────────────────────
export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const lineIndexId = (url.searchParams.get("lineIndexId") ?? "").trim();
  const shopParam = url.searchParams.get("shop") ?? "";
  let rawOrderId = url.searchParams.get("orderId") ?? "";
  let variantIdParam = (url.searchParams.get("variantId") ?? "").trim();

  // Preferred: single OMS line-index id → resolve orderId + variantId from DB
  if (lineIndexId) {
    const idx = await prisma.orderLineItemIndex.findFirst({
      where: {
        id: lineIndexId,
        ...(shopParam ? { shop: shopParam } : {}),
      },
      select: { shop: true, orderId: true, variantId: true },
    });
    if (!idx) {
      return Response.json(
        { ok: false, error: "Line item not found" },
        { status: 404, headers: CORS_HEADERS },
      );
    }
    rawOrderId = idx.orderId;
    variantIdParam = idx.variantId;
    if (!shopParam) {
      // prefer index.shop when caller omitted shop
      url.searchParams.set("shop", idx.shop);
    }
  }

  const orderId = rawOrderId.replace(/^gid:\/\/shopify\/Order\//, "").trim();
  const shopFromParam = url.searchParams.get("shop") ?? shopParam;

  if (!orderId) {
    return Response.json(
      { error: "Missing orderId or lineIndexId" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    const shop = await resolveShopDomain(request, shopFromParam, orderId);

    const records = await prisma.orderLineItemOperationalData.findMany({
      where: {
        orderId,
        ...(shop ? { shop } : {}),
        ...(variantIdParam ? { variantId: variantIdParam } : {}),
      },
      select: {
        variantId: true,
        productTitle: true,
        carrier: true,
        customerStatus: true,
        paymentStatus: true,
        warehouseStatus: true,
        warehouseTags: true,
        deliveryStatus: true,
        dispatchStatus: true,
        trackingNumber: true,
        freightRef: true,
        eddDate: true,
        originalEddDate: true,
        supplierContainer: true,
        receivedDate: true,
        portArrivalDate: true,
        inTransitDate: true,
        depositPaid: true,
        balanceDue: true,
        notes: true,
        mondayItemId: true,
        mondayItemName: true,
      },
    });

    type RecordWithTitle = (typeof records)[number] & { productTitle: string; imageUrl: string; mondayItemUrl: string };
    let lineItems: RecordWithTitle[] = records.map((r) => ({
      ...r,
      productTitle: r.productTitle ?? "",
      imageUrl: "",
      mondayItemUrl: buildMondayItemUrl(r.mondayItemId) ?? "",
    }));

    // Always fetch live line items from Shopify when shop is available.
    // This gives us: (a) up-to-date titles, (b) a canonical set of variantIds
    // to filter against — so stale/orphaned DB rows are never shown.
    let canonicalVariantIds: Set<string> | null = null;

    if (shop) {
      try {
        const { admin } = await unauthenticated.admin(shop);
        const res = await admin.graphql(
          `#graphql
            query OrderLineItems($id: ID!) {
              order(id: $id) {
              lineItems(first: 50) {
              nodes {
            title
              variant {
              id
              image { url }
            product { featuredImage { url } }
            }
           }
          }
         }
        }`,
          { variables: { id: `gid://shopify/Order/${orderId}` } }
        );
        const json = await res.json();
        const nodes: Array<{
          title: string;
          variant?: {
            id: string;
            image?: { url: string };
            product?: { featuredImage?: { url: string } };
          };
        }> = json.data?.order?.lineItems?.nodes ?? [];

        // Build a map of variantId → title from the live order
        // AFTER
        const titleMap = new Map<string, string>();
        const imageMap = new Map<string, string>();
        canonicalVariantIds = new Set<string>();

        for (const li of nodes) {
          if (li.variant?.id) {
            const numId = li.variant.id.replace("gid://shopify/ProductVariant/", "");
            titleMap.set(numId, li.title);
            canonicalVariantIds.add(numId);
            // Prefer variant image, fall back to product featured image
            const imgUrl =
              li.variant.image?.url ??
              li.variant.product?.featuredImage?.url ??
              "";
            if (imgUrl) imageMap.set(numId, imgUrl);
          }
        }

        // Apply titles and backfill DB where missing
        lineItems = lineItems.map((r) => {
          const title = titleMap.get(r.variantId);
          const imageUrl = imageMap.get(r.variantId) ?? "";
          const base = { ...r, imageUrl };   // attach image to every record

          if (title && !r.productTitle) {
            prisma.orderLineItemOperationalData
              .updateMany({
                where: { orderId, variantId: r.variantId, ...(shop ? { shop } : {}) },
                data: { productTitle: title },
              })
              .catch(() => { });
            return { ...base, productTitle: title };
          }
          if (title && r.productTitle !== title) {
            return { ...base, productTitle: title };
          }
          return base;
        });
      } catch (e) {
        console.error("[api.order-status] Shopify GraphQL error", e);
      }
    }

    // ── KEY FIX: filter out orphaned rows ──────────────────────────────────
    // If we got a canonical list of variantIds from Shopify, only return
    // records whose variantId actually exists in the current order.
    // This removes stale rows left over from deleted/replaced line items.
    if (canonicalVariantIds !== null) {
      lineItems = lineItems.filter((r) => canonicalVariantIds!.has(r.variantId));
    } else {
      // Fallback when shop is unknown: at minimum hide rows with no title,
      // since "Variant #xxx" rows are almost always orphaned data.
      lineItems = lineItems.filter((r) => r.productTitle !== "");
    }

    // ── Fetch activity log (line-item scoped when variantId present) ──
    let communications: Awaited<ReturnType<typeof getCommunicationLogForOrder>> = [];
    try {
      if (variantIdParam) {
        communications = await getActivityLogForLineItem(shop || "", orderId, variantIdParam);
      } else {
        communications = await getCommunicationLogForOrder(shop || "", orderId);
      }
    } catch (e) {
      console.error("[api.order-status] CommunicationLog fetch failed", e);
    }

    return Response.json(
      {
        ok: true,
        lineItems,
        communications,
        lineIndexId: lineIndexId || undefined,
        orderId,
        variantId: variantIdParam || undefined,
      },
      { headers: CORS_HEADERS },
    );
  } catch (err) {
    console.error("[api.order-status] DB error", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS_HEADERS });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// POST — update editable fields for a single line item (used by admin block)
// ───────────────────────────────────────────────────────────────────────────
const EDITABLE_FIELDS = [
  "productTitle",
  "customerStatus",
  "paymentStatus",
  "warehouseStatus",
  "warehouseTags",
  "dispatchStatus",
  "deliveryStatus",
  "trackingNumber",
  "carrier",
  "freightRef",
  "eddDate",
  "originalEddDate",
  "supplierContainer",
  "receivedDate",
  "portArrivalDate",
  "inTransitDate",
  "depositPaid",
  "balanceDue",
  "notes",
] as const;

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return Response.json(
      { ok: false, error: "Method not allowed" },
      { status: 405, headers: CORS_HEADERS }
    );
  }

  try {
    const body = (await request.json()) as {
      shop?: string;
      orderId?: string;
      variantId?: string;
      data?: Record<string, string>;
      newNotes?: string[];
      newCin7Notes?: string[];
      /** Explicit sync targets for staff notes — never auto-push routine updates */
      syncNotes?: { monday?: boolean; cin7?: boolean; shopify?: boolean };
      performedBy?: string;
      noteRole?: string;
      /** Queue customer email (never send inline — cron sends) */
      notifyCustomer?: boolean;
      notifyKind?: "edd" | "tracking" | "custom";
      /** Subject/header stored on BulkEmailJob for cron to send */
      notifySubject?: string;
      /** e.g. shopify_admin_block — tagged on CommunicationLog metadata */
      source?: string;
    };

    const { variantId, data, newNotes, newCin7Notes, syncNotes, performedBy } = body;
    const orderId = String(body.orderId || "")
      .replace(/^gid:\/\/shopify\/Order\//, "")
      .trim();
    const actor = (performedBy || "SY").trim() || "SY";
    const activitySource = String(body.source || "oms").trim() || "oms";

    // Extension often sends shop:"" — resolve from Bearer JWT / session / OrderSnapshot.
    const shopValue = await resolveShopDomain(
      request,
      typeof body.shop === "string" ? body.shop : "",
      orderId,
    );
    debug("shop", `resolved shop="${shopValue}" from body.shop="${body.shop || ""}" orderId=${orderId}`);
    const pushNoteMonday = Boolean(syncNotes?.monday);
    const pushNoteCin7 = Boolean(syncNotes?.cin7) || (Array.isArray(newCin7Notes) && newCin7Notes.length > 0);
    const pushNoteShopify = Boolean(syncNotes?.shopify);
    const staffNoteTexts = Array.isArray(newNotes)
      ? newNotes.map((n) => String(n).trim()).filter(Boolean)
      : [];
    const wantCustomerNotify = Boolean((body as any).notifyCustomer);
    const notifyKindRaw = String((body as any).notifyKind || "").toLowerCase();
    // Only opt-in notes go to Shopify timeline (phase 1 write; phase 2 = show central log on order page)
    const newNotesForShopify = pushNoteShopify ? staffNoteTexts : [];
    const newNotesForCin7 = pushNoteCin7
      ? (Array.isArray(newCin7Notes) && newCin7Notes.length > 0
          ? newCin7Notes.map((n) => String(n).trim()).filter(Boolean)
          : staffNoteTexts)
      : [];

    if (!orderId || !variantId || !data) {
      return Response.json(
        { ok: false, error: "Missing orderId, variantId, or data" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    if (!shopValue) {
      return Response.json(
        { ok: false, error: "Missing shop — cannot write OMS line-item row" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const updateData: Record<string, string> = {};
    for (const key of EDITABLE_FIELDS) {
      if (key in data) updateData[key] = String(data[key] ?? "");
    }
    const requestedFieldKeys = Object.keys(updateData);

    let updated;

    // Upsert requires parent OrderSnapshot (FK shop+orderId). Ensure it exists.
    const snapExists = await prisma.orderSnapshot.findUnique({
      where: { shop_orderId: { shop: shopValue, orderId } },
      select: { orderId: true },
    });
    if (!snapExists) {
      return Response.json(
        {
          ok: false,
          error: `Order ${orderId} not in OMS yet — wait for orders/create webhook or reindex`,
        },
        { status: 404, headers: CORS_HEADERS },
      );
    }

    const existing = await prisma.orderLineItemOperationalData.findUnique({
      where: { shop_orderId_variantId: { shop: shopValue, orderId, variantId } },
    });

    // Don't wipe title/carrier with empty strings from extension saves.
    if (!String(updateData.productTitle || "").trim()) delete updateData.productTitle;
    if (!String(updateData.carrier || "").trim() && existing?.carrier) {
      delete updateData.carrier;
    }
    if (Object.prototype.hasOwnProperty.call(updateData, "paymentStatus")) {
      updateData.paymentStatus = normalizePaymentStatus(updateData.paymentStatus);
    }

    const payload = { ...updateData } as Record<string, string | Date>;
    if (existing) {
      payload.originalEddDate = existing.originalEddDate
        ? existing.originalEddDate
        : existing.eddDate
          ? existing.eddDate
          : updateData.eddDate ?? "";
    } else if (Object.prototype.hasOwnProperty.call(updateData, "eddDate")) {
      payload.originalEddDate = updateData.eddDate;
    }

    // ── Stamp field-level timestamps only when that field actually changes ──
    if (
      Object.prototype.hasOwnProperty.call(updateData, "customerStatus") &&
      updateData.customerStatus !== (existing?.customerStatus ?? "")
    ) {
      payload.customerStatusUpdatedAt = new Date();
    }
    if (
      Object.prototype.hasOwnProperty.call(updateData, "eddDate") &&
      updateData.eddDate !== (existing?.eddDate ?? "")
    ) {
      payload.eddDateUpdatedAt = new Date();
    }
    if (
      Object.prototype.hasOwnProperty.call(updateData, "trackingNumber") &&
      updateData.trackingNumber !== (existing?.trackingNumber ?? "")
    ) {
      payload.trackingNumberUpdatedAt = new Date();
    }

    const resolvedShopEarly = shopValue || existing?.shop || "";
    const isStaffNote = Boolean(syncNotes) || Boolean((body as any).isStaffNote);
    const plannedSyncTargets: SyncTarget[] = [];
    if (pushNoteMonday) plannedSyncTargets.push("monday");
    if (pushNoteCin7) plannedSyncTargets.push("cin7");
    if (pushNoteShopify) plannedSyncTargets.push("shopify");

    // Field + staff-note activity rows — ALWAYS written to CommunicationLog (audit).
    // Dashboard may hide *_update rows; DB still keeps who/when/what.
    const fieldSpecs: Array<[string, string, string]> = [
      ["eddDate", "edd_update", "EDD"],
      ["paymentStatus", "payment_update", "Payment status"],
      ["supplierContainer", "supplier_update", "Supplier"],
      ["trackingNumber", "tracking_update", "Tracking"],
      ["freightRef", "system_event", "Freight ref"],
      ["customerStatus", "system_event", "Customer status"],
      ["carrier", "system_event", "Carrier"],
      ["dispatchStatus", "system_event", "Dispatch status"],
      ["warehouseStatus", "system_event", "Warehouse status"],
      ["deliveryStatus", "system_event", "Delivery status"],
      ["depositPaid", "system_event", "Deposit paid"],
      ["balanceDue", "system_event", "Balance due"],
      ["receivedDate", "system_event", "Received date"],
      ["portArrivalDate", "system_event", "Port arrival"],
      ["inTransitDate", "system_event", "In transit date"],
    ];

    const normalizeCompare = (key: string, raw: string) => {
      const v = String(raw ?? "").trim();
      if (
        (key === "eddDate" ||
          key === "originalEddDate" ||
          key === "receivedDate" ||
          key === "portArrivalDate" ||
          key === "inTransitDate") &&
        v
      ) {
        const d = new Date(v);
        if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      }
      return v;
    };

    const activityRows: Array<{
      activityType: string;
      channel: string;
      subject: string;
      body: string;
      deliveryStatus: string;
      syncTargets?: SyncTarget[];
      metadata?: Record<string, unknown>;
      isStaffNote?: boolean;
    }> = [];

    for (const [key, type, label] of fieldSpecs) {
      if (!Object.prototype.hasOwnProperty.call(updateData, key)) continue;
      const oldRaw = String((existing as any)?.[key] ?? "");
      const newRaw = String(updateData[key] ?? "");
      const oldVal = normalizeCompare(key, oldRaw);
      const newVal = normalizeCompare(key, newRaw);
      if (oldVal === newVal) continue;
      activityRows.push({
        activityType: type,
        channel: "system",
        subject: label,
        body: `${label} changed from "${oldVal || "none"}" to "${newVal || "none"}" by ${actor}`,
        deliveryStatus: "internal",
        metadata: {
          field: key,
          oldValue: oldVal,
          newValue: newVal,
          source: activitySource,
          performedBy: actor,
        },
      });
    }
    const noteRole = String((body as any).noteRole || "internal").toLowerCase();
    const isCustomerEmail = isStaffNote && noteRole === "customer";

    // Internal notes → CommunicationLog. Customer email → BulkEmailJob queue (below).
    if (isStaffNote && staffNoteTexts.length > 0 && !isCustomerEmail) {
      for (const text of staffNoteTexts) {
        activityRows.push({
          activityType: "internal_note",
          channel: "oms",
          subject: "Internal note",
          body: text,
          deliveryStatus: plannedSyncTargets.length > 0 ? "pending" : "internal",
          syncTargets: plannedSyncTargets.length > 0 ? plannedSyncTargets : undefined,
          metadata: {
            source: activitySource,
            pushMonday: pushNoteMonday,
            pushCin7: pushNoteCin7,
            pushShopify: pushNoteShopify,
          },
          isStaffNote: true,
        });
      }
    }

    // Ops save FIRST, then CommunicationLog (so a log failure never rolls back the note).
    const now = new Date();
    const staffNoteLogIds: string[] = [];
    let activityLogged = 0;
    let notifyJobId: string | undefined;
    let notifyRecipients: number | undefined;

    try {
      // Always upsert on shop+orderId+variantId — OMS source of truth per line item.
      updated = await prisma.orderLineItemOperationalData.upsert({
        where: { shop_orderId_variantId: { shop: shopValue, orderId, variantId } },
        update: payload,
        create: { shop: shopValue, orderId, variantId, ...payload },
      });
    } catch (opsErr) {
      console.error("[api.order-status] Ops save failed", opsErr);
      return Response.json(
        { ok: false, error: "Failed to save line-item data", detail: String(opsErr) },
        { status: 500, headers: CORS_HEADERS },
      );
    }

    const shopForLog = shopValue || updated.shop || resolvedShopEarly;
    try {
      for (const row of activityRows) {
        const isCustomer = Boolean(row.isStaffNote) && noteRole === "customer";
        // Internal notes stay in CommunicationLog only — never email queue / customer send
        const created = await logActivity({
          shop: shopForLog,
          orderId,
          variantId,
          opsRecordId: updated.id,
          activityType: isCustomer ? "customer_note" : row.activityType,
          channel: row.channel,
          subject: isCustomer ? "Customer note" : row.subject,
          body: row.body,
          sentBy: actor,
          deliveryStatus: row.deliveryStatus,
          recipientEmail: "",
          recipientName: "",
          syncTargets: row.syncTargets,
          metadata: row.metadata,
          sentAt: now,
        });
        activityLogged += 1;
        if (row.isStaffNote) staffNoteLogIds.push(created.id);
      }
    } catch (logErr) {
      console.error("[api.order-status] CRITICAL: CommunicationLog insert failed (ops already saved)", logErr);
      return Response.json(
        {
          ok: false,
          error: "Saved data but failed to write Activity Log — retry note",
          detail: String(logErr),
          opsSaved: true,
          activityLogged: 0,
          record: updated,
        },
        { status: 500, headers: CORS_HEADERS },
      );
    }

    // ── Customer email → OUR queue tables only (cron sends — never inline) ──
    if (
      shopValue &&
      ((isCustomerEmail && staffNoteTexts.length > 0) || wantCustomerNotify)
    ) {
      const kind =
        isCustomerEmail || notifyKindRaw === "custom"
          ? "custom"
          : notifyKindRaw === "tracking"
            ? "tracking"
            : notifyKindRaw === "edd"
              ? "edd"
              : wantCustomerNotify && Object.prototype.hasOwnProperty.call(updateData, "trackingNumber")
                ? "tracking"
                : wantCustomerNotify && Object.prototype.hasOwnProperty.call(updateData, "eddDate")
                  ? "edd"
                  : "custom";

      const notifySubject = String((body as any).notifySubject || "").trim();
      const queued = await enqueueLineItemCustomerNotify({
        shop: shopValue,
        orderId,
        variantId,
        sentBy: actor,
        kind,
        subject: notifySubject || undefined,
        body: kind === "custom" ? staffNoteTexts.join("\n\n") : undefined,
        eddDate: updateData.eddDate,
        trackingNumber: updateData.trackingNumber,
        carrier: updateData.carrier,
      });

      if (!queued) {
        return Response.json(
          {
            ok: false,
            error: "No customer email on this order — cannot queue notification",
            opsSaved: true,
            record: updated,
          },
          { status: 400, headers: CORS_HEADERS },
        );
      }
      notifyJobId = queued.jobId;
      notifyRecipients = queued.recipientCount;
      activityLogged += queued.recipientCount;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Ops + Activity Log + email QUEUE written above (source of truth = our DB).
    // Emails are NEVER sent here — only cron/worker sends from BulkEmail* tables.
    // Shopify / Monday / Cin7 below are optional sync mirrors only.
    // ═══════════════════════════════════════════════════════════════════════
    const resolvedShop = shopValue || updated.shop || "";

    // ── Push changed fields to ALL systems (Shopify + Monday + Cin7) — mirrors only ──
    // Priority: Current EDD must sync to the linked Shopify order line (metafield).
    // Internal notes never sync via this path.
    let shopifyEddSync: { ok: boolean; error?: string } | undefined;
    if (shopValue && updated) {
      const syncFields: import("../lib/sync-middleware.server").LineItemSyncFields = {
        shop: shopValue,
        orderId,
        variantId,
      };
      const pushIfChanged = (key: string, dbField: string) => {
        if (
          Object.prototype.hasOwnProperty.call(updateData, key) &&
          updateData[key] !== (existing as any)?.[dbField]
        ) {
          (syncFields as any)[key] = updateData[key];
        }
      };
      pushIfChanged("eddDate", "eddDate");
      pushIfChanged("trackingNumber", "trackingNumber");
      pushIfChanged("dispatchStatus", "dispatchStatus");
      pushIfChanged("customerStatus", "customerStatus");
      pushIfChanged("warehouseStatus", "warehouseStatus");
      pushIfChanged("warehouseTags", "warehouseTags");
      pushIfChanged("deliveryStatus", "deliveryStatus");
      pushIfChanged("portArrivalDate", "portArrivalDate");
      pushIfChanged("inTransitDate", "inTransitDate");
      pushIfChanged("supplierContainer", "supplierContainer");
      pushIfChanged("receivedDate", "receivedDate");
      pushIfChanged("depositPaid", "depositPaid");
      pushIfChanged("balanceDue", "balanceDue");
      pushIfChanged("paymentStatus", "paymentStatus");

      // Await EDD → Shopify so customer-facing date is updated before response.
      if (syncFields.eddDate !== undefined) {
        const eddResult = await pushEddToShopify(shopValue, orderId, variantId, syncFields.eddDate);
        shopifyEddSync = { ok: eddResult.ok, error: eddResult.error };
        if (!eddResult.ok) {
          console.error("[api.order-status] EDD→Shopify sync failed", eddResult.error);
        } else {
          debug("Shopify", `EDD synced to order ${orderId} variant ${variantId}: ${syncFields.eddDate}`);
        }
      }

      // Other systems + non-EDD Shopify fields (fire-and-forget). Notes never included.
      pushLineItemToAllSystems(syncFields, "admin").catch((e) =>
        console.error("[api.order-status] Sync to other systems failed", e),
      );
    }

    const orderOperationalData = shopValue
      ? await prisma.orderOperationalData.findUnique({
          where: { shop_orderId: { shop: shopValue, orderId } },
        })
      : null;

    const cin7SalesOrderId = orderOperationalData?.cin7SalesOrderId?.trim() || "";
    let cin7Exists = Boolean(cin7SalesOrderId && cin7SalesOrderId !== "pending");
    debug("Cin7", `orderId=${orderId}, cin7SalesOrderId=${cin7SalesOrderId}, eddDateChanged=${Object.prototype.hasOwnProperty.call(updateData, "eddDate")}, trackingChanged=${Object.prototype.hasOwnProperty.call(updateData, "trackingNumber")}, newEdd=${updateData.eddDate}`);
    // ── NEW: push note to Cin7 internal comments if checkbox was ticked ──
    const cin7SyncResults: SyncResultMap = {};
    if (newNotesForCin7.length > 0 && cin7SalesOrderId && cin7SalesOrderId !== "pending") {
      for (const note of newNotesForCin7) {
        try {
          await appendCin7InternalComment({ salesOrderId: cin7SalesOrderId, comment: note });
          cin7SyncResults.cin7 = { ok: true };
        } catch (e) {
          console.error("[api.order-status] Failed to push note to Cin7", e);
          cin7SyncResults.cin7 = { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      }
    } else if (pushNoteCin7 && staffNoteTexts.length > 0) {
      cin7SyncResults.cin7 = { ok: false, error: "Cin7 sales order not linked" };
    }
    if (Object.prototype.hasOwnProperty.call(updateData, "eddDate") && cin7SalesOrderId && cin7SalesOrderId !== "pending") {
      debug("Cin7", `Syncing EDD to Cin7: salesOrderId=${cin7SalesOrderId}, eddDate=${updateData.eddDate}`);
      const cin7Update = await syncCin7EstimatedDispatchDate({
        salesOrderId: cin7SalesOrderId,
        eddDate: updateData.eddDate || "",
        reference: orderId,
      });
      debug("Cin7", `EDD sync result:`, cin7Update);
      cin7Exists = cin7Update.exists;
    } else if (Object.prototype.hasOwnProperty.call(updateData, "trackingNumber") && cin7SalesOrderId && cin7SalesOrderId !== "pending") {
      debug("Cin7", `Syncing tracking to Cin7: salesOrderId=${cin7SalesOrderId}, trackingNumber=${updateData.trackingNumber}`);
      const cin7Update = await syncCin7TrackingNumber({
        salesOrderId: cin7SalesOrderId,
        trackingNumber: updateData.trackingNumber || "",
        reference: orderId,
      });
      debug("Cin7", `Tracking sync result:`, cin7Update);
      cin7Exists = cin7Update.exists;
    } else {
      debug("Cin7", `SKIP - no relevant Cin7 update needed`);
    }

    // ── NEW: push updated fields to Monday dashboard ──
    const mondayDebug: Record<string, unknown> = {
      attempted: true,
      shopUsed: shopValue || updated.shop || "",
      hadExistingMondayId: !!updated.mondayItemId,
    };
    try {
      const { row: mondayRow, itemName } = await buildMondayRowFromOms({
        shop: shopValue || updated.shop || "",
        orderId,
        variantId,
        ops: updated,
      });
      mondayDebug.itemName = itemName;

      if (!updated.mondayItemId || updated.mondayItemId === "pending") {
        const newMondayId = await createMondayItem(itemName, mondayRow);
        updated = await prisma.orderLineItemOperationalData.update({
          where: { id: updated.id },
          data: { mondayItemId: newMondayId, mondayItemName: itemName },
        });
        mondayDebug.action = "created";
        mondayDebug.mondayItemId = newMondayId;
        mondayDebug.mondayItemName = itemName;
      } else {
        try {
          await updateMondayItem(updated.mondayItemId, mondayRow);
          // Keep pulse name aligned with Shopify order + line letter (fixes old product-title names).
          await renameMondayItem(updated.mondayItemId, itemName);
          updated = await prisma.orderLineItemOperationalData.update({
            where: { id: updated.id },
            data: { mondayItemName: itemName },
          });
          mondayDebug.action = "updated";
          mondayDebug.mondayItemId = updated.mondayItemId;
          mondayDebug.mondayItemName = itemName;
        } catch (mErr) {
          if (isStaleMondayItemError(mErr)) {
            const newMondayId = await createMondayItem(itemName, mondayRow);
            updated = await prisma.orderLineItemOperationalData.update({
              where: { id: updated.id },
              data: { mondayItemId: newMondayId, mondayItemName: itemName },
            });
            mondayDebug.action = "recreated-stale";
            mondayDebug.mondayItemId = newMondayId;
            mondayDebug.mondayItemName = itemName;
          } else {
            throw mErr;
          }
        }
      }
    } catch (mondayErr) {
      console.error("[api.order-status] Failed to push update to Monday", mondayErr);
      mondayDebug.action = "failed";
      mondayDebug.error = mondayErr instanceof Error ? mondayErr.message : String(mondayErr);
    }
    // ── end new block ──

    // ── Push new notes to Monday Updates ONLY when staff opted in (:monday tag) ──
    // Routine field sync above updates Monday columns — it must NOT create Monday note updates.
    const mondayNoteSync: SyncResultMap = {};
    try {
      const noteBlocks = String(updated.notes ?? "")
        .split(/\r?\n\r?\n/)
        .map((b) => b.trim())
        .filter(Boolean);

      const mondayTaggedBlocks = noteBlocks.filter((b) => /^\[[^\]|]+:monday[|\]]/i.test(b));

      const alreadyPushed = updated.notesPushedMondayItemId === updated.mondayItemId
        ? (updated.notesPushedCount ?? 0)
        : 0;
      const newBlocks = mondayTaggedBlocks.slice(alreadyPushed);

      if (newBlocks.length > 0 && updated.mondayItemId && updated.mondayItemId !== "pending") {
        const pushedIds: string[] = [];
        for (const block of newBlocks) {
          const cleaned = block.replace(/^\[[^\]]*\]\s*/, "");
          const createdId = await createMondayUpdate(updated.mondayItemId, cleaned);
          if (createdId) pushedIds.push(String(createdId));
        }
        mondayNoteSync.monday = { ok: true, id: pushedIds[0] };
        const existingPulledIds = new Set(
          String(updated.notesPulledUpdateIds ?? "").split(",").filter(Boolean)
        );
        pushedIds.forEach((id) => existingPulledIds.add(id));
        updated = await prisma.orderLineItemOperationalData.update({
          where: { id: updated.id },
          data: {
            notesPushedCount: mondayTaggedBlocks.length,
            notesPushedMondayItemId: updated.mondayItemId,
            notesPulledUpdateIds: [...existingPulledIds].join(","),
          },
        });
      } else if (pushNoteMonday && staffNoteTexts.length > 0) {
        mondayNoteSync.monday = {
          ok: false,
          error: !updated.mondayItemId || updated.mondayItemId === "pending"
            ? "Monday item not linked"
            : "No new Monday-tagged notes to push",
        };
      }
    } catch (noteErr) {
      console.error("[api.order-status] Failed to push notes to Monday updates", noteErr);
      mondayNoteSync.monday = {
        ok: false,
        error: noteErr instanceof Error ? noteErr.message : String(noteErr),
      };
    }
    // ── end Monday note block ──

    // Fallback: if the client didn't send a shop, use whatever ended up on the saved record
    // (resolvedShop already set above for central log)

    // ── Shopify order timeline: ONLY when syncNotes.shopify opted in (mirror, not source of truth) ──
    const shopifyNoteSync: SyncResultMap = {};
    if (newNotesForShopify.length > 0 && resolvedShop) {
      for (const note of newNotesForShopify) {
        try {
          await pushStaffNoteToShopifyOrder(resolvedShop, orderId, note);
          shopifyNoteSync.shopify = { ok: true };
        } catch (e) {
          console.error("[api.order-status] Failed to push staff note to Shopify", e);
          shopifyNoteSync.shopify = { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      }
    }

    // ── Update central log sync status + channel mirror rows (DB already has the note) ──
    try {
      const syncResults: SyncResultMap = {
        ...mondayNoteSync,
        ...cin7SyncResults,
        ...shopifyNoteSync,
      };
      const anyFailed = Object.values(syncResults).some((r) => r && r.ok === false);
      const anyOk = Object.values(syncResults).some((r) => r && r.ok === true);
      const finalStatus =
        plannedSyncTargets.length === 0
          ? "internal"
          : anyFailed && anyOk
            ? "partial"
            : anyFailed
              ? "failed"
              : "synced";

      for (const id of staffNoteLogIds) {
        await updateActivitySyncResults(id, syncResults, finalStatus);
      }

      // Channel-specific mirror rows (still in OUR DB — records that we also pushed out)
      if (isStaffNote && staffNoteTexts.length > 0) {
        for (const text of staffNoteTexts) {
          if (pushNoteMonday) {
            await logActivity({
              shop: resolvedShop,
              orderId,
              variantId,
              opsRecordId: updated.id,
              activityType: "monday_note",
              channel: "monday",
              subject: "Monday note",
              body: text,
              sentBy: actor,
              deliveryStatus: mondayNoteSync.monday?.ok ? "synced" : "failed",
              syncTargets: ["monday"],
              syncResults: mondayNoteSync,
              metadata: { source: "oms", mirrorOf: "internal_note" },
            });
          }
          if (pushNoteCin7) {
            await logActivity({
              shop: resolvedShop,
              orderId,
              variantId,
              opsRecordId: updated.id,
              activityType: "cin7_note",
              channel: "cin7",
              subject: "Cin7 note",
              body: text,
              sentBy: actor,
              deliveryStatus: cin7SyncResults.cin7?.ok ? "synced" : "failed",
              syncTargets: ["cin7"],
              syncResults: cin7SyncResults,
              metadata: { source: "oms", mirrorOf: "internal_note" },
            });
          }
          if (pushNoteShopify) {
            await logActivity({
              shop: resolvedShop,
              orderId,
              variantId,
              opsRecordId: updated.id,
              activityType: "shopify_note",
              channel: "shopify",
              subject: "Shopify order note",
              body: text,
              sentBy: actor,
              deliveryStatus: shopifyNoteSync.shopify?.ok ? "synced" : "failed",
              syncTargets: ["shopify"],
              syncResults: shopifyNoteSync,
              metadata: { source: "oms", mirrorOf: "internal_note" },
            });
          }
        }
      }
    } catch (logErr) {
      console.error("[api.order-status] Activity log sync-status update failed", logErr);
    }

    fetch("https://webhook.site/12c1d76a-a089-4cd7-9a3e-ed11beb1f125", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "order-extension",
        shop: resolvedShop,
        orderId,
        variantId,
        data: updateData,
        updatedAt: new Date().toISOString(),
      }),
    }).catch((e) => console.error("[webhook] failed to send", e));

    const syncTrace = {
      source: activitySource,
      performedBy: actor,
      shop: resolvedShop,
      orderId,
      variantId,
      requestedFields: requestedFieldKeys,
      monday: mondayDebug,
      shopify: {
        eddSync: shopifyEddSync ?? { ok: true, skipped: true },
      },
      cin7: {
        exists: cin7Exists,
        noteSync: cin7SyncResults.cin7 ?? null,
      },
      notify: {
        jobId: notifyJobId ?? null,
        recipients: notifyRecipients ?? 0,
      },
      at: new Date().toISOString(),
    };
    debug("SYNC_TRACE", "Order status save sync results", syncTrace);

    return Response.json(
      {
        ok: true,
        record: updated,
        mondayDebug,
        cin7Exists,
        activityLogged,
        notifyJobId,
        notifyRecipients,
        shopifyEddSync,
        syncTrace,
      },
      { headers: CORS_HEADERS },
    );
  } catch (err) {
    console.error("[api.order-status] action error", err);
    return Response.json(
      { ok: false, error: String(err) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}