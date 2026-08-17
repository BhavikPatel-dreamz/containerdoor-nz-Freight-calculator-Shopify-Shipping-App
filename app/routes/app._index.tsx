/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import FreightDashboard from "../components/FreightDashboard";
import { NavUserAvatar } from "../components/freight/NavUserAvatar";
import { normalizePaymentStatus } from "../lib/freight-orders.server";
import { buildCin7SalesOrderUrl } from "../lib/cin7-adapter.server";

const PAGE_SIZE = 25;

// Tab key → the customerStatus it filters on (null = no status filter).
const TAB_STATUS: Record<string, string | null> = {
  all: null,
  awaiting: "confirmed",
  dispatch: "dispatched",
  complete: "delivered",
};

const statusOf = (v: any): any =>
  typeof v === "string" && v.trim() ? v.trim().toLowerCase() : undefined;
const listOf = (v: any): string[] =>
  typeof v === "string" && v.trim()
    ? v.split(",").map((s: string) => s.trim()).filter(Boolean)
    : [];

// ─── Loader ───────────────────────────────────────────────────────────────────
// Search / filter / sort / pagination all run in Postgres, by line item.

export async function loader({ request }: LoaderFunctionArgs) {
  const { authenticate } = await import("../shopify.server");
  const { currentUserFromSession } = await import("../lib/current-user.server");
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const currentUser = currentUserFromSession(session);

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const tab = url.searchParams.get("tab") || "all";
  const supplier = (url.searchParams.get("supplier") || "").trim();
  const warehouseStatus = (url.searchParams.get("warehouseStatus") || "").trim();
  const carrier = (url.searchParams.get("carrier") || "").trim();
  const paymentStatus = (url.searchParams.get("paymentStatus") || "").trim();
  const eddDateRaw = (url.searchParams.get("eddDate") || "").trim();
  const eddDateEndRaw = (url.searchParams.get("eddDateEnd") || "").trim();
  const eddDate = eddDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(eddDateRaw) ? eddDateRaw : "";
  const eddDateEnd = eddDateEndRaw && /^\d{4}-\d{2}-\d{2}$/.test(eddDateEndRaw) ? eddDateEndRaw : "";
  const requestedPage = Math.max(Number(url.searchParams.get("page") || "1"), 1);

  const conds: Prisma.Sql[] = [Prisma.sql`idx."shop" = ${shop}`];
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    conds.push(Prisma.sql`(
      idx."searchText" LIKE ${like}
      OR lower(idx."orderName") LIKE ${like}
      OR lower(idx."customerName") LIKE ${like}
      OR lower(idx."email") LIKE ${like}
      OR lower(idx."sku") LIKE ${like}
      OR lower(idx."productId") LIKE ${like}
      OR lower(idx."variantId") LIKE ${like}
      OR lower(ops."trackingNumber") LIKE ${like}
    )`);
  }
  if (supplier) {
    conds.push(Prisma.sql`idx."vendor" = ${supplier}`);
  }
  if (warehouseStatus) {
    conds.push(Prisma.sql`lower(ops."warehouseStatus") = ${warehouseStatus.toLowerCase()}`);
  }
  if (carrier) {
    const carrierLike = `%${carrier.toLowerCase()}%`;
    conds.push(Prisma.sql`(lower(idx."company") LIKE ${carrierLike} OR lower(idx."carriers") LIKE ${carrierLike})`);
  }
  if (paymentStatus) {
    conds.push(Prisma.sql`lower(ops."paymentStatus") = ${paymentStatus.toLowerCase()}`);
  }
  if (eddDate && eddDate.length > 0) {
    conds.push(Prisma.sql`DATE(NULLIF(ops."eddDate", '')) >= ${eddDate}::date`);
  }
  if (eddDateEnd && eddDateEnd.length > 0) {
    conds.push(Prisma.sql`DATE(NULLIF(ops."eddDate", '')) <= ${eddDateEnd}::date`);
  }
  const searchWhere = Prisma.join(conds, " AND ");

  const supplierRows = await prisma.$queryRaw<Array<{ vendor: string }>>`
    SELECT DISTINCT idx."vendor" FROM "OrderLineItemIndex" idx
    WHERE idx."shop" = ${shop} AND idx."vendor" <> ''
    ORDER BY idx."vendor" ASC
  `;
  const suppliers = supplierRows.map((r) => r.vendor);

  const [warehouseStatusRows, carrierRows] = await Promise.all([
    prisma.$queryRaw<Array<{ warehouseStatus: string }>>`
      SELECT DISTINCT lower(ops."warehouseStatus") AS "warehouseStatus"
      FROM "OrderLineItemOperationalData" ops
      WHERE ops."shop" = ${shop} AND ops."warehouseStatus" <> ''
      ORDER BY lower(ops."warehouseStatus") ASC
    `,
    prisma.$queryRaw<Array<{ company: string }>>`
      SELECT DISTINCT idx."company" FROM "OrderLineItemIndex" idx
      WHERE idx."shop" = ${shop} AND idx."company" <> ''
      ORDER BY idx."company" ASC
    `,
  ]);
  const warehouseStatuses = warehouseStatusRows.map((r) => r.warehouseStatus);
  const carriers = carrierRows.map((r) => r.company);

  const countRows = await prisma.$queryRaw<
    Array<{ total_all: number; awaiting: number; dispatched: number; completed: number; pending_notify: number }>
  >`
    SELECT
      COUNT(*)::int AS total_all,
      COUNT(*) FILTER (WHERE lower(ops."customerStatus") = 'confirmed')::int AS awaiting,
      COUNT(*) FILTER (WHERE lower(ops."customerStatus") = 'dispatched')::int AS dispatched,
      COUNT(*) FILTER (WHERE lower(ops."customerStatus") = 'delivered')::int AS completed,
      COUNT(*) FILTER (WHERE lower(ops."customerStatus") = 'dispatched' AND coalesce(ops."trackingNumber", '') = '')::int AS pending_notify
    FROM "OrderLineItemIndex" idx
    LEFT JOIN "OrderLineItemOperationalData" ops
      ON idx."shop" = ops."shop" AND idx."orderId" = ops."orderId" AND idx."variantId" = ops."variantId"
    WHERE ${searchWhere}
  `;
  const c = countRows[0] ?? { total_all: 0, awaiting: 0, dispatched: 0, completed: 0, pending_notify: 0 };

  const total =
    tab === "awaiting" ? c.awaiting
    : tab === "dispatch" ? c.dispatched
    : tab === "complete" ? c.completed
    : c.total_all;
  const pageCount = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const page = Math.min(Math.max(requestedPage, 1), pageCount);
  const offset = (page - 1) * PAGE_SIZE;

  const tabStatus = TAB_STATUS[tab] ?? null;
  const rowConds = [...conds];
  if (tabStatus) rowConds.push(Prisma.sql`lower(ops."customerStatus") = ${tabStatus}`);
  const rowWhere = Prisma.join(rowConds, " AND ");

  const rows = await prisma.$queryRaw<any[]>`
    WITH order_carrier_counts AS (
      -- Use the ORIGINAL carrier from the freight code (o."company") only —
      -- not the live/editable ops carrier — so isDepot never flips after
      -- checkout due to a later per-line sync/edit.
      SELECT
        o."orderId",
        COUNT(DISTINCT o."company") AS distinct_carrier_count
      FROM "OrderLineItemIndex" o
      WHERE o."shop" = ${shop}
      GROUP BY o."orderId"
    )
    SELECT
      idx."id" AS line_index_id,
      idx."orderId", idx."variantId", idx."shopifyOrderId", idx."gid", idx."orderName",
      idx."letterSuffix", idx."customerName", idx."email", idx."phone", idx."city", idx."zip",
      idx."fullAddress", idx."createdAt", idx."currency", idx."totalFreight", idx."carriers",
      idx."shippingTitle", idx."productTitle", idx."productId", idx."variantTitle", idx."sku", idx."vendor", idx."company",
      idx."boxes", idx."amount", idx."financialStatus", idx."fulfillmentStatus",
       ops."customerStatus", ops."customerStatusColor" AS ops_customer_status_color, ops."carrier" AS ops_carrier, ops."carrierColor" AS ops_carrier_color, ops."paymentStatus" AS ops_payment_status, ops."paymentStatusColor" AS ops_payment_status_color, ops."trackingNumber", ops."freightRef", ops."eddDate", ops."originalEddDate",
      ops."warehouseStatus", ops."warehouseStatusColor" AS ops_warehouse_status_color, ops."dispatchStatus", ops."deliveryStatus", ops."depositPaid", ops."balanceDue",
      ops."supplierContainer", ops."receivedDate", ops."portArrivalDate", ops."inTransitDate",
      ops."depotAddress1", ops."depotCity", ops."depotZip",
      ops."cin7SalesOrderId" AS ops_cin7, ops."cin7CachedStatus", ops."cin7CachedMismatches", ops."mondayCachedStatus", ops."mondayCachedMismatches",
      ood."cin7SalesOrderId" AS ood_cin7, ood."poNumber" AS ood_po,
      snap."id" AS snapshot_id, snap."shippingCode" AS snapshot_shipping_code,
      occ."distinct_carrier_count" AS distinct_carrier_count
    FROM "OrderLineItemIndex" idx
    LEFT JOIN "OrderLineItemOperationalData" ops
      ON idx."shop" = ops."shop" AND idx."orderId" = ops."orderId" AND idx."variantId" = ops."variantId"
    LEFT JOIN "OrderOperationalData" ood
      ON idx."shop" = ood."shop" AND idx."orderId" = ood."orderId"
    LEFT JOIN "OrderSnapshot" snap
      ON idx."shop" = snap."shop" AND idx."orderId" = snap."orderId"
    LEFT JOIN order_carrier_counts occ
      ON occ."orderId" = idx."orderId"
    WHERE ${rowWhere}
    ORDER BY idx."createdAt" DESC, idx."orderId" DESC, idx."letterSuffix" ASC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `;

  const orders = rows.map((r) => {
    const variantId = String(r.variantId);
    const lineCin7 = String(r.ops_cin7 || "").trim();
    const orderCin7 = String(r.ood_cin7 || "").trim();
    const cin7Exists = Boolean(
      (lineCin7 && lineCin7 !== "pending" && lineCin7 !== "duplicate") ||
        (orderCin7 && orderCin7 !== "pending" && orderCin7 !== "duplicate"),
    );
    const item = {
      id: `${r.orderId}-${variantId}`,
      lineIndexId: String(r.line_index_id || ""),
      variantId,
      title: r.productTitle || "",
      variantTitle: r.variantTitle || "",
      vendor: r.vendor || "",
      sku: r.sku || "",
      productId: r.productId || "",
      // Prefer OMS carrier override; fall back to freight code on index (same as detail page)
      company: (r.ops_carrier && String(r.ops_carrier).trim()) || r.company || "",
      carrierColor: r.ops_carrier_color || "",
      boxes: Number(r.boxes ?? 0),
      amount: Number(r.amount ?? 0),
      letterSuffix: r.letterSuffix || "",
      customerStatus: r.customerStatus ?? "",
      customerStatusColor: r.ops_customer_status_color || "",
      paymentStatus: (r.ops_payment_status && String(r.ops_payment_status).trim()) || normalizePaymentStatus(r.financialStatus),
      paymentStatusColor: r.ops_payment_status_color || "",
      trackingNumber: r.trackingNumber ?? "",
      freightRef: r.freightRef ?? "",
      eddDate: r.eddDate ?? "",
      originalEddDate: r.originalEddDate ?? "",
      depotAddress1: r.depotAddress1 ?? "",
      depotCity: r.depotCity ?? "",
      depotZip: r.depotZip ?? "",
      // Business rule: depot orders always ship every line via the same carrier;
      // standard orders can have a different carrier per line. If the
      // shippingCode says "depot" but the order's lines actually have
      // different carriers, it can't really be depot — same check as the
      // detail page (buildRowFromSnapshot) so both pages always agree.
      isDepot:
        String(r.snapshot_shipping_code ?? "").startsWith("depot_delivery::") &&
        Number(r.distinct_carrier_count ?? 1) <= 1,
      cin7SalesOrderId: lineCin7 || "",
      cin7SalesOrderUrl: buildCin7SalesOrderUrl(lineCin7 || orderCin7) || "",
      warehouseStatus: r.warehouseStatus ?? "",
      	warehouseStatusColor: r.ops_warehouse_status_color || "",
      dispatchStatus: r.dispatchStatus ?? "",
      deliveryStatus: r.deliveryStatus ?? "",
      depositPaid: r.depositPaid ?? "",
      balanceDue: r.balanceDue ?? "",
      poNumber: r.ood_po ?? "",
      supplierContainer: r.supplierContainer ?? "",
      receivedDate: r.receivedDate ?? "",
      portArrivalDate: r.portArrivalDate ?? "",
      inTransitDate: r.inTransitDate ?? "",
      cin7Exists,
      cin7Status: statusOf(r.cin7CachedStatus),
      cin7Mismatches: listOf(r.cin7CachedMismatches),
      mondayStatus: statusOf(r.mondayCachedStatus),
      mondayMismatches: listOf(r.mondayCachedMismatches),
    };
    return {
      id: r.gid || `gid://shopify/Order/${r.orderId}`,
      // OrderSnapshot.id (cuid) — detail URL `/app/order/:snapshotId`
      snapshotId: String(r.snapshot_id || ""),
      // Must equal OrderSnapshot.orderId / OrderLineItemOperationalData.orderId
      // so API calls still hit Shopify numeric order id.
      shopifyOrderId: String(r.orderId),
      shopifyOrderName: r.orderName || "",
      currency: r.currency || "NZD",
      totalFreight: Number(r.totalFreight ?? 0),
      city: r.city || null,
      postalCode: r.zip || null,
      createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
      carriers: r.carriers || "",
      packageCount: "",
      shippingTitle: r.shippingTitle || "",
      lineItems: [item],
      customerName: r.customerName || "—",
      email: r.email || "—",
      phone: r.phone || "—",
      financialStatus: r.financialStatus || "—",
      fulfillmentStatus: r.fulfillmentStatus || "UNFULFILLED",
      fullAddress: r.fullAddress || "",
    };
  });

  const counts = {
    totalLineItems: c.total_all,
    awaitingCount: c.awaiting,
    dispatchedCount: c.dispatched,
    pendingNotifyCount: c.pending_notify,
    completedCount: c.completed,
  };

  return { orders, counts, total, page, pageCount, shop, suppliers, supplier, warehouseStatuses, carriers, activeFilters: { warehouseStatus, carrier, paymentStatus }, currentUser };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Index() {
  const { orders, counts, total, page, pageCount, shop, suppliers, warehouseStatuses, carriers, activeFilters, currentUser } = useLoaderData<typeof loader>();

  return (
    <FreightDashboard
      orders={orders as any}
      counts={counts}
      suppliers={suppliers}
      warehouseStatuses={warehouseStatuses}
      carriers={carriers}
      activeFilters={activeFilters}
      total={total}
      page={page}
      pageCount={pageCount}
      shop={shop}
      noteAuthor={currentUser.noteAuthor}
      navbarRight={
        <NavUserAvatar
          name={currentUser.name}
          email={currentUser.email}
          initials={currentUser.initials}
        />
      }
    />
  );
}
