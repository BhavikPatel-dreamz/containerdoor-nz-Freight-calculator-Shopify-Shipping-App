/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * sync-middleware.server.ts
 *
 * Central bidirectional sync hub. Our database is the single source of truth.
 *
 *   Monday ──┐                     ┌── Shopify
 *            ├──► our DB ◄────────┤
 *   Cin7   ──┘                     └── Admin UI
 *
 * Rules:
 *   1. Every external system writes ONLY to our DB first.
 *   2. After our DB is updated, the middleware pushes to ALL other systems.
 *   3. Each push function is idempotent — calling it twice with the same
 *      data is safe.  This prevents sync loops.
 *   4. The `source` param tells the middleware which system originated the
 *      change so it can skip pushing BACK to that system.
 */

import prisma from "../db.server";
import { syncChangesToShopify } from "./shopify-sync.server";
import { updateMondayItem } from "./monday.server";
import {
  syncCin7EstimatedDispatchDate,
  syncCin7TrackingNumber,
} from "./cin7.server";

// ─── Source identifiers ──────────────────────────────────────────────────────
export type SyncSource = "shopify" | "monday" | "cin7" | "admin" | "webhook";

// ─── Fields that can be synced between systems ───────────────────────────────
export interface LineItemSyncFields {
  shop: string;
  orderId: string;
  variantId: string;
  eddDate?: string;
  trackingNumber?: string;
  customerStatus?: string;
  dispatchStatus?: string;
  carrier?: string;
  warehouseStatus?: string;
  warehouseTags?: string;
  deliveryStatus?: string;
  portArrivalDate?: string;
  inTransitDate?: string;
  supplierContainer?: string;
  receivedDate?: string;
  depositPaid?: string;
  balanceDue?: string;
  paymentStatus?: string;
  notes?: string;
}

export interface OrderSyncFields {
  shop: string;
  orderId: string;
  customerStatus?: string;
  trackingNumber?: string;
  eddDate?: string;
}

// ─── Main: push line-item changes to every system EXCEPT the source ──────────

export async function pushLineItemToAllSystems(
  fields: LineItemSyncFields,
  source: SyncSource,
) {
  const { shop, orderId, variantId } = fields;
  if (!shop || !orderId || !variantId) return;

  const log = (target: string, ok: boolean, err?: string) => {
    const prefix = `[SyncMiddleware][${source}→${target}]`;
    if (ok) {
      console.log(`${prefix} shop=${shop} order=${orderId} variant=${variantId} OK`);
    } else {
      console.error(`${prefix} shop=${shop} order=${orderId} variant=${variantId} FAILED: ${err}`);
    }
  };

  // ── Push to Shopify (skip if source is shopify — it's already correct there) ──
  if (source !== "shopify") {
    try {
      await syncChangesToShopify({
        shop,
        orderId,
        variantId,
        ...(fields.eddDate !== undefined ? { eddDate: fields.eddDate } : {}),
        ...(fields.trackingNumber !== undefined ? { trackingNumber: fields.trackingNumber } : {}),
        ...(fields.dispatchStatus !== undefined ? { dispatchStatus: fields.dispatchStatus } : {}),
        ...(fields.customerStatus !== undefined ? { customerStatus: fields.customerStatus } : {}),
        ...(fields.warehouseStatus !== undefined ? { warehouseStatus: fields.warehouseStatus } : {}),
        ...(fields.warehouseTags !== undefined ? { warehouseTags: fields.warehouseTags } : {}),
        ...(fields.deliveryStatus !== undefined ? { deliveryStatus: fields.deliveryStatus } : {}),
        ...(fields.portArrivalDate !== undefined ? { portArrivalDate: fields.portArrivalDate } : {}),
        ...(fields.inTransitDate !== undefined ? { inTransitDate: fields.inTransitDate } : {}),
        ...(fields.supplierContainer !== undefined ? { supplierContainer: fields.supplierContainer } : {}),
        ...(fields.receivedDate !== undefined ? { receivedDate: fields.receivedDate } : {}),
        ...(fields.depositPaid !== undefined ? { depositPaid: fields.depositPaid } : {}),
        ...(fields.balanceDue !== undefined ? { balanceDue: fields.balanceDue } : {}),
        ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
      });
      log("shopify", true);
    } catch (e: any) {
      log("shopify", false, e?.message);
    }
  }

  // ── Push to Monday (skip if source is monday) ──
  if (source !== "monday") {
    try {
      const record = await prisma.orderLineItemOperationalData.findUnique({
        where: { shop_orderId_variantId: { shop, orderId, variantId } },
      });
      if (record?.mondayItemId && record.mondayItemId !== "pending") {
        await updateMondayItem(record.mondayItemId, {
          customerName: "",
          email: "",
          carriers: fields.carrier ?? record.carrier ?? "",
          trackingNumber: fields.trackingNumber ?? record.trackingNumber ?? "",
          eddDate: fields.eddDate ?? record.eddDate ?? "",
          originalEddDate: record.originalEddDate ?? "",
          productTitle: record.productTitle ?? "",
          sku: "",
          boxes: "",
          customerStatus: fields.customerStatus ?? record.customerStatus ?? "",
          paymentStatus: fields.paymentStatus ?? record.paymentStatus ?? "",
          shop,
          orderId,
          variantId,
          warehouseStatus: record.warehouseStatus ?? "",
          warehouseTags: record.warehouseTags ?? "",
          dispatchStatus: fields.dispatchStatus ?? record.dispatchStatus ?? "",
          deliveryStatus: record.deliveryStatus ?? "",
          depositPaid: record.depositPaid ?? "",
          balanceDue: record.balanceDue ?? "",
        });
        log("monday", true);
      }
    } catch (e: any) {
      log("monday", false, e?.message);
    }
  }

  // ── Push to Cin7 (skip if source is cin7) ──
  if (source !== "cin7") {
    try {
      const orderRecord = await prisma.orderOperationalData.findUnique({
        where: { shop_orderId: { shop, orderId } },
        select: { cin7SalesOrderId: true },
      });
      const salesOrderId = orderRecord?.cin7SalesOrderId?.trim();
      if (salesOrderId && salesOrderId !== "pending") {
        if (fields.eddDate !== undefined) {
          await syncCin7EstimatedDispatchDate({
            salesOrderId,
            eddDate: fields.eddDate,
            reference: orderId,
          });
        }
        if (fields.trackingNumber !== undefined) {
          await syncCin7TrackingNumber({
            salesOrderId,
            trackingNumber: fields.trackingNumber,
            reference: orderId,
          });
        }
        log("cin7", true);
      }
    } catch (e: any) {
      log("cin7", false, e?.message);
    }
  }
}

// ─── Main: push order-level changes to every system EXCEPT the source ────────

export async function pushOrderToAllSystems(
  fields: OrderSyncFields,
  source: SyncSource,
) {
  const { shop, orderId } = fields;
  if (!shop || !orderId) return;

  if (source !== "shopify") {
    try {
      await syncChangesToShopify({
        shop,
        orderId,
        ...(fields.customerStatus !== undefined ? { customerStatus: fields.customerStatus } : {}),
        ...(fields.trackingNumber !== undefined ? { trackingNumber: fields.trackingNumber } : {}),
        ...(fields.eddDate !== undefined ? { eddDate: fields.eddDate } : {}),
      });
    } catch {
      // logged inside syncChangesToShopify
    }
  }
}
