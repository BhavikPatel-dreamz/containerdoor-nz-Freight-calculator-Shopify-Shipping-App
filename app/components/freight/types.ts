import React from "react";

export type FreightLineItem = {
  id: string;
  /** OrderLineItemIndex.id (cuid) — detail URL `/app/order/:lineIndexId` */
  lineIndexId?: string;
  variantId: string;
  title?: string;
  variantTitle?: string;
  vendor?: string;
  sku?: string;
  productId?: string;
  company: string;
  carrierColor?: string;
  carrierColorLabel?: string;
  boxes: number;
  amount: number;
  letterSuffix: string;
  customerStatus: string;
  customerStatusColor?: string;
  paymentStatus?: string;
  paymentStatusColor?: string;
  trackingNumber: string;
  freightRef?: string;
  eddDate: string;
  originalEddDate: string;
  warehouseStatus?: string;
  dispatchStatus?: string;
  deliveryStatus?: string;
  depositPaid?: string;
  balanceDue?: string;
  poNumber?: string;
  /** Depot address selected at checkout (Depot Collection service only) */
  depotAddress1?: string;
  depotCity?: string;
  depotZip?: string;
  supplierContainer?: string;
  receivedDate?: string;
  portArrivalDate?: string;
  inTransitDate?: string;
  isDepot?: boolean;
  cin7SalesOrderId?: string;
  cin7SalesOrderUrl?: string;
  cin7Exists?: boolean;
  cin7Status?: "match" | "mismatch" | "missing" | "error";
  cin7Mismatches?: string[];
  mondayItemId?: string;
  /** Shopify order + letter, e.g. `#CDL215347A` — also Monday pulse name */
  mondayItemName?: string;
  /** Full Monday pulse URL from MONDAY_BOARD_LINK + MONDAY_BOARD_ID */
  mondayItemUrl?: string;
  mondayStatus?: "match" | "mismatch" | "missing";
  mondayMismatches?: string[];
};

export type FreightOrderRow = {
  id: string;
  /** OrderSnapshot.id (cuid) — use this in `/app/order/:id` URLs */
  snapshotId: string;
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
  fulfillmentStatus: string;
  fullAddress: string;
};

export type NoteItem = {
  author: string;
  role: string;
  scheme: string;
  time: string;
  text: string;
  isSystem?: boolean;
  pushToMonday?: boolean;
};

export type DashboardCounts = {
  totalLineItems: number;
  awaitingCount: number;
  dispatchedCount: number;
  pendingNotifyCount: number;
  completedCount: number;
};

export type FreightDashboardProps = {
  orders: FreightOrderRow[];
  allOrders?: FreightOrderRow[];
  counts?: DashboardCounts;
  suppliers?: string[];
  warehouseStatuses?: string[];
  carriers?: string[];
  activeFilters?: { warehouseStatus?: string; carrier?: string; paymentStatus?: string };
  total: number;
  page: number;
  pageCount: number;
  shop: string;
  navbarRight: React.ReactNode;
  noteAuthor?: string;
  /** When "detail", never render list chrome (no flash on `/app/order/:id`). */
  viewMode?: "list" | "detail";
  initialDetailOrderId?: string;
  initialDetailVariantId?: string;
  detailBackHref?: string;
};
