/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import {
  reactExtension,
  useApi,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Box,
} from "@shopify/ui-extensions-react/admin";

type LineItemRecord = {
  variantId: string;
  productTitle: string;
  carrier: string;
  customerStatus: string;
  deliveryStatus: string;
  trackingNumber: string;
  freightRef: string;
  eddDate: string;
  dispatchStatus: string;
  warehouseStatus: string;
  supplierContainer: string;
  portArrivalDate: string;
  inTransitDate: string;
  depositPaid: string;
  balanceDue: string;
  notes: string;
};

type ApiResponse = {
  ok: boolean;
  lineItems: LineItemRecord[];
  error?: string;
};

const TARGET = "admin.order-details.block.render";

function stripGid(raw: string, resource: "Order") {
  return String(raw || "").replace(`gid://shopify/${resource}/`, "").trim();
}

function resolveAppBaseUrl(api: any): string {
  const fromApi = api?.extension?.appUrl || api?.appUrl || "";
  const fromEnv =
    (typeof process !== "undefined" && (process.env.SHOPIFY_APP_URL || process.env.APP_URL)) || "";
  return String(fromApi || fromEnv || "").trim().replace(/\/+$/, "");
}

function resolveBadge(customerStatus: string, deliveryStatus: string) {
  const d = (deliveryStatus || "").toLowerCase();
  const c = (customerStatus || "").toLowerCase();

  if (d === "delivered") return { label: "Delivered", tone: "success" };
  if (d === "out for delivery") return { label: "Out for Delivery", tone: "info" };
  if (d === "in transit") return { label: "In Transit", tone: "info" };
  if (d === "failed") return { label: "Delivery Failed", tone: "critical" };
  if (c === "dispatched") return { label: "Dispatched", tone: "info" };
  if (c === "delivered") return { label: "Delivered", tone: "success" };
  if (c === "cancelled") return { label: "Cancelled", tone: "critical" };
  if (c === "confirmed") return { label: "Confirmed", tone: "attention" };

  return { label: "Pre-Order", tone: "warning" };
}

export default reactExtension(TARGET, () => <FreightStatusBlock />);

function FreightStatusBlock() {
  const api = useApi(TARGET);
  const rawOrderId =
    (api as any)?.data?.selected?.[0]?.id ??
    (api as any)?.data?.orderId ??
    (api as any)?.orderId ??
    "";

  const orderId = stripGid(rawOrderId, "Order");
  const appUrl = resolveAppBaseUrl(api);

  const [shop, setShop] = useState("");
  const [records, setRecords] = useState<LineItemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!orderId) {
        setLoading(false);
        setError("No order selected");
        return;
      }

      try {
        let resolvedShop = "";
        try {
          const shopRes = await (api as any).query(`query { shop { myshopifyDomain } }`);
          resolvedShop = shopRes?.data?.shop?.myshopifyDomain ?? "";
        } catch (e) {
          console.error("[FreightStatusBlock] shop query failed", e);
        }

        if (cancelled) return;

        const qs = new URLSearchParams({
          orderId,
          ...(resolvedShop ? { shop: resolvedShop } : {}),
        });

        const res = await fetch(`${appUrl}/api/order-status?${qs.toString()}`, {
          cache: "no-store",
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const json: ApiResponse = await res.json();
        if (!json.ok) {
          throw new Error(json.error || "Failed to load freight records");
        }

        if (!cancelled) {
          setShop(resolvedShop);
          setRecords(json.lineItems ?? []);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load freight data");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [appUrl, orderId]);

  if (loading) {
    return <Text>Loading freight…</Text>;
  }

  if (error) {
    return <Text>{error}</Text>;
  }

  if (!records.length) {
    return <Text>No freight data for this order.</Text>;
  }

  return (
    <BlockStack gap="base">
      {records.map((record) => {
        const badge = resolveBadge(record.customerStatus, record.deliveryStatus);
        const title = record.productTitle || `Variant ${record.variantId}`;
        const tracking = record.trackingNumber ? ` • ${record.trackingNumber}` : "";
        const carrier = record.carrier ? `${record.carrier}` : "Freight";

        return (
          <Box key={`${record.variantId}-${title}`} padding="base">
            <InlineStack gap="base" blockAlignment="center">
              <Text fontWeight="bold">{title}</Text>
              <Badge tone={badge.tone as any}>{badge.label}</Badge>
            </InlineStack>

            <Text>{carrier}{tracking}</Text>

            {record.deliveryStatus ? (
              <Text>Delivery: {record.deliveryStatus}</Text>
            ) : null}
          </Box>
        );
      })}
    </BlockStack>
  );
}
