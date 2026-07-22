/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams, Link } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncCin7EstimatedDispatchDate } from "../lib/cin7.server";

// ─── Prisma model needed (see schema change below) ────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const orderId = params.orderId!;
  const shop = session.shop;

  const response = await admin.graphql(`
    #graphql
    query GetOrder($id: ID!) {
      order(id: $id) {
        id name createdAt currencyCode email phone displayFinancialStatus
        shippingAddress { firstName lastName address1 city province zip country }
        shippingLines(first: 5) {
          nodes { title code originalPriceSet { shopMoney { amount currencyCode } } }
        }
        lineItems(first: 50) {
          nodes {
            id title quantity
            originalUnitPriceSet { shopMoney { amount } }
            variant { id sku }
          }
        }
      }
    }
  `, { variables: { id: `gid://shopify/Order/${orderId}` } });

  const json = await response.json();
  const order = json.data?.order;
  if (!order) throw new Response("Order not found", { status: 404 });

  // Parse line items from service_code
  const shippingLine = order.shippingLines.nodes.find((s: any) =>
    ["standard_delivery::", "depot_delivery::", "customer_pickup::"].some(
      (p) => s.code?.startsWith(p)
    )
  );

  const codeParts = shippingLine?.code?.split("::") ?? [];
  const lineItemsRaw = codeParts[4] ?? "";

  // Build variantId -> carrier map from service_code
  const carrierMap = new Map<string, string>();
  if (lineItemsRaw) {
    for (const part of lineItemsRaw.split("|")) {
      const [variantId, rest] = part.split(":");
      const [company] = (rest ?? "").split("x");
      if (variantId && company) carrierMap.set(variantId, company);
    }
  }

  // Load existing per-line-item operational data
  const existingRecords = await prisma.orderLineItemOperationalData.findMany({
    where: { shop, orderId },
  });
  const existingMap = new Map(existingRecords.map((r) => [r.variantId, r]));
  const orderOperationalData = await prisma.orderOperationalData.findUnique({
    where: { shop_orderId: { shop, orderId } },
    select: { cin7SalesOrderId: true },
  });
  const cin7Exists = Boolean(orderOperationalData?.cin7SalesOrderId && orderOperationalData.cin7SalesOrderId !== "pending");

  // Attach carrier + existing data to each line item
  const lineItemsWithData = order.lineItems.nodes.map((item: any) => {
    const numericVariantId = item.variant?.id?.replace("gid://shopify/ProductVariant/", "") ?? "";
    const carrier = carrierMap.get(numericVariantId) ?? "";
    const existing = existingMap.get(numericVariantId) ?? null;
    return { ...item, numericVariantId, carrier, existing };
  });

  return { order, lineItemsWithData, shippingLine, codeParts, cin7Exists };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const orderId = params.orderId!;
  const shop = session.shop;
  const formData = await request.formData();

  // Each field is namespaced by variantId: e.g. "customerStatus__47889674387595"
  const variantIds = String(formData.get("variantIds") ?? "").split(",").filter(Boolean);

  for (const variantId of variantIds) {
    const get = (field: string) => String(formData.get(`${field}__${variantId}`) ?? "");
    const newEdd = get("eddDate");
    const newCustomerStatus = get("customerStatus");
    const existingRecord = await prisma.orderLineItemOperationalData.findUnique({
      where: { shop_orderId_variantId: { shop, orderId, variantId } },
    });

    const data = {
      productTitle:      get("productTitle"),
      carrier:           get("carrier"),
      customerStatus:    newCustomerStatus,
      customerStatusUpdatedAt: newCustomerStatus ? new Date() : undefined,
      warehouseStatus:   get("warehouseStatus"),
      dispatchStatus:    get("dispatchStatus"),
      deliveryStatus:    get("deliveryStatus"),
      trackingNumber:    get("trackingNumber"),
      eddDate:           newEdd,
      eddDateUpdatedAt:  newEdd ? new Date() : undefined,
      originalEddDate:   existingRecord?.originalEddDate
        ? existingRecord.originalEddDate
        : existingRecord?.eddDate
          ? existingRecord.eddDate
          : newEdd,
      depositPaid:       get("depositPaid"),
      balanceDue:        get("balanceDue"),
      notes:             get("notes"),
      supplierContainer: get("supplierContainer"),
      portArrivalDate:   get("portArrivalDate"),
      inTransitDate:     get("inTransitDate"),
    };

    await prisma.orderLineItemOperationalData.upsert({
      where:  { shop_orderId_variantId: { shop, orderId, variantId } },
      update: data,
      create: { shop, orderId, variantId, ...data },
    });

    const orderOperationalData = await prisma.orderOperationalData.findUnique({
      where: { shop_orderId: { shop, orderId } },
    });
    const cin7SalesOrderId = orderOperationalData?.cin7SalesOrderId?.trim() || "";
    if (newEdd && cin7SalesOrderId && cin7SalesOrderId !== "pending") {
      await syncCin7EstimatedDispatchDate({
        salesOrderId: cin7SalesOrderId,
        eddDate: newEdd,
        reference: orderId,
      });
    }

    // Fire webhook to Cin7 (non-blocking, don't fail the save if this fails)
    fetch("https://webhook.site/12c1d76a-a089-4cd7-9a3e-ed11beb1f125", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "admin-app",
        shop,
        orderId,
        variantId,
        data,
        updatedAt: new Date().toISOString(),
      }),
    }).catch((e) => console.error("[webhook] failed to send", e));
  }

  const orderOperationalData = await prisma.orderOperationalData.findUnique({
    where: { shop_orderId: { shop, orderId } },
    select: { cin7SalesOrderId: true },
  });

  return { ok: true, message: "Saved successfully", cin7Exists: Boolean(orderOperationalData?.cin7SalesOrderId && orderOperationalData.cin7SalesOrderId !== "pending") };
}


export default function FreightOrderDetailPage() {
  const { order, lineItemsWithData, shippingLine, codeParts, cin7Exists } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const highlightVariantId = searchParams.get("variantId") ?? "";
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  const freightAmount = Number(shippingLine?.originalPriceSet?.shopMoney?.amount ?? 0);
const totalBoxes = codeParts[2]?.replace("boxes", "") ?? "—";
const weightKg = codeParts[5]?.replace("kg", "") ?? "—";
const cbm = codeParts[6]?.replace("cbm", "") ?? "—";
  

  const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-NZ", { style: "currency", currency: order.currencyCode || "NZD" }).format(amount);

  const customerName = `${order.shippingAddress?.firstName ?? ""} ${order.shippingAddress?.lastName ?? ""}`.trim() || "—";

  return (
    <div style={{ padding: "20px", fontFamily: "sans-serif", maxWidth: "900px" }}>

      {/* Back */}
      <Link to="/app/freight-orders" style={{ fontSize: "13px", color: "#6b7280", textDecoration: "none" }}>
        ← Back to orders
      </Link>

      <h1 style={{ fontSize: "20px", fontWeight: 600, margin: "12px 0 4px" }}>
        {order.name}
      </h1>
      <p style={{ color: "#6b7280", fontSize: "13px", margin: "0 0 8px" }}>
        {new Date(order.createdAt).toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" })}
      </p>
      <div style={{ marginBottom: "20px" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 600, background: cin7Exists ? "#dcfce7" : "#fee2e2", color: cin7Exists ? "#166534" : "#991b1b" }}>
          {cin7Exists ? "✓ In Cin7" : "✕ Not in Cin7"}
        </span>
      </div>

      {actionData?.message && (
        <div style={{
          padding: "10px 16px", borderRadius: "6px", marginBottom: "16px", fontSize: "13px",
          background: actionData.ok ? "#dcfce7" : "#fee2e2",
          color: actionData.ok ? "#166534" : "#991b1b",
        }}>
          {actionData.message}
        </div>
      )}

      {/* Order summary */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
        {[
          ["Customer",        customerName],
          ["Email",           order.email ?? "—"],
          ["Phone",           order.phone ?? "—"],
          ["Payment status",  order.displayFinancialStatus ?? "—"],
          ["Freight cost",    formatCurrency(freightAmount)],
          ["Shipping method", shippingLine?.title ?? "—"],
          ["Boxes / Packages", totalBoxes],
          ["Weight (KG)", weightKg],
          ["CBM", cbm],
        ].map(([label, value]) => (
          <div key={label} style={{
            padding: "12px", border: "1px solid #e5e7eb",
            borderRadius: "6px", background: "#f9fafb",
          }}>
            <div style={{ fontSize: "11px", color: "#6b7280", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
            <div style={{ fontSize: "14px", fontWeight: 500 }}>{value}</div>
          </div>
        ))}
      </div>

     
      {/* Line items + per-item operational fields */}
<Form method="post">
  <input type="hidden" name="variantIds"
    value={lineItemsWithData.map((item: any) => item.numericVariantId).join(",")} />


  {lineItemsWithData.map((item: any) => {
    const v = item.numericVariantId;
    const ex = item.existing;
    const unitPrice = Number(item.originalUnitPriceSet?.shopMoney?.amount ?? 0);
    const total = unitPrice * (item.quantity ?? 1);
    const isHighlighted = highlightVariantId && v === highlightVariantId;

    return (
      <div key={item.id} style={{
        border: isHighlighted ? "2px solid #2563eb" : "1px solid #e5e7eb",
        borderRadius: "8px",
        marginBottom: "20px", overflow: "hidden",
        boxShadow: isHighlighted ? "0 0 0 3px rgba(37,99,235,0.15)" : undefined,
      }}>
        <input type="hidden" name={`productTitle__${v}`} value={item.title ?? ""} />
        {/* Product header */}
        <div style={{
          padding: "12px 16px", background: "#f9fafb",
          borderBottom: "1px solid #e5e7eb",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <span style={{ fontWeight: 600, fontSize: "14px" }}>{item.title}</span>
            <span style={{ marginLeft: "12px", fontSize: "12px", color: "#6b7280", fontFamily: "monospace" }}>
              SKU: {item.variant?.sku || "—"} · Variant: {v}
            </span>
          </div>
          <div style={{ fontSize: "13px", color: "#374151" }}>
            Qty: <strong>{item.quantity}</strong>
            {unitPrice > 0 && (
              <span style={{ marginLeft: "16px" }}>
                {formatCurrency(unitPrice)} × {item.quantity} = <strong>{formatCurrency(total)}</strong>
              </span>
            )}
          </div>
        </div>

        {/* Carrier badge (read-only from service_code) */}
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", gap: "8px", alignItems: "center" }}>
          <span style={{ fontSize: "12px", color: "#6b7280" }}>Carrier from checkout:</span>
          <span style={{
            display: "inline-block", padding: "2px 10px", borderRadius: "12px",
            fontSize: "12px", fontWeight: 500,
            background: carrierColor(item.carrier).bg, color: carrierColor(item.carrier).text,
          }}>
            {item.carrier || "—"}
          </span>
        </div>

        {/* Operational fields */}
        <div style={{ padding: "16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>

          {/* Row 1: Status selects */}
          <label style={labelStyle}>
            Customer status
            <select name={`customerStatus__${v}`} defaultValue={ex?.customerStatus ?? ""} style={inputStyle}>
              <option value="">— Select —</option>
              <option value="Pending">Pending</option>
              <option value="Confirmed">Confirmed</option>
              <option value="Dispatched">Dispatched</option>
              <option value="Delivered">Delivered</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </label>

          <label style={labelStyle}>
            Warehouse status
            <select name={`warehouseStatus__${v}`} defaultValue={ex?.warehouseStatus ?? ""} style={inputStyle}>
              <option value="">— Select —</option>
              <option value="Not received">Not received</option>
              <option value="Received">Received</option>
              <option value="Processing">Processing</option>
              <option value="Ready to dispatch">Ready to dispatch</option>
              <option value="Dispatched">Dispatched</option>
            </select>
          </label>

          <label style={labelStyle}>
            Dispatch status
            <select name={`dispatchStatus__${v}`} defaultValue={ex?.dispatchStatus ?? ""} style={inputStyle}>
              <option value="">— Select —</option>
              <option value="Not dispatched">Not dispatched</option>
              <option value="Booked">Booked</option>
              <option value="Dispatched">Dispatched</option>
              <option value="Failed">Failed</option>
            </select>
          </label>

          <label style={labelStyle}>
            Delivery status
            <select name={`deliveryStatus__${v}`} defaultValue={ex?.deliveryStatus ?? ""} style={inputStyle}>
              <option value="">— Select —</option>
              <option value="Pending">Pending</option>
              <option value="In transit">In transit</option>
              <option value="Out for delivery">Out for delivery</option>
              <option value="Delivered">Delivered</option>
              <option value="Failed">Failed</option>
            </select>
          </label>

          {/* Row 2: Text fields */}
          <label style={labelStyle}>
            Tracking number
            <input name={`trackingNumber__${v}`} type="text"
              defaultValue={ex?.trackingNumber ?? ""} style={inputStyle}
              placeholder="e.g. NZ123456789" />
          </label>

          <label style={labelStyle}>
            EDD (Est. Dispatch Date)
            <input name={`eddDate__${v}`} type="date"
              defaultValue={ex?.eddDate ?? ""} style={inputStyle} />
          </label>

          <label style={labelStyle}>
            Deposit paid ($)
            <input name={`depositPaid__${v}`} type="number" step="0.01" min="0"
              defaultValue={ex?.depositPaid ?? ""} style={inputStyle} placeholder="0.00" />
          </label>

          <label style={labelStyle}>
            Balance due ($)
            <input name={`balanceDue__${v}`} type="number" step="0.01" min="0"
              defaultValue={ex?.balanceDue ?? ""} style={inputStyle} placeholder="0.00" />
          </label>

          <label style={labelStyle}>
            Supplier / Container
            <input name={`supplierContainer__${v}`} type="text"
              defaultValue={ex?.supplierContainer ?? ""} style={inputStyle}
              placeholder="e.g. Supplier / CONT123" />
          </label>

          <label style={labelStyle}>
            Port / Arrival Date
            <input name={`portArrivalDate__${v}`} type="date"
              defaultValue={ex?.portArrivalDate ?? ""} style={inputStyle} />
          </label>

          <label style={labelStyle}>
            In Transit Date
            <input name={`inTransitDate__${v}`} type="date"
              defaultValue={ex?.inTransitDate ?? ""} style={inputStyle} />
          </label>

          <div /> {/* spacer */}

          <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
            Notes / internal info
            <textarea name={`notes__${v}`} defaultValue={ex?.notes ?? ""}
              rows={3} style={{ ...inputStyle, resize: "vertical" }}
              placeholder="Internal notes for this line item..." />
          </label>

        </div>
      </div>
    );
  })}

  {actionData?.message && (
    <div style={{
      padding: "10px 16px", borderRadius: "6px", marginBottom: "16px", fontSize: "13px",
      background: actionData.ok ? "#dcfce7" : "#fee2e2",
      color: actionData.ok ? "#166534" : "#991b1b",
    }}>
      {actionData.message}
    </div>
  )}

  <div style={{ marginTop: "4px" }}>
    <button type="submit" disabled={saving} style={{
      padding: "8px 20px", fontSize: "14px", borderRadius: "6px",
      background: saving ? "#9ca3af" : "#111827",
      color: "#fff", border: "none", cursor: saving ? "not-allowed" : "pointer",
    }}>
      {saving ? "Saving..." : "Save all changes"}
    </button>
  </div>
</Form>

    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: "4px",
  fontSize: "13px", color: "#374151", fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  padding: "7px 10px", fontSize: "13px", border: "1px solid #d1d5db",
  borderRadius: "6px", background: "#fff", color: "#111827",
  width: "100%", boxSizing: "border-box",
};

function carrierColor(company: string): { bg: string; text: string } {
  const colors: Record<string, { bg: string; text: string }> = {
    FLIWAY:         { bg: "#dbeafe", text: "#1e40af" },
    FLIWAYLINEHAUL: { bg: "#dbeafe", text: "#1e40af" },
    FLIWAYMIDSIZE:  { bg: "#dbeafe", text: "#1e40af" },
    TGE:            { bg: "#dcfce7", text: "#166534" },
    MAINFREIGHT:    { bg: "#fef3c7", text: "#92400e" },
    NZP:            { bg: "#f3e8ff", text: "#6b21a8" },
    CASTLE:         { bg: "#ffe4e6", text: "#9f1239" },
    M2H:            { bg: "#f0f9ff", text: "#0369a1" },
  };
  return colors[company] ?? { bg: "#f3f4f6", text: "#374151" };
}