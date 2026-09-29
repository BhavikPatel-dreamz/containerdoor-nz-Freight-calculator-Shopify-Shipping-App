#!/usr/bin/env node
/**
 * Local inspect: Shopify order in OMS Postgres + Cin7 Omni Sales Order.
 *   bash scripts/inspect-shopify-cin7-order.sh
 *   bash scripts/inspect-shopify-cin7-order.sh 7344291021105 529947
 */
import { resolve } from "node:path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

dotenv.config({ path: resolve(process.cwd(), ".env"), quiet: true });

const shopifyOrderId = String(process.argv[2] || "7344291021105").trim();
const cin7HintId = String(process.argv[3] || "529947").trim();

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function cin7AuthHeader() {
  const username = process.env.CIN7_USERNAME;
  const token = process.env.CIN7_SYNC_TOKEN;
  if (!username || !token) throw new Error("Missing CIN7_USERNAME or CIN7_SYNC_TOKEN");
  return "Basic " + Buffer.from(`${username}:${token}`).toString("base64");
}

function cin7Base() {
  const url = process.env.CIN7_SYNC_URL || `${process.env.CIN7_BASE_URL}/SalesOrders`;
  return String(url || "").replace(/\/\d+$/, "").replace(/\/$/, "");
}

function pickCin7(json) {
  if (!json || typeof json !== "object") return json;
  return {
    id: json.id ?? json.ID,
    code: json.code ?? json.Code,
    status: json.status ?? json.Status,
    isVoid: json.isVoid,
    customerOrderNo: json.customerOrderNo,
    reference: json.reference,
    trackingCode: json.trackingCode,
    logisticsCarrier: json.logisticsCarrier,
    estimatedDeliveryDate: json.estimatedDeliveryDate,
    dispatchedDate: json.dispatchedDate ?? json.dispatchDate,
    fullyReceivedDate: json.fullyReceivedDate,
    invoiceDate: json.invoiceDate,
    fulfilmentStatus: json.fulfilmentStatus ?? json.fulfillmentStatus,
    combinedPickingStatus: json.combinedPickingStatus,
    combinedPackingStatus: json.combinedPackingStatus,
    combinedShippingStatus: json.combinedShippingStatus,
    lineCount: Array.isArray(json.lineItems) ? json.lineItems.length : undefined,
    lineSkus: Array.isArray(json.lineItems)
      ? json.lineItems.map((li) => li.code || li.sku).filter(Boolean)
      : undefined,
  };
}

async function getCin7(id) {
  const url = `${cin7Base()}/${encodeURIComponent(id)}`;
  const res = await fetch(url, { headers: { Authorization: cin7AuthHeader() } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { http: res.status, path: `/SalesOrders/${id}`, data: pickCin7(json) };
}

async function searchCin7(where) {
  const url = `${cin7Base()}?where=${encodeURIComponent(where)}`;
  const res = await fetch(url, { headers: { Authorization: cin7AuthHeader() } });
  const json = await res.json().catch(() => null);
  const rows = Array.isArray(json) ? json : [];
  return { http: res.status, where, count: rows.length, rows: rows.slice(0, 8).map(pickCin7) };
}

async function main() {
  const snap = await prisma.orderSnapshot.findFirst({
    where: { orderId: shopifyOrderId },
    include: { operational: true, lineItemOps: true, lineIndex: true },
  });
  const report = await prisma.orderMigrateReport.findFirst({
    where: { orderId: shopifyOrderId },
  });

  const oms = snap
    ? {
        shop: snap.shop,
        orderName: snap.orderName,
        financialStatus: snap.financialStatus,
        fulfillmentStatus: snap.fulfillmentStatus,
        orderOps: snap.operational
          ? {
              customerStatus: snap.operational.customerStatus,
              deliveryStatus: snap.operational.deliveryStatus,
              dispatchStatus: snap.operational.dispatchStatus,
              cin7SalesOrderId: snap.operational.cin7SalesOrderId,
              trackingNumber: snap.operational.trackingNumber,
            }
          : null,
        lines: snap.lineItemOps.map((ops) => {
          const idx = snap.lineIndex.find((i) => i.variantId === ops.variantId);
          return {
            letter: idx?.letterSuffix,
            sku: idx?.sku,
            title: ops.productTitle || idx?.productTitle,
            qty: idx?.quantity,
            fulfillmentStatus: idx?.fulfillmentStatus,
            financialStatus: idx?.financialStatus,
            customerStatus: ops.customerStatus,
            deliveryStatus: ops.deliveryStatus,
            dispatchStatus: ops.dispatchStatus,
            trackingNumber: ops.trackingNumber,
            cin7SalesOrderId: ops.cin7SalesOrderId,
            cin7SalesOrderCode: ops.cin7SalesOrderCode,
            cin7SalesOrderRef: ops.cin7SalesOrderRef,
            mondayItemId: ops.mondayItemId,
            mondayItemName: ops.mondayItemName,
          };
        }),
      }
    : { missing: true, shopifyOrderId };

  let cin7Direct = null;
  const cin7Search = [];
  try {
    cin7Direct = await getCin7(cin7HintId);
    const names = [
      snap?.orderName,
      snap?.orderName?.replace(/^#/, ""),
    ].filter(Boolean);
    for (const key of [...new Set(names)]) {
      cin7Search.push(await searchCin7(`customerOrderNo='${String(key).replace(/'/g, "''")}'`));
      cin7Search.push(await searchCin7(`reference='${String(key).replace(/'/g, "''")}'`));
    }
  } catch (err) {
    cin7Direct = { error: err instanceof Error ? err.message : String(err) };
  }

  console.log(
    JSON.stringify(
      {
        shopifyOrderId,
        cin7HintId,
        customerAppsLinkHint: "660969",
        oms,
        migrateReport: report
          ? {
              status: report.status,
              omsAction: report.omsAction,
              cin7Action: report.cin7Action,
              mondayAction: report.mondayAction,
              lastError: report.lastError,
              runCount: report.runCount,
            }
          : null,
        cin7Direct,
        cin7Search,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
