/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { companyLabels } from "../lib/freight";

// ─── Types ────────────────────────────────────────────────────────────────────

type FreightLineItem = {
  id: string;
  variantId: string;
  title?: string;
  company: string;
  boxes: number;
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
};

type ShopifyOrderNode = {
  id: string;
  name: string;
  createdAt: string;
  currencyCode: string;
  shippingAddress?: { city?: string; zip?: string };
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
          shippingAddress { city zip }
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

  const [, carriers, packageCount, , , , lineItemsRaw] = shippingLine.code.split("::");
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
    const [company, boxesStr] = (rest ?? "").split("x");
    return {
      id: `${order.id}-${idx}`,
      variantId,
      title: variantTitleMap.get(variantId),
      company: company ?? "",
      boxes: Number(boxesStr ?? 0),
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
  };
}

// ─── Page component ───────────────────────────────────────────────────────────

export default function FreightOrdersPage() {
  const { orders, total, page, pageCount } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();

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
              </div>

              {/* Line items table */}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                <thead>
                  <tr style={{ background: "#f9fafb" }}>
                    <th style={thStyle}>Product</th>
                    <th style={thStyle}>Carrier</th>
                    <th style={thStyle}>Boxes</th>
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
    </div>
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