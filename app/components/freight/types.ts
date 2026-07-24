import React from "react";

export type FreightLineItem = {
  id: string;
  variantId: string;
  title?: string;
  variantTitle?: string;
  vendor?: string;
  sku?: string;
  productId?: string;
  company: string;
  boxes: number;
  amount: number;
  letterSuffix: string;
  customerStatus: string;
  paymentStatus?: string;
  trackingNumber: string;
  freightRef?: string;
  eddDate: string;
  originalEddDate: string;
  warehouseStatus?: string;
  warehouseTags?: string;
  dispatchStatus?: string;
  deliveryStatus?: string;
  depositPaid?: string;
  balanceDue?: string;
  poNumber?: string;
  supplierContainer?: string;
  receivedDate?: string;
  portArrivalDate?: string;
  inTransitDate?: string;
  cin7Exists?: boolean;
  cin7Status?: "match" | "mismatch" | "missing" | "error";
  cin7Mismatches?: string[];
  mondayStatus?: "match" | "mismatch" | "missing";
  mondayMismatches?: string[];
};

export type FreightOrderRow = {
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
  warehouseTags?: string[];
  carriers?: string[];
  activeFilters?: { warehouseStatus?: string; warehouseTag?: string; carrier?: string; paymentStatus?: string };
  total: number;
  page: number;
  pageCount: number;
  shop: string;
  navbarRight: React.ReactNode;
  noteAuthor?: string;
  initialDetailOrderId?: string;
  initialDetailVariantId?: string;
  detailBackHref?: string;
};
