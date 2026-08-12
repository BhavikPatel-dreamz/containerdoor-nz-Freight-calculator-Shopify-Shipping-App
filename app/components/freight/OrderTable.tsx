/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */
import type { FreightOrderRow, FreightLineItem } from "./types";
import { companyLabels, getCarrierLabel } from "../../lib/freight";
import { getCustomerStatusStyle, getPaymentStatusStyle, getWarehouseStatusStyle, getCarrierStatusStyle, getCin7CellStatus } from "./helpers";
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
  hiddenColumns?: Set<string>;
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
  hiddenColumns = new Set(),
}: OrderTableProps) {
  return (
    <div className="fo-table-scroll">
      <table className="fo-table">
        <thead>
          <tr>
            <th><input type="checkbox" className="fo-checkbox" checked={selected.size === selectableIds.length && selectableIds.length > 0} onChange={toggleSelectAll} /></th>
            <th>Line #</th><th>Customer</th><th>Product</th><th style={{ width: "44px" }}>Qty</th>
            {!hiddenColumns.has("supplier") && <th>Supplier</th>}
            <th style={{ textAlign: "center" }}>EDD</th>
            <th title="Customer-facing fulfilment lifecycle (Pending → Confirmed → Dispatched → Delivered / Cancelled). Not payment or warehouse." style={{textAlign: "center" , width: "130px"}}>Customer status</th>
            {!hiddenColumns.has("warehouse") && <th style={{ textAlign: "center" }}>Warehouse</th>}
            {!hiddenColumns.has("payment") && <th style={{ textAlign: "center" }}>Payment</th>}
            {!hiddenColumns.has("carrier") && <th style={{ width: "120px" , textAlign: "center" }}>Carrier</th>}
            {!hiddenColumns.has("tracking") && <th style={{ textAlign: "center" }}>Tracking</th>}
            {!hiddenColumns.has("freightRef") && <th>Ref</th>}
            {(!hiddenColumns.has("cin7") || !hiddenColumns.has("monday")) && <th style={{ textAlign: "center", width: "80px" }}>Sync</th>}
            <th style={{ width: "80px" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredOrders.flatMap((order, idx) => {
            const chipColor = orderLetterColors[idx % orderLetterColors.length];

            return order.lineItems.map((item, liIdx) => {
              const isSelected = selected.has(item.id);
              const isFirstItem = liIdx === 0;
              const { bg: stBg, text: stText, label: stLabel } = getCustomerStatusStyle(item.customerStatus);

              return (
                <tr key={item.id} style={{ background: isSelected ? "#eff6ff" : undefined }}>
                  <td className="fo-td" onClick={(e) => e.stopPropagation()} style={{ width: "80px" }}>
                    <input
                      type="checkbox"
                      className="fo-checkbox"
                      checked={isSelected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelect(item.id)}
                    />
                  </td>
                  <td className="fo-td" style={{  width: "80px" }}>
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
                  <td className="fo-td" style={{  width: "80px" }}>
                    <div className="fo-cust-name">{order.customerName}</div>
                    <div className="fo-cust-email">{order.email}</div>
                  </td>
                  <td className="fo-td fo-td-product" style={{ width: "80px" }}>
                    <div className="fo-prod-stack">
                      <div className="fo-prod-name" title={item.title || undefined}>{item.title || "—"}</div>
                      {item.variantTitle ? (
                        <div className="fo-prod-variant" title={item.variantTitle}>{item.variantTitle}</div>
                      ) : null}
                      <div className="fo-prod-meta">
                        {item.sku ? <span className="fo-prod-sku" title={item.sku}>SKU {item.sku}</span> : <span className="fo-prod-sku">—</span>}
                      </div>
                    </div>
                  </td>
                  <td className="fo-td" style={{ fontSize: "13px", fontWeight: 600, color: "#111827", textAlign: "center", width: "44px" }}>
                    {item.boxes || 1}
                  </td>
                  {!hiddenColumns.has("supplier") && (
                    <td className="fo-td" style={{ fontSize: "12px", color: "#6b7280",width: "80px" }}>
                      {item.vendor || "—"}
                    </td>
                  )}
                  <td className="fo-td" style={{ textAlign: "center", width: "80px" }}>
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
                  <td className="fo-td" style={{ textAlign: "center", width: "80px" }}>
                    <span className="fo-cust-status" style={{ background: stBg, color: stText }}>{stLabel || "—"}</span>
                    </td>
                  {!hiddenColumns.has("warehouse") && (
                    <td className="fo-td" style={{ textAlign: "center", width: "50px" }}>
                      {(() => {
                        const { bg: whBg, text: whText, label: whLabel } = getWarehouseStatusStyle(item.warehouseStatus || "");
                        return (
                          <span className="fo-cust-status" style={{ background: whBg, color: whText }}>
                            {whLabel || "—"}
                          </span>
                        );
                      })()}
                    </td>
                  )}
                  {!hiddenColumns.has("payment") && (
                    <td className="fo-td" style={{ textAlign: "center", width: "80px" }}>
                      {(() => {
                        const { bg: payBg, text: payText, label: payLabel } = getPaymentStatusStyle(item.paymentStatus || "");
                        return (
                          <span className="fo-cust-status" style={{ background: payBg, color: payText }}>
                            {payLabel || "—"}
                          </span>
                        );
                      })()}
                    </td>
                  )}
                  {!hiddenColumns.has("carrier") && (
                    <td className="fo-td"  style={{ textAlign: "center", width: "120px" }}>
                      {(() => {
                        const carrierLabel = getCarrierLabel(item.company, Boolean(item.isDepot || item.depotAddress1 || item.depotCity || item.depotZip));
                        const { bg: carBg, text: carText } = getCarrierStatusStyle(carrierLabel);
                        return (
                          <span className="fo-carrier-badge" style={{ background: carBg, color: carText }}>
                            {carrierLabel || item.company}
                          </span>
                        );
                      })()}
                    </td>
                  )}
                  {!hiddenColumns.has("tracking") && (
                    <td className="fo-td" style={{ textAlign: "center", width: "80px" }}>
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
                  )}
                  {!hiddenColumns.has("freightRef") && (
                    <td className="fo-td" style={{ fontSize: "12px", color: "#6b7280" , width: "80px"}}>
                      {item.freightRef || "—"}
                    </td>
                  )}
                  {(!hiddenColumns.has("cin7") || !hiddenColumns.has("monday")) && (
                    <td className="fo-td" style={{ textAlign: "center", width: "80px" }}>
                      <div className="fo-sync-stack">
                        {!hiddenColumns.has("cin7") && (() => {
                          const status = getCin7CellStatus(item);
                          const cellKey = `${order.id}-${item.variantId}`;
                          const cin7Url = item.cin7SalesOrderUrl || null;

                          if (status === "match") {
                            return cin7Url ? (
                              <a href={cin7Url} target="_blank" rel="noopener noreferrer" className="fo-sync-pill green" style={{ textDecoration: "none" }} title="Open Cin7 Sales Order">CIN7 ✓</a>
                            ) : (
                              <span className="fo-sync-pill green">CIN7 ✓</span>
                            );
                          }
                          if (status === "error") {
                            return (
                              <span className="fo-sync-pill amber" title="Order is voided or duplicated in Cin7 — cannot sync">
                                CIN7 ⚠️
                              </span>
                            );
                          }
                          if (status === "mismatch") {
                            return (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                <button
                                  type="button"
                                  className="fo-sync-pill amber"
                                  title={`Out of sync: ${(item.cin7Mismatches ?? []).join(", ")}. Click to update Cin7.`}
                                  onClick={() => onFixCin7(order, item)}
                                  disabled={cin7FixingId === cellKey}
                                  style={{ cursor: cin7FixingId === cellKey ? "wait" : "pointer" }}
                                >
                                  CIN7 !
                                </button>
                                {cin7Url ? (
                                  <a href={cin7Url} target="_blank" rel="noopener noreferrer" className="fo-sync-pill" style={{ textDecoration: "none", padding: "2px 6px" }} title="Open Cin7 Sales Order">↗</a>
                                ) : null}
                              </span>
                            );
                          }
                          return (
                            <button
                              type="button"
                              className="fo-sync-pill red"
                              title="Create order in Cin7"
                              onClick={() => onCreateCin7(order)}
                              disabled={creatingCin7OrderId === order.id}
                              style={{ cursor: creatingCin7OrderId === order.id ? "wait" : "pointer" }}
                            >
                              CIN7 ✕
                            </button>
                          );
                        })()}

                        {!hiddenColumns.has("monday") && (() => {
                          const status = item.mondayStatus ?? "missing";
                          const cellKey = `${order.id}-${item.variantId}-monday`;
                          if (status === "match") {
                            const mUrl = item.mondayItemUrl || null;
                            return mUrl ? <a href={mUrl} target="_blank" rel="noopener noreferrer" className="fo-sync-pill green" style={{ textDecoration: "none" }}>Monday ✓</a> : <span className="fo-sync-pill green">Monday ✓</span>;
                          }
                          if (status === "mismatch") {
                            const mUrl = item.mondayItemUrl || null;
                            return (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                <button
                                  type="button"
                                  className="fo-sync-pill amber"
                                  title={`Out of sync with Monday: ${(item.mondayMismatches ?? []).join(", ")}. Click to update Monday.`}
                                  onClick={() => onSyncMonday(order, item)}
                                  disabled={mondayFixingId === cellKey}
                                  style={{ cursor: mondayFixingId === cellKey ? "wait" : "pointer" }}
                                >
                                  Monday !
                                </button>
                                {mUrl ? (
                                  <a href={mUrl} target="_blank" rel="noopener noreferrer" className="fo-sync-pill" style={{ textDecoration: "none", padding: "2px 6px" }} title="Open Monday item">↗</a>
                                ) : null}
                              </span>
                            );
                          }
                          return (
                            <button
                              type="button"
                              className="fo-sync-pill red"
                              title="Create order in Monday"
                              onClick={() => onSyncMonday(order, item)}
                              disabled={mondayFixingId === cellKey}
                              style={{ cursor: mondayFixingId === cellKey ? "wait" : "pointer" }}
                            >
                              Monday ✕
                            </button>
                          );
                        })()}
                      </div>
                    </td>
                  )}
                  <td className="fo-td" style={{ textAlign: "center", width: "80px" }}>
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
