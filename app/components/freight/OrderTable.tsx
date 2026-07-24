/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */
import type { FreightOrderRow, FreightLineItem } from "./types";
import { companyLabels } from "../../lib/freight";
import { getCustomerStatusStyle, getPaymentStatusStyle, getCin7CellStatus, getRefPrefix } from "./helpers";
import { IconEye, IconChat, IconCalendar, IconPlus } from "./icons";

type OrderTableProps = {
  filteredOrders: FreightOrderRow[];
  selected: Set<string>;
  orderLetterColors: string[];
  selectableIds: string[];
  toggleSelectAll: () => void;
  toggleSelect: (id: string) => void;
  onOpenDetail: (order: FreightOrderRow, item: FreightLineItem) => void;
  onOpenNotes: (order: FreightOrderRow, item: FreightLineItem) => void;
  onOpenEdd: (order: FreightOrderRow, item: FreightLineItem) => void;
  onOpenTracking: (order: FreightOrderRow, item: FreightLineItem) => void;
  onFixCin7: (order: FreightOrderRow, item: FreightLineItem) => void;
  onSyncMonday: (order: FreightOrderRow, item: FreightLineItem) => void;
  onCreateCin7: (order: FreightOrderRow) => void;
  cin7FixingId: string | null;
  mondayFixingId: string | null;
  creatingCin7OrderId: string | null;
  navigate: (url: string) => void;
};

export function OrderTable({
  filteredOrders,
  selected,
  orderLetterColors,
  selectableIds,
  toggleSelectAll,
  toggleSelect,
  onOpenDetail,
  onOpenNotes,
  onOpenEdd,
  onOpenTracking,
  onFixCin7,
  onSyncMonday,
  onCreateCin7,
  cin7FixingId,
  mondayFixingId,
  creatingCin7OrderId,
  navigate,
}: OrderTableProps) {
  return (
    <div className="fo-table-scroll">
      <table className="fo-table">
        <thead>
          <tr>
            <th><input type="checkbox" className="fo-checkbox" checked={selected.size === selectableIds.length && selectableIds.length > 0} onChange={toggleSelectAll} /></th>
            <th>Line order #</th><th>Customer</th><th>Product / Variant / SKU / ID</th><th>Supplier</th>
            <th>EDD (current / orig)</th><th>Customer status</th><th>Warehouse</th><th>Payment status</th><th>Carrier</th>
            <th>Tracking #</th><th>Freight ref</th><th>Cin7</th><th>Monday</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredOrders.flatMap((order, idx) => {
            const chipColor = orderLetterColors[idx % orderLetterColors.length];

            return order.lineItems.map((item, liIdx) => {
              const isSelected = selected.has(item.id);
              const isFirstItem = liIdx === 0;
              const { bg: stBg, text: stText, label: stLabel } = getCustomerStatusStyle(item.customerStatus);
              const statusClass = item.customerStatus ? `fo-fulfil ${item.customerStatus.toLowerCase()}` : "fo-fulfil none";

              return (
                <tr key={item.id} style={{ background: isSelected ? "#eff6ff" : undefined }}>
                  <td className="fo-td">
                    <input type="checkbox" className="fo-checkbox" checked={isSelected} onChange={() => toggleSelect(item.id)} />
                  </td>
                  <td className="fo-td">
                    {isFirstItem ? (
                      <span className="fo-order-chip">
                        <span className="fo-order-letter" style={{ background: chipColor + "33", color: chipColor }}>{item.letterSuffix}</span>
                        {order.shopifyOrderName}
                      </span>
                    ) : (
                      <span className="fo-line-chip">
                        <span className="fo-order-letter" style={{ background: chipColor + "22", color: chipColor }}>{item.letterSuffix}</span>
                        {order.shopifyOrderName}
                      </span>
                    )}
                  </td>
                  <td className="fo-td">
                    <div className="fo-cust-name">{order.customerName}</div>
                    <div className="fo-cust-email">{order.email}</div>
                  </td>
                  <td className="fo-td">
                    <div className="fo-prod-name">
                      {item.title || "—"}
                      {" "}
                      <span style={{ color: "#6b7280", fontWeight: 400 }}>x {item.boxes || 1}</span>
                    </div>
                    {item.variantTitle && (
                      <div style={{ fontSize: "11px", color: "#374151" }}>{item.variantTitle}</div>
                    )}
                    <div className="fo-prod-sku" style={{ fontFamily: "monospace", fontSize: "11px", color: "#6b7280" }}>
                      {item.sku || "—"}{item.productId ? ` · ID ${item.productId}` : ""}{item.variantId ? ` · VAR ${item.variantId}` : ""}
                    </div>
                  </td>
                  <td className="fo-td" style={{ fontSize: "12px", color: "#6b7280" }}>
                    {item.vendor || "—"}
                  </td>
                  <td className="fo-td">
                    <div className="fo-edd-wrap">
                      {item.eddDate ? (
                        <>
                          <div style={{ display: "grid", gap: "4px", marginBottom: "6px" }}>
                            <div className="fo-edd-current" style={{ color: "#166534", fontWeight: 600 }}>
                              {new Date(item.eddDate).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}
                            </div>
                            {item.originalEddDate && item.originalEddDate !== item.eddDate && (
                              <div style={{ color: "#b91c1c", textDecoration: "line-through", fontSize: "12px" }}>
                                {new Date(item.originalEddDate).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}
                              </div>
                            )}
                          </div>
                          <button style={{ display: "flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: 0, color: "#9ca3af" }}
                            onClick={() => onOpenEdd(order, item)}>
                            <IconCalendar />
                          </button>
                        </>
                      ) : (
                        <button style={{ display: "flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: 0, color: "#9ca3af" }}
                          onClick={() => onOpenEdd(order, item)}>
                          <IconCalendar />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="fo-td"><span className="fo-cust-status" style={{ background: stBg, color: stText }}>{stLabel || "—"}</span></td>
                  <td className="fo-td" style={{ fontSize: "12px", color: "#374151" }}>{item.warehouseStatus || "—"}</td>
                  <td className="fo-td">
                    {(() => {
                      const { bg: payBg, text: payText, label: payLabel } = getPaymentStatusStyle(item.paymentStatus || "");
                      return (
                        <span className="fo-cust-status" style={{ background: payBg, color: payText }}>
                          {payLabel || "—"}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="fo-td">
                    <span className="fo-carrier-badge">{companyLabels[item.company as keyof typeof companyLabels] ?? item.company}</span>
                  </td>
                  <td className="fo-td">
                    {item.trackingNumber ? (
                      <button
                        className="fo-tracking-num"
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit" }}
                        onClick={() => onOpenTracking(order, item)}
                      >
                        {item.trackingNumber}
                      </button>
                    ) : (
                      <button className="fo-tracking-add"
                        onClick={() => onOpenTracking(order, item)}>
                        <IconPlus /> Add
                      </button>
                    )}
                  </td>
                  <td className="fo-td" style={{ fontSize: "12px", color: "#6b7280" }}>
                    {item.freightRef || "—"}
                  </td>
                  <td className="fo-td">
                    {(() => {
                      const status = getCin7CellStatus(item);
                      const cellKey = `${order.id}-${item.variantId}`;

                      if (status === "match") {
                        return <span className="fo-circle green">✓</span>;
                      }
                      if (status === "error") {
                        return (
                          <span
                            className="fo-circle"
                            title="Order is voided or duplicated in Cin7 — cannot sync"
                            style={{ color: "#f59e0b", background: "#fffbeb", border: "none", padding: 0, minWidth: "24px", minHeight: "24px", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}
                          >
                            ⚠️
                          </span>
                        );
                      }
                      if (status === "mismatch") {
                        return (
                          <button
                            type="button"
                            className="fo-circle"
                            title={`Out of sync: ${(item.cin7Mismatches ?? []).join(", ")}. Click to update Cin7.`}
                            onClick={() => onFixCin7(order, item)}
                            disabled={cin7FixingId === cellKey}
                            style={{ color: "#92400e", background: "#fef3c7", border: "none", padding: 0, minWidth: "24px", minHeight: "24px", cursor: cin7FixingId === cellKey ? "wait" : "pointer" }}
                          >
                            !
                          </button>
                        );
                      }
                      return (
                        <button
                          type="button"
                          className="fo-circle"
                          title="Create order in Cin7"
                          onClick={() => onCreateCin7(order)}
                          disabled={creatingCin7OrderId === order.id}
                          style={{
                            color: "#dc2626",
                            background: "#fee2e2",
                            border: "none",
                            padding: 0,
                            minWidth: "24px",
                            minHeight: "24px",
                            cursor: creatingCin7OrderId === order.id ? "wait" : "pointer",
                          }}
                        >
                          ✕
                        </button>
                      );
                    })()}
                  </td>
                  <td className="fo-td">
                    {(() => {
                      const status = item.mondayStatus ?? "missing";
                      const cellKey = `${order.id}-${item.variantId}-monday`;
                      if (status === "match") return <span className="fo-circle green">✓</span>;
                      if (status === "mismatch") {
                        return (
                          <button
                            type="button"
                            className="fo-circle"
                            title={`Out of sync with Monday: ${(item.mondayMismatches ?? []).join(", ")}. Click to update Monday.`}
                            onClick={() => onSyncMonday(order, item)}
                            disabled={mondayFixingId === cellKey}
                            style={{ color: "#92400e", background: "#fef3c7", border: "none", padding: 0, minWidth: "24px", minHeight: "24px", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: mondayFixingId === cellKey ? "wait" : "pointer" }}
                          >
                            !
                          </button>
                        );
                      }
                      return (
                        <button
                          type="button"
                          className="fo-circle"
                          title="Create order in Monday"
                          onClick={() => onSyncMonday(order, item)}
                          disabled={mondayFixingId === cellKey}
                          style={{ color: "#dc2626", background: "#fee2e2", border: "none", padding: 0, minWidth: "24px", minHeight: "24px", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: mondayFixingId === cellKey ? "wait" : "pointer" }}
                        >
                          ✕
                        </button>
                      );
                    })()}
                  </td>
                  <td className="fo-td">
                    <div className="fo-act-row">
                      <button className="fo-icon-btn" title="View order" onClick={() => onOpenDetail(order, item)}><IconEye /></button>
                      <button className="fo-icon-btn" title="Notes" onClick={() => onOpenNotes(order, item)}><IconChat /></button>
                    </div>
                  </td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
}
