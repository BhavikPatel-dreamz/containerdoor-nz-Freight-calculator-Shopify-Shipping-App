/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */
import type { FreightOrderRow, FreightLineItem } from "./types";
import { companyLabels } from "../../lib/freight";
import { getCustomerStatusStyle, getPaymentStatusStyle } from "./helpers";
import { IconPencil } from "./icons";

type DetailPanelsProps = {
  order: FreightOrderRow;
  item: FreightLineItem;
  onEditDispatch: () => void;
  onEditOps: () => void;
  onAmendOrder?: () => void;
};

const editBtnStyle = { background: "none", border: "1px solid #e5e7eb", borderRadius: "4px", padding: "3px 6px", cursor: "pointer", color: "#6b7280", display: "flex" as const, alignItems: "center", gap: "4px", fontSize: "11px", transition: "all 0.15s" };
const editBtnHover = { borderColor: "#2563eb", color: "#2563eb" };
const editBtnLeave = { borderColor: "#e5e7eb", color: "#6b7280" };

export function DetailPanels({ order, item, onEditDispatch: _onEditDispatch, onEditOps: _onEditOps, onAmendOrder }: DetailPanelsProps) {
  return (
    <div className="fo-detail-left">
      {/* 1. Dispatch & Freight — tracking/ref via header "Update Tracking" for now */}
      <div className="fo-detail-panel">
        <div className="fo-detail-panel-hdr" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>Dispatch &amp; Freight</span>
          {/* Edit dispatch/EDD/carrier — future phase; use Update Tracking for tracking # + freight ref */}
        </div>
        <div className="fo-detail-row">
          <span className="fo-detail-label">Current EDD</span>
          <span className="fo-detail-value" style={{ color: "#166534" }}>
            {item.eddDate ? new Date(item.eddDate).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : "—"}
          </span>
        </div>
        <div className="fo-detail-row">
          <span className="fo-detail-label">Original EDD</span>
          <span className="fo-detail-value">
            {item.originalEddDate && item.originalEddDate !== item.eddDate
              ? <span style={{ textDecoration: "line-through", color: "#b91c1c" }}>{new Date(item.originalEddDate).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}</span>
              : "—"}
          </span>
        </div>
        <div className="fo-detail-row"><span className="fo-detail-label">Carrier</span><span className="fo-detail-value" style={{ color: "#2563eb" }}>{companyLabels[item.company as keyof typeof companyLabels] ?? item.company ?? "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">Tracking #</span><span className="fo-detail-value">{item.trackingNumber ? <span style={{ color: "#2563eb" }}>{item.trackingNumber}</span> : "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">Freight ref</span><span className="fo-detail-value">{item.freightRef || "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">Delivery method</span><span className="fo-detail-value">Standard</span></div>
      </div>

      {/* 2. Operational — read-only for now */}
      <div className="fo-detail-panel">
        <div className="fo-detail-panel-hdr" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>Operational</span>
          {/* Edit operational fields — future phase */}
        </div>
        <div className="fo-detail-row"><span className="fo-detail-label">Warehouse status</span><span className="fo-detail-value">{item.warehouseStatus || "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">Warehouse tags</span><span className="fo-detail-value">{item.warehouseTags || "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">Received</span><span className="fo-detail-value">{item.receivedDate ? new Date(item.receivedDate).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">Dispatch status</span><span className="fo-detail-value">{item.dispatchStatus || "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">Delivery status</span><span className="fo-detail-value">{item.deliveryStatus || "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">PO #</span><span className="fo-detail-value">{item.poNumber || "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">Port arrival</span><span className="fo-detail-value">{item.portArrivalDate ? new Date(item.portArrivalDate).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">In transit date</span><span className="fo-detail-value">{item.inTransitDate ? new Date(item.inTransitDate).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">Supplier / Container</span><span className="fo-detail-value">{item.supplierContainer || "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">Deposit paid</span><span className="fo-detail-value">{item.depositPaid || "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">Balance due</span><span className="fo-detail-value">{item.balanceDue || "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">Payment status</span><span className="fo-detail-value">{item.paymentStatus || "—"}</span></div>
      </div>

      {/* 3. Customer */}
      <div className="fo-detail-panel">
        <div className="fo-detail-panel-hdr" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>Customer</span>
          {onAmendOrder ? (
            <button onClick={onAmendOrder} title="Amend contact / address" style={editBtnStyle} onMouseEnter={(e) => { Object.assign(e.currentTarget.style, editBtnHover); }} onMouseLeave={(e) => { Object.assign(e.currentTarget.style, editBtnLeave); }}>
              <IconPencil /> Amend
            </button>
          ) : null}
        </div>
        <div className="fo-detail-row"><span className="fo-detail-label">Name</span><span className="fo-detail-value">{order.customerName || "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">Email</span><span className="fo-detail-value"><a href={`mailto:${order.email}`} style={{ color: "#2563eb", textDecoration: "none", fontSize: "12px" }}>{order.email || "—"}</a></span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">Phone</span><span className="fo-detail-value">{order.phone || "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">Address</span><span className="fo-detail-value">{order.fullAddress || "—"}</span></div>
        <div className="fo-detail-row">
          <span className="fo-detail-label">Customer status</span>
          <span className="fo-detail-value">
            <span style={{ padding: "2px 10px", borderRadius: "9px", fontSize: "11px", fontWeight: 600, background: getCustomerStatusStyle(item.customerStatus).bg, color: getCustomerStatusStyle(item.customerStatus).text }}>
              {getCustomerStatusStyle(item.customerStatus).label || "—"}
            </span>
          </span>
        </div>
        <div className="fo-detail-row">
          <span className="fo-detail-label">Payment status</span>
          <span className="fo-detail-value">
            <span style={{ padding: "2px 10px", borderRadius: "9px", fontSize: "11px", fontWeight: 600, background: getPaymentStatusStyle(item.paymentStatus || "").bg, color: getPaymentStatusStyle(item.paymentStatus || "").text }}>
              {getPaymentStatusStyle(item.paymentStatus || "").label || "—"}
            </span>
          </span>
        </div>
      </div>

      {/* 4. Order Details & Sync */}
      <div className="fo-detail-panel">
        <div className="fo-detail-panel-hdr">Order Details &amp; Sync</div>
        <div className="fo-detail-row">
          <span className="fo-detail-label">Line order #</span>
          <span className="fo-detail-value">
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 8px", borderRadius: "5px", background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", fontSize: "11px", fontWeight: 700 }}>
              {String(order.shopifyOrderName || "").startsWith("#") ? order.shopifyOrderName : `#${order.shopifyOrderName}`} <span style={{ background: "#bfdbfe", borderRadius: "3px", padding: "0 4px", fontSize: "10px" }}>{item.letterSuffix}</span>
            </span>
          </span>
        </div>
        <div className="fo-detail-row"><span className="fo-detail-label">Parent order #</span><span className="fo-detail-value">{order.shopifyOrderName}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">Product</span><span className="fo-detail-value">{item.title || "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">Variant</span><span className="fo-detail-value">{item.variantTitle || "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">SKU</span><span className="fo-detail-value" style={{ fontFamily: "monospace", fontSize: "12px" }}>{item.sku || "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">Product ID</span><span className="fo-detail-value" style={{ fontFamily: "monospace", fontSize: "12px" }}>{item.productId || "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">Quantity</span><span className="fo-detail-value">{item.boxes || 1}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label">Order date</span><span className="fo-detail-value">{new Date(order.createdAt).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}</span></div>
        <div style={{ borderTop: "1px solid #f3f4f6", margin: "6px 0" }} />
        <div className="fo-detail-row"><span className="fo-detail-label" style={{ fontSize: "10px", color: "#9ca3af" }}>Variant ID</span><span className="fo-detail-value" style={{ fontFamily: "monospace", fontSize: "10px", color: "#9ca3af" }}>{item.variantId || "—"}</span></div>
        <div className="fo-detail-row"><span className="fo-detail-label" style={{ fontSize: "10px", color: "#9ca3af" }}>Line item ID</span><span className="fo-detail-value" style={{ fontFamily: "monospace", fontSize: "10px", color: "#9ca3af" }}>{item.id}</span></div>
        {item.mondayItemUrl ? (
          <div className="fo-detail-row"><span className="fo-detail-label" style={{ fontSize: "10px", color: "#9ca3af" }}>Monday</span><span className="fo-detail-value" style={{ fontFamily: "monospace", fontSize: "10px" }}><a href={item.mondayItemUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "none" }}>{item.mondayItemName || item.mondayItemId} ↗</a></span></div>
        ) : item.mondayItemId ? (
          <div className="fo-detail-row"><span className="fo-detail-label" style={{ fontSize: "10px", color: "#9ca3af" }}>Monday</span><span className="fo-detail-value" style={{ fontFamily: "monospace", fontSize: "10px", color: "#9ca3af" }}>{item.mondayItemName || item.mondayItemId}</span></div>
        ) : null}
        <div style={{ borderTop: "1px solid #f3f4f6", margin: "6px 0" }} />
        <div className="fo-detail-row">
          <span className="fo-detail-label">Sync status</span>
          <span className="fo-detail-value" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {(["Cin7", "Monday"] as const).map((lbl) => {
              const isCin7 = lbl === "Cin7";
              const isOk = isCin7 ? Boolean(item.cin7Exists) : (item.mondayStatus === "match");
              const mondayUrl = !isCin7 ? item.mondayItemUrl || null : null;
              const badge = (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "11px", fontWeight: 600, color: isOk ? "#16a34a" : "#dc2626" }}>
                  {isOk ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="9 12 11 14 15 10" /></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="8" y1="8" x2="16" y2="16" /><line x1="16" y1="8" x2="8" y2="16" /></svg>
                  )}
                  {lbl}
                </span>
              );
              return mondayUrl ? (
                <a key={lbl} href={mondayUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>{badge}</a>
              ) : (
                <span key={lbl}>{badge}</span>
              );
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
