/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import FreightDashboard from "../components/FreightDashboard";
import { normalizePaymentStatus } from "../lib/freight-orders.server";

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
// The OrderLineItemIndex holds the immutable order+item snapshot fields (built by
// the order webhooks + backfill); mutable status/tracking is joined live from
// OrderLineItemOperationalData, and cin7 existence from OrderOperationalData.

export async function loader({ request }: LoaderFunctionArgs) {
  const { authenticate } = await import("../shopify.server");
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const tab = url.searchParams.get("tab") || "all";
  const supplier = (url.searchParams.get("supplier") || "").trim();
  const warehouseStatus = (url.searchParams.get("warehouseStatus") || "").trim();
  const warehouseTag = (url.searchParams.get("warehouseTag") || "").trim();
  const carrier = (url.searchParams.get("carrier") || "").trim();
  const paymentStatus = (url.searchParams.get("paymentStatus") || "").trim();
  const requestedPage = Math.max(Number(url.searchParams.get("page") || "1"), 1);

  // Search predicate (shop + optional trigram search + supplier). Reused by rows
  // + counts. Search matches the denormalized lowercase `searchText` so a single
  // pg_trgm GIN index backs the leading-wildcard ILIKE (scales to ~1M rows).
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
  if (warehouseTag) {
    const tagLike = `%${warehouseTag.toLowerCase()}%`;
    conds.push(Prisma.sql`lower(ops."warehouseTags") LIKE ${tagLike}`);
  }
  if (carrier) {
    const carrierLike = `%${carrier.toLowerCase()}%`;
    conds.push(Prisma.sql`(lower(idx."company") LIKE ${carrierLike} OR lower(idx."carriers") LIKE ${carrierLike})`);
  }
  if (paymentStatus) {
    conds.push(Prisma.sql`lower(ops."paymentStatus") = ${paymentStatus.toLowerCase()}`);
  }
  const searchWhere = Prisma.join(conds, " AND ");

  // Distinct suppliers (Shopify Vendor) for the filter dropdown.
  const supplierRows = await prisma.$queryRaw<Array<{ vendor: string }>>`
    SELECT DISTINCT idx."vendor" FROM "OrderLineItemIndex" idx
    WHERE idx."shop" = ${shop} AND idx."vendor" <> ''
    ORDER BY idx."vendor" ASC
  `;
  const suppliers = supplierRows.map((r) => r.vendor);

  // Distinct filter options for dropdowns.
  const [warehouseStatusRows, warehouseTagRows, carrierRows] = await Promise.all([
    prisma.$queryRaw<Array<{ warehouseStatus: string }>>`
      SELECT DISTINCT lower(ops."warehouseStatus") AS "warehouseStatus"
      FROM "OrderLineItemOperationalData" ops
      WHERE ops."shop" = ${shop} AND ops."warehouseStatus" <> ''
      ORDER BY lower(ops."warehouseStatus") ASC
    `,
    prisma.$queryRaw<Array<{ warehouseTags: string }>>`
      SELECT DISTINCT trim(unnest(string_to_array(ops."warehouseTags", ','))) AS "warehouseTags"
      FROM "OrderLineItemOperationalData" ops
      WHERE ops."shop" = ${shop} AND ops."warehouseTags" <> ''
      ORDER BY trim(unnest(string_to_array(ops."warehouseTags", ','))) ASC
    `,
    prisma.$queryRaw<Array<{ company: string }>>`
      SELECT DISTINCT idx."company" FROM "OrderLineItemIndex" idx
      WHERE idx."shop" = ${shop} AND idx."company" <> ''
      ORDER BY idx."company" ASC
    `,
  ]);
  const warehouseStatuses = warehouseStatusRows.map((r) => r.warehouseStatus);
  const warehouseTags = warehouseTagRows.map((r) => r.warehouseTags).filter(Boolean);
  const carriers = carrierRows.map((r) => r.company);

  // Global counts (search applied, tab NOT applied) — feeds tab pills + stat cards.
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

  // Row predicate = search + optional tab status.
  const tabStatus = TAB_STATUS[tab] ?? null;
  const rowConds = [...conds];
  if (tabStatus) rowConds.push(Prisma.sql`lower(ops."customerStatus") = ${tabStatus}`);
  const rowWhere = Prisma.join(rowConds, " AND ");

  const rows = await prisma.$queryRaw<any[]>`
    SELECT
      idx."orderId", idx."variantId", idx."shopifyOrderId", idx."gid", idx."orderName",
      idx."letterSuffix", idx."customerName", idx."email", idx."phone", idx."city", idx."zip",
      idx."fullAddress", idx."createdAt", idx."currency", idx."totalFreight", idx."carriers",
      idx."shippingTitle", idx."productTitle", idx."productId", idx."variantTitle", idx."sku", idx."vendor", idx."company",
      idx."boxes", idx."amount", idx."financialStatus", idx."fulfillmentStatus",
      ops."customerStatus", ops."trackingNumber", ops."freightRef", ops."eddDate", ops."originalEddDate",
      ops."warehouseStatus", ops."warehouseTags", ops."dispatchStatus", ops."deliveryStatus", ops."depositPaid", ops."balanceDue",
      ops."supplierContainer", ops."receivedDate", ops."portArrivalDate", ops."inTransitDate",
      ops."cin7CachedStatus", ops."cin7CachedMismatches", ops."mondayCachedStatus", ops."mondayCachedMismatches",
      ood."cin7SalesOrderId" AS ood_cin7, ood."poNumber" AS ood_po
    FROM "OrderLineItemIndex" idx
    LEFT JOIN "OrderLineItemOperationalData" ops
      ON idx."shop" = ops."shop" AND idx."orderId" = ops."orderId" AND idx."variantId" = ops."variantId"
    LEFT JOIN "OrderOperationalData" ood
      ON idx."shop" = ood."shop" AND idx."orderId" = ood."orderId"
    WHERE ${rowWhere}
    ORDER BY idx."createdAt" DESC, idx."orderId" DESC, idx."letterSuffix" ASC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `;

  // Each SQL row → one FreightOrderRow carrying a single line item, so the
  // dashboard's flatMap + {order,item} handlers keep working unchanged.
  const orders = rows.map((r) => {
    const variantId = String(r.variantId);
    const cin7Exists = Boolean(r.ood_cin7 && r.ood_cin7 !== "pending");
    const item = {
      id: `${r.orderId}-${variantId}`,
      variantId,
      title: r.productTitle || "",
      variantTitle: r.variantTitle || "",
      vendor: r.vendor || "",
      sku: r.sku || "",
      productId: r.productId || "",
      company: r.company || "",
      boxes: Number(r.boxes ?? 0),
      amount: Number(r.amount ?? 0),
      letterSuffix: r.letterSuffix || "",
      customerStatus: r.customerStatus ?? "",
      paymentStatus: normalizePaymentStatus(r.financialStatus),
      trackingNumber: r.trackingNumber ?? "",
      freightRef: r.freightRef ?? "",
      eddDate: r.eddDate ?? "",
      originalEddDate: r.originalEddDate ?? "",
      warehouseStatus: r.warehouseStatus ?? "",
      warehouseTags: r.warehouseTags ?? "",
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

  return { orders, counts, total, page, pageCount, shop, suppliers, supplier, warehouseStatuses, warehouseTags, carriers, activeFilters: { warehouseStatus, warehouseTag, carrier, paymentStatus } };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FreightOrdersPage() {
  const { orders, counts, total, page, pageCount, shop, suppliers, warehouseStatuses, warehouseTags, carriers, activeFilters } = useLoaderData<typeof loader>();

  return (
    <FreightDashboard
      orders={orders as any}
      counts={counts}
      suppliers={suppliers}
      warehouseStatuses={warehouseStatuses}
      warehouseTags={warehouseTags}
      carriers={carriers}
      activeFilters={activeFilters}
      total={total}
      page={page}
      pageCount={pageCount}
      shop={shop}
      noteAuthor="SP"
      navbarRight={<div className="fo-avatar">SP</div>}
    />
  );
}
