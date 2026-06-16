/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, useCallback } from "react";
import {
  reactExtension,
  useOrder,
  useTarget,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  SkeletonText,
  View,
} from "@shopify/ui-extensions-react/customer-account";

// ─── Types ────────────────────────────────────────────────────────────────────

type LineItemRecord = {
  variantId: string;
  productTitle: string;
  carrier: string;
  customerStatus: string;
  deliveryStatus: string;
  trackingNumber: string;
  eddDate: string;
  dispatchStatus: string;
  warehouseStatus: string;
  supplierContainer: string;
  portArrivalDate: string;
  inTransitDate: string;
  depositPaid: string;
  balanceDue: string;
  notes: string;
  imageUrl: string;
};

type ApiResponse = {
  ok: boolean;
  lineItems: LineItemRecord[];
  error?: string;
};

// ─── Config ───────────────────────────────────────────────────────────────────

const TARGET = "customer-account.order-status.cart-line-item.render-after";
const APP_URL = "https://containerdoor-nz-freight-calculator.vercel.app";

// ─── Root Extension ───────────────────────────────────────────────────────────

export default reactExtension(TARGET, () => <CartLineFreightStatus />);

function CartLineFreightStatus() {
  const order = useOrder();

  // useTarget() gives us the specific cart line this extension is rendering after.
  // The shape is the CartLine object: { merchandise: { id, title, ... }, quantity, ... }
  const cartLine = useTarget();

  const [record, setRecord] = useState<LineItemRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Extract order ID ──────────────────────────────────────────────────────
  const rawOrderId: string =
    (order as any)?.id ??
    (order as any)?.order?.id ??
    "";

  const numericOrderId = rawOrderId.replace("gid://shopify/Order/", "").trim();

  // ── Extract this line item's variant ID from the target ───────────────────
  // Shopify exposes the cart line as: { merchandise: { id: "gid://shopify/ProductVariant/..." } }
  const rawVariantId: string =
    (cartLine as any)?.merchandise?.id ??
    (cartLine as any)?.variant?.id ??
    (cartLine as any)?.variantId ??
    "";

  const variantId = rawVariantId
    .replace("gid://shopify/ProductVariant/", "")
    .trim();

  // ── Fallback: product title for matching when variantId is unavailable ─────
  const lineItemTitle: string =
    (cartLine as any)?.merchandise?.product?.title ??
    (cartLine as any)?.merchandise?.title ??
    (cartLine as any)?.title ??
    "";

  // ── Fetch all records for the order, then pick the matching one ───────────
  const fetchRecord = useCallback(async () => {
    if (!numericOrderId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const ts = Date.now();
      const res = await fetch(
        `${APP_URL}/api/order-status?orderId=${numericOrderId}&_ts=${ts}`,
        { cache: "no-store" }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: ApiResponse = await res.json();

      if (data.ok) {
        const allRecords: LineItemRecord[] = data.lineItems ?? [];

        // Primary match: variantId — fallback: product title
        const matched =
          (variantId
            ? allRecords.find((r) => r.variantId === variantId)
            : undefined) ??
          (lineItemTitle
            ? allRecords.find(
                (r) =>
                  r.productTitle?.toLowerCase().trim() ===
                  lineItemTitle.toLowerCase().trim()
              )
            : undefined) ??
          null;

        setRecord(matched);
      } else {
        setError(data.error ?? "Failed to load");
      }
    } catch (e: any) {
      if (e instanceof TypeError) {
        setError(
          `Unable to load freight status: network or CORS error. Check that ${APP_URL} is reachable.`
        );
      } else {
        setError(
          `Unable to load freight status: ${String(e ?? "Unknown error")}`
        );
      }
    } finally {
      setLoading(false);
    }
  }, [numericOrderId, variantId, lineItemTitle]);

  useEffect(() => {
    fetchRecord();
  }, [fetchRecord]);

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <BlockStack spacing="extraTight">
        <SkeletonText size="small" />
        <SkeletonText size="small" />
      </BlockStack>
    );
  }

  if (error) {
    return (
      <Text size="small" appearance="subdued">
        {error}
      </Text>
    );
  }

  // No freight record for this line item — render nothing
  if (!record) return null;

  return <FreightStatusRow record={record} />;
}

// ─── Freight Status Row ───────────────────────────────────────────────────────

type FreightStatusRowProps = {
  record: LineItemRecord;
};

function FreightStatusRow({ record }: FreightStatusRowProps) {
  const badge = resolveBadge(
  record.customerStatus ?? "",
  record.deliveryStatus ?? "",
);

  const dateLabel = resolveDate(
    record.customerStatus ?? "",
    record.deliveryStatus ?? "",
    record.dispatchStatus ?? "",
    record
  );

  return (
    <View padding={["none", "none", "tight", "none"]}>
      <BlockStack spacing="extraTight">

        {/* Badge + tracking inline */}
        <InlineStack spacing="base" blockAlignment="center">
          <Badge tone={badge.tone}>{badge.label}</Badge>
          {record.trackingNumber ? (
            <Text size="small" appearance="subdued">
              {record.trackingNumber}
              {record.carrier ? ` · ${record.carrier}` : ""}
            </Text>
          ) : null}
        </InlineStack>

        {/* Date line */}
        {dateLabel ? (
          <Text size="small" appearance="subdued">
            {dateLabel}
          </Text>
        ) : null}

      </BlockStack>
    </View>
  );
}

// ─── Badge resolver ───────────────────────────────────────────────────────────

type Tone = "info" | "success" | "warning" | "critical" | "attention";

function resolveBadge(
  cs: string,
  ds: string,
): { label: string; tone: Tone } {
  const d = ds?.toLowerCase?.() ?? "";
  const c = cs?.toLowerCase?.() ?? "";

  // Delivery status takes priority
  if (d === "delivered") return { label: "Delivered", tone: "success" };
  if (d === "out for delivery") return { label: "Out for Delivery", tone: "info" };
  if (d === "in transit") return { label: "In Transit", tone: "info" };
  if (d === "failed") return { label: "Delivery Failed", tone: "critical" };
  if (d === "pending") return { label: "Pending", tone: "warning" };

  // Fall back to customer status
  if (c === "dispatched") return { label: "Dispatched", tone: "success" };
  if (c === "delivered") return { label: "Delivered", tone: "success" };
  if (c === "cancelled") return { label: "Cancelled", tone: "critical" };
  if (c === "confirmed") return { label: "Confirmed", tone: "attention" };

  return { label: "Pre-Order", tone: "info" };
}

// ─── Date line resolver ───────────────────────────────────────────────────────

function resolveDate(
  cs: string,
  ds: string,
  dispatchStatus: string,
  record: LineItemRecord
): string | null {
  const d = ds.toLowerCase();
  const c = cs.toLowerCase();
  const dp = dispatchStatus.toLowerCase();

  const rawEdd = record.eddDate?.trim() ?? "";
  const rawInTransit = record.inTransitDate?.trim() ?? "";
  const rawPort = record.portArrivalDate?.trim() ?? "";

  const edd = rawEdd ? formatDate(rawEdd) : null;
  const inTransit = rawInTransit ? formatDate(rawInTransit) : null;
  const port = rawPort ? formatDate(rawPort) : null;

  if (d === "delivered") {
    const date = inTransit ?? edd;
    return date ? `Delivered: ${date}` : null;
  }
  if (d === "out for delivery") {
    return inTransit ? `Out for delivery since: ${inTransit}` : null;
  }
  if (d === "in transit") {
    return inTransit ? `In Transit since: ${inTransit}` : null;
  }
  if (dp === "dispatched" || c === "dispatched") {
    const date = inTransit ?? edd;
    return date ? `Dispatched: ${date}` : null;
  }
  if (port) {
    return `Port Arrival: ${port}`;
  }

  return edd ? `Estimated dispatch: ${edd}` : null;
}

// ─── Date formatter ───────────────────────────────────────────────────────────
// Parse manually to avoid UTC midnight → local timezone off-by-one-day bugs.

function formatDate(raw: string): string {
  try {
    const parts = raw.split("-");
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const date = new Date(year, month, day);
      return date.toLocaleDateString("en-NZ", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    }
    return raw;
  } catch {
    return raw;
  }
}