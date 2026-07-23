/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import prisma from "../db.server";
import FreightDashboard from "../components/FreightDashboard";
import { freightServicePrefixes } from "../lib/freight";

const PAGE_SIZE = 25;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function normalizePaymentStatus(status?: string | null): string {
  const raw = (status ?? "").toString().trim();
  if (!raw) return "";
  const normalized = raw.toLowerCase();
  if (["paid", "fully_paid", "authorized", "captured", "complete"].includes(normalized)) return "Paid";
  if (["partial", "partially_paid", "partially_refunded"].includes(normalized)) return "Partial";
  if (["pending", "pending_payment", "unpaid", "authorized_pending_capture", "outstanding"].includes(normalized)) return "Pending";
  if (["overdue"].includes(normalized)) return "Overdue";
  if (["refunded"].includes(normalized)) return "Refunded";
  return raw;
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const { authenticate } = await import("../shopify.server");

  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const page = Math.max(Number(url.searchParams.get("page") || "1"), 1);

  // Fetch order snapshots from DB — no Shopify API call needed
  const snapshots = await prisma.orderSnapshot.findMany({
    where: { shop, carriers: { not: "" } },
    orderBy: { createdAt: "desc" },
  });

  // Batch-load operational data
  const allOpsData = await prisma.orderLineItemOperationalData.findMany({ where: { shop } });
  const opsMap = new Map(allOpsData.map((r) => [`${r.orderId}::${r.variantId}`, r]));

  const orderOpData = await prisma.orderOperationalData.findMany({
    where: { shop },
    select: { orderId: true, cin7SalesOrderId: true },
  });
  const orderCin7Map = new Map(
    orderOpData
      .filter((row) => Boolean(row.cin7SalesOrderId && row.cin7SalesOrderId !== "pending"))
      .map((row) => [row.orderId, true]),
  );

  // Build rows from snapshots (same shape as before)
  const freightOrders = snapshots
    .map((snap) => buildRowFromSnapshot(snap, opsMap, orderCin7Map))
    .filter((row): row is NonNullable<ReturnType<typeof buildRowFromSnapshot>> => Boolean(row));

  const total = freightOrders.length;
  const pageCount = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const paged = freightOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return { orders: paged, allOrders: freightOrders, total, page, pageCount, shop };
}

// ─── Build row from DB snapshot (replaces buildRow from Shopify API data) ─────

function buildRowFromSnapshot(
  snap: any,
  opsMap: Map<string, any>,
  orderCin7Map: Map<string, boolean>,
) {
  if (!snap.carriers || !snap.shippingCode) return null;

  const lineItemsRaw = snap.shippingCode.split("::")[4] ?? "";
  if (!lineItemsRaw) return null;

  let parsedLineItems: Array<{ id?: number; variantId?: number; title?: string; quantity?: number; sku?: string; price?: string; vendor?: string }> = [];
  try {
    parsedLineItems = JSON.parse(snap.lineItemsJson ?? "[]");
  } catch { /* empty */ }

  const variantTitleMap = new Map<string, string>();
  const variantSkuMap = new Map<string, string>();
  const variantVendorMap = new Map<string, string>();
  for (const li of parsedLineItems) {
    if (li.variantId != null) {
      const vid = String(li.variantId);
      if (li.title) variantTitleMap.set(vid, li.title);
      if (li.sku) variantSkuMap.set(vid, li.sku);
      if (li.vendor) variantVendorMap.set(vid, li.vendor);
    }
  }

  const lineItems = lineItemsRaw.split("|").map((part: string, idx: number) => {
    const [variantId, rest] = part.split(":");
    const [company, boxesStr, amountStr] = (rest ?? "").split("x");
    const ops = opsMap.get(`${snap.orderId}::${variantId}`);
    return {
      id: `${snap.orderId}-${idx}`,
      variantId,
      title: variantTitleMap.get(variantId) ?? ops?.productTitle ?? "",
      vendor: variantVendorMap.get(variantId) ?? "",
      sku: variantSkuMap.get(variantId) ?? "",
      productId: "",
      company: company ?? "",
      boxes: Number(boxesStr ?? 0),
      amount: Number(amountStr ?? 0),
      letterSuffix: LETTERS[idx % 26],
      customerStatus: ops?.customerStatus ?? "",
      paymentStatus: normalizePaymentStatus(snap.financialStatus),
      trackingNumber: ops?.trackingNumber ?? "",
      freightRef: ops?.freightRef ?? "",
      eddDate: ops?.eddDate ?? "",
      originalEddDate: ops?.originalEddDate ?? "",
      cin7Exists: orderCin7Map.get(snap.orderId) ?? false,
      cin7Status: typeof ops?.cin7CachedStatus === "string" && ops.cin7CachedStatus.trim()
        ? (ops.cin7CachedStatus.trim().toLowerCase() as any)
        : undefined,
      cin7Mismatches: typeof ops?.cin7CachedMismatches === "string" && ops.cin7CachedMismatches.trim()
        ? ops.cin7CachedMismatches.split(",").map((s: string) => s.trim()).filter(Boolean)
        : [],
      mondayStatus: typeof ops?.mondayCachedStatus === "string" && ops.mondayCachedStatus.trim()
        ? (ops.mondayCachedStatus.trim().toLowerCase() as any)
        : undefined,
      mondayMismatches: typeof ops?.mondayCachedMismatches === "string" && ops.mondayCachedMismatches.trim()
        ? ops.mondayCachedMismatches.split(",").map((s: string) => s.trim()).filter(Boolean)
        : [],
    };
  });

  return {
    id: `gid://shopify/Order/${snap.orderId}`,
    shopifyOrderId: snap.orderId,
    shopifyOrderName: snap.orderName,
    currency: snap.currencyCode,
    totalFreight: Number(snap.totalFreight ?? 0),
    city: snap.shippingCity || null,
    postalCode: snap.shippingZip || null,
    createdAt: snap.createdAt.toISOString(),
    carriers: snap.carriers,
    packageCount: snap.packageCount,
    shippingTitle: snap.shippingTitle,
    lineItems,
    customerName: `${snap.shippingFirstName} ${snap.shippingLastName}`.trim() || "—",
    email: snap.email || "—",
    phone: snap.phone || "—",
    financialStatus: snap.financialStatus || "—",
    fulfillmentStatus: snap.fulfillmentStatus || "UNFULFILLED",
    fullAddress: [snap.shippingAddress1, snap.shippingCity, snap.shippingProvince, snap.shippingZip, snap.shippingCountry].filter(Boolean).join(", "),
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FreightOrdersPage() {
  const { orders, allOrders, total, page, pageCount, shop } = useLoaderData<typeof loader>();

  return (
    <FreightDashboard
      orders={orders as any}
      allOrders={allOrders as any}
      total={total}
      page={page}
      pageCount={pageCount}
      shop={shop}
      noteAuthor="SP"
      navbarRight={<div className="fo-avatar">SP</div>}
    />
  );
}
