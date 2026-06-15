/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { companyLabels } from "../lib/freight";
import { useState } from "react";


// ─── Types ────────────────────────────────────────────────────────────────────

type FreightLineItem = {
  id: string;
  variantId: string;
  title?: string;
  company: string;
  boxes: number;
  amount: number;
};

type FreightOrderRow = {
  id: string;
  shopifyOrderId: string;
  shopifyOrderName: string;
  currency: string;
  totalFreight: number;
  city: string | null;
  postalCode: string | null;
  createdAt: string;
  carriers: string;
  packageCount: string;
  lineItems: FreightLineItem[];
  shippingTitle: string;
  customerName: string;
  email: string;
  phone: string;
  financialStatus: string;
  fullAddress: string;
};

type ShopifyOrderNode = {
  id: string;
  name: string;
  createdAt: string;
  currencyCode: string;
  email?: string;
  phone?: string;
  displayFinancialStatus?: string;
  shippingAddress?: { city?: string; zip?: string; address1?: string; province?: string; country?: string; firstName?: string; lastName?: string };
  shippingLines: {
    nodes: Array<{
      title: string;
      code: string;
      originalPriceSet: {
        shopMoney: { amount: string; currencyCode: string };
      };
    }>;
  };
  lineItems: {
    nodes: Array<{
      id: string;
      title: string;
      variant?: { id: string };
    }>;
  };
};

// ─── Loader ───────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = Math.max(Number(url.searchParams.get("page") || "1"), 1);

  const response = await admin.graphql(`
    #graphql
    query FreightOrders($first: Int!) {
      orders(first: $first, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id
          name
          createdAt
          currencyCode
          shippingAddress { city zip address1 province country firstName lastName }
          email
          phone
          displayFinancialStatus
          shippingLines(first: 5) {
            nodes {
              title
              code
              originalPriceSet {
                shopMoney { amount currencyCode }
              }
            }
          }
          lineItems(first: 50) {
            nodes {
              id
              title
              variant { id }
            }
          }
        }
      }
    }
  `, { variables: { first: 250 } });

  const json = await response.json();
  const allOrders: ShopifyOrderNode[] = json.data?.orders?.nodes ?? [];

  const freightOrders = allOrders
    .map((order) => buildFreightOrderRow(order))
    .filter((row): row is FreightOrderRow => row !== null);

  const total = freightOrders.length;
  const pageCount = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const paged = freightOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return { orders: paged, total, page, pageCount };
}

// ─── Parse service_code and build row ─────────────────────────────────────────
// service_code format: standard_delivery::TGE,MAINFREIGHT::4boxes::variantId:COMPANYxBoxes|...

const FREIGHT_SERVICE_PREFIXES = [
  "standard_delivery::",
  "depot_delivery::",
  "customer_pickup::",
];

function buildFreightOrderRow(order: ShopifyOrderNode): FreightOrderRow | null {
  const shippingLine = order.shippingLines.nodes.find((s) =>
    FREIGHT_SERVICE_PREFIXES.some((prefix) => s.code?.startsWith(prefix))
  );
  if (!shippingLine) return null;

  const parts = shippingLine.code.split("::");
const carriers = parts[1];
const packageCount = parts[2];
const lineItemsRaw = parts[4]; 
if (!carriers || !lineItemsRaw) return null;

  // Map numeric variantId -> title from lineItems
  const variantTitleMap = new Map<string, string>();
  for (const li of order.lineItems.nodes) {
    if (li.variant?.id) {
      const numericId = li.variant.id.replace("gid://shopify/ProductVariant/", "");
      variantTitleMap.set(numericId, li.title);
    }
  }

  const lineItems: FreightLineItem[] = lineItemsRaw.split("|").map((part, idx) => {
    const [variantId, rest] = part.split(":");
    const [company, boxesStr, amountStr] = (rest ?? "").split("x");
    return {
      id: `${order.id}-${idx}`,
      variantId,
      title: variantTitleMap.get(variantId),
      company: company ?? "",
      boxes: Number(boxesStr ?? 0),
      amount: Number(amountStr ?? 0),
    };
  });

  const totalFreight = Number(shippingLine.originalPriceSet.shopMoney.amount ?? 0);

  return {
    id: order.id,
    shopifyOrderId: order.id.replace("gid://shopify/Order/", ""),
    shopifyOrderName: order.name,
    currency: order.currencyCode,
    totalFreight,
    city: order.shippingAddress?.city ?? null,
    postalCode: order.shippingAddress?.zip ?? null,
    createdAt: order.createdAt,
    carriers,
    packageCount,
    shippingTitle: shippingLine.title,
    lineItems,
    customerName: `${order.shippingAddress?.firstName ?? ""} ${order.shippingAddress?.lastName ?? ""}`.trim() || "—",
    email: order.email ?? "—",
    phone: order.phone ?? "—",
    financialStatus: order.displayFinancialStatus ?? "—",
    fullAddress: [
      order.shippingAddress?.address1,
      order.shippingAddress?.city,
      order.shippingAddress?.province,
      order.shippingAddress?.zip,
      order.shippingAddress?.country,
    ].filter(Boolean).join(", "),
  };
}

// ─── Page component ───────────────────────────────────────────────────────────

export default function FreightOrdersPage() {
  const { orders, total, page, pageCount } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const [viewOrder, setViewOrder] = useState<FreightOrderRow | null>(null); 

  const formatCurrency = (amount: number, currency: string) =>
    new Intl.NumberFormat("en-NZ", { style: "currency", currency }).format(amount);

  return (
    <div style={{ padding: "20px", fontFamily: "sans-serif" }}>
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0 }}>Freight Orders</h1>
        <p style={{ color: "#6b7280", marginTop: "4px", fontSize: "14px" }}>
          {total} orders — carrier selections from checkout
        </p>
      </div>

      {orders.length === 0 ? (
        <div style={{
          padding: "48px", textAlign: "center",
          border: "1px solid #e5e7eb", borderRadius: "8px", color: "#6b7280",
        }}>
          No freight orders yet. Orders appear here after checkout completes.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {orders.map((order) => (
            <div key={order.id} style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>

              {/* Order header */}
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "12px 16px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ fontWeight: 600, fontSize: "15px" }}>
                    {order.shopifyOrderName}
                  </span>
                  {order.city && (
                    <span style={{
                      fontSize: "12px", color: "#6b7280", background: "#f3f4f6",
                      padding: "2px 8px", borderRadius: "4px",
                    }}>
                      {order.city} {order.postalCode}
                    </span>
                  )}
                  <span style={{
                    fontSize: "12px", color: "#6b7280", background: "#f3f4f6",
                    padding: "2px 8px", borderRadius: "4px",
                  }}>
                    {order.packageCount} · {order.carriers}
                  </span>
                </div>
                {/* Customer info row */}
                <div style={{
                  display: "flex", gap: "24px", padding: "10px 16px",
                  background: "#fff", borderBottom: "1px solid #e5e7eb",
                  fontSize: "13px", color: "#374151", flexWrap: "wrap",
                }}>
                  <span><span style={{ color: "#6b7280" }}>Customer: </span><strong>{order.customerName}</strong></span>
                  <span><span style={{ color: "#6b7280" }}>Email: </span>{order.email}</span>
                  <span><span style={{ color: "#6b7280" }}>Phone: </span>{order.phone}</span>
                  <span><span style={{ color: "#6b7280" }}>Status: </span>
                    <span style={{
                      display: "inline-block", padding: "1px 8px", borderRadius: "10px", fontSize: "12px",
                      fontWeight: 500,
                      background: order.financialStatus === "paid" ? "#dcfce7" : "#fef3c7",
                      color: order.financialStatus === "paid" ? "#166534" : "#92400e",
                    }}>
                      {order.financialStatus}
                    </span>
                  </span>
                  <span style={{ color: "#6b7280" }}>{order.fullAddress}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <span style={{ fontSize: "13px", color: "#6b7280" }}>
                    {new Date(order.createdAt).toLocaleDateString("en-NZ", {
                      day: "numeric", month: "short", year: "numeric",
                    })}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: "15px" }}>
                    {formatCurrency(order.totalFreight, order.currency)}
                  </span>
                </div>
                {/* View / Edit button */}
                <div style={{ display: "flex", gap: "8px", marginLeft: "8px" }}>
                  <button
                    onClick={() => setViewOrder(order)}
                    style={{
                      padding: "4px 12px", fontSize: "13px", borderRadius: "6px",
                      border: "1px solid #e5e7eb", background: "#fff",
                      color: "#374151", cursor: "pointer",
                    }}
                  >
                    View
                  </button>
                  <Link to={`/app/freight-orders/${order.shopifyOrderId}`}
                    style={{
                      padding: "4px 12px", fontSize: "13px", borderRadius: "6px",
                      border: "1px solid #e5e7eb", background: "#111827",
                      color: "#fff", textDecoration: "none", cursor: "pointer",
                    }}
                  >
                    Edit
                  </Link>
                </div>
              </div>

              {/* Line items table */}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    <th style={thStyle}>Product</th>
                    <th style={thStyle}>Carrier</th>
                    <th style={thStyle}>Boxes</th>
                    <th style={thStyle}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lineItems.map((item, idx) => (
                    <tr key={item.id} style={{ background: idx % 2 === 0 ? "#fff" : "#f9fafb" }}>
                      <td style={tdStyle}>
                        {item.title ? (
                          <span style={{ fontWeight: 500 }}>{item.title}</span>
                        ) : (
                          <span style={{ fontFamily: "monospace", fontSize: "12px", color: "#6b7280" }}>
                            Variant #{item.variantId}
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <span style={{
                          display: "inline-block", padding: "2px 10px", borderRadius: "12px",
                          fontSize: "12px", fontWeight: 500,
                          background: carrierColor(item.company).bg,
                          color: carrierColor(item.company).text,
                        }}>
                          {companyLabels[item.company as keyof typeof companyLabels] ?? item.company}
                        </span>
                      </td>
                      <td style={tdStyle}>{item.boxes}</td>
                      <td style={tdStyle}>
                        {item.amount > 0 ? formatCurrency(item.amount, order.currency) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "2px solid #e5e7eb" }}>
                    <td colSpan={2} style={{ ...tdStyle, color: "#6b7280", fontSize: "13px" }}>
                      Total freight (incl. fuel surcharge &amp; GST)
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                      {formatCurrency(order.totalFreight, order.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>

            </div>
          ))}
          
        </div>
      )}
      

      {/* Pagination */}
      {pageCount > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginTop: "24px" }}>
          <button
            disabled={page <= 1}
            onClick={() => setSearchParams({ page: String(page - 1) })}
            style={paginationBtn(page <= 1)}
          >
            Previous
          </button>
          <span style={{ padding: "6px 12px", fontSize: "14px", color: "#6b7280" }}>
            Page {page} of {pageCount}
          </span>
          <button
            disabled={page >= pageCount}
            onClick={() => setSearchParams({ page: String(page + 1) })}
            style={paginationBtn(page >= pageCount)}
          >
            Next
          </button>
        </div>
      )}
    {/* View Order Modal */}
      {viewOrder && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
        }}
          onClick={() => setViewOrder(null)}
        >
          <div style={{
            background: "#fff", borderRadius: "10px", padding: "28px",
            width: "600px", maxWidth: "95vw", maxHeight: "85vh", overflowY: "auto",
            boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <div>
                <h2 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>{viewOrder.shopifyOrderName}</h2>
                <p style={{ color: "#6b7280", fontSize: "13px", margin: "4px 0 0" }}>
                  {new Date(viewOrder.createdAt).toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              </div>
              <button onClick={() => setViewOrder(null)} style={{
                background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#6b7280", lineHeight: 1,
              }}>✕</button>
            </div>

            {/* Info grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "20px" }}>
              {[
                ["Customer", viewOrder.customerName],
                ["Email", viewOrder.email],
                ["Phone", viewOrder.phone],
                ["Status", viewOrder.financialStatus],
                ["Freight cost", formatCurrency(viewOrder.totalFreight, viewOrder.currency)],
                ["Shipping method", viewOrder.shippingTitle],
              ].map(([label, value]) => (
                <div key={label} style={{ padding: "10px", border: "1px solid #e5e7eb", borderRadius: "6px", background: "#f9fafb" }}>
                  <div style={{ fontSize: "11px", color: "#6b7280", marginBottom: "3px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                  <div style={{ fontSize: "13px", fontWeight: 500 }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Address */}
            <div style={{ padding: "10px", border: "1px solid #e5e7eb", borderRadius: "6px", background: "#f9fafb", marginBottom: "20px" }}>
              <div style={{ fontSize: "11px", color: "#6b7280", marginBottom: "3px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Delivery address</div>
              <div style={{ fontSize: "13px", fontWeight: 500 }}>{viewOrder.fullAddress || "—"}</div>
            </div>

            {/* Line items */}
            <h3 style={{ fontSize: "13px", fontWeight: 600, marginBottom: "8px", color: "#374151" }}>Line items</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", marginBottom: "20px" }}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  {["Product", "Carrier", "Boxes", "Amount"].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontSize: "11px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {viewOrder.lineItems.map((item) => (
                  <tr key={item.id}>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6" }}>
                      {item.title ?? <span style={{ fontFamily: "monospace", color: "#6b7280" }}>#{item.variantId}</span>}
                    </td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6" }}>
                      <span style={{
                        display: "inline-block", padding: "2px 8px", borderRadius: "10px", fontSize: "12px", fontWeight: 500,
                        background: carrierColor(item.company).bg, color: carrierColor(item.company).text,
                      }}>
                        {companyLabels[item.company as keyof typeof companyLabels] ?? item.company}
                      </span>
                    </td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6" }}>{item.boxes}</td>
                    <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6" }}>
                      {item.amount > 0 ? formatCurrency(item.amount, viewOrder.currency) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Footer actions */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button onClick={() => setViewOrder(null)} style={{
                padding: "7px 16px", fontSize: "13px", borderRadius: "6px",
                border: "1px solid #e5e7eb", background: "#fff", color: "#374151", cursor: "pointer",
              }}>
                Close
              </button>
              <Link to={`/app/freight-orders/${viewOrder.shopifyOrderId}`}
                onClick={() => setViewOrder(null)}
                style={{
                  padding: "7px 16px", fontSize: "13px", borderRadius: "6px",
                  background: "#111827", color: "#fff", textDecoration: "none", cursor: "pointer",
                }}
              >
                Edit this order
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>  // this is the existing closing div of the component
  );
}


// ─── Styles ───────────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "8px 16px", textAlign: "left", fontSize: "12px", fontWeight: 600,
  color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em",
  borderBottom: "1px solid #e5e7eb",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 16px",
  borderBottom: "1px solid #f3f4f6",
};

const paginationBtn = (disabled: boolean): React.CSSProperties => ({
  padding: "6px 16px", fontSize: "14px", border: "1px solid #e5e7eb",
  borderRadius: "6px", background: disabled ? "#f9fafb" : "#fff",
  color: disabled ? "#9ca3af" : "#374151", cursor: disabled ? "not-allowed" : "pointer",
});

function carrierColor(company: string): { bg: string; text: string } {
  const colors: Record<string, { bg: string; text: string }> = {
    FLIWAY:      { bg: "#dbeafe", text: "#1e40af" },
    TGE:         { bg: "#dcfce7", text: "#166534" },
    MAINFREIGHT: { bg: "#fef3c7", text: "#92400e" },
    NZP:         { bg: "#f3e8ff", text: "#6b21a8" },
    CASTLE:      { bg: "#ffe4e6", text: "#9f1239" },
    M2H:         { bg: "#f0f9ff", text: "#0369a1" },
  };
  return colors[company] ?? { bg: "#f3f4f6", text: "#374151" };
}