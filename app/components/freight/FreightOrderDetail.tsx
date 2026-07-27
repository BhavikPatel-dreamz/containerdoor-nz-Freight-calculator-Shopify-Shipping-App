/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Dedicated order-detail screen for `/app/order/:orderId`.
 * List chrome never mounts — avoids flash of dashboard table.
 */
import type { ReactNode } from "react";
import FreightDashboard from "../FreightDashboard";
import type { FreightOrderRow } from "./types";

export type FreightOrderDetailProps = {
  order: FreightOrderRow;
  shop: string;
  noteAuthor?: string;
  variantId?: string;
  navbarRight: ReactNode;
  backHref?: string;
};

export function FreightOrderDetail({
  order,
  shop,
  noteAuthor = "SP",
  variantId,
  navbarRight,
  backHref = "/app",
}: FreightOrderDetailProps) {
  return (
    <FreightDashboard
      orders={[order]}
      allOrders={[order]}
      total={1}
      page={1}
      pageCount={1}
      shop={shop}
      noteAuthor={noteAuthor}
      navbarRight={navbarRight}
      viewMode="detail"
      initialDetailOrderId={order.snapshotId || order.shopifyOrderId}
      initialDetailVariantId={variantId}
      detailBackHref={backHref}
    />
  );
}
