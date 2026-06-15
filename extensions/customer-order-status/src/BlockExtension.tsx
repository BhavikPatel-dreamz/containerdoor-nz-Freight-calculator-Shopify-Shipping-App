import { useEffect, useState, useCallback } from "react";
import {
  reactExtension,
  useOrder,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Divider,
  Image,
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

const TARGET = "customer-account.order-status.block.render";
// Use the Vercel deployment (production) instead of the dynamicdreamz preview host
const APP_URL = "https://containerdoor-nz-freight-calculator.vercel.app";

// ─── Root Extension ───────────────────────────────────────────────────────────

export default reactExtension(TARGET, () => <OrderStatusBlock />);

function OrderStatusBlock() {
  const order = useOrder();

  const [records, setRecords] = useState<LineItemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Extract order ID ──────────────────────────────────────────────────────
  const rawOrderId: string =
    (order as any)?.id ??
    (order as any)?.order?.id ??
    "";

  // Keep FULL numeric ID — do NOT strip non-digits (order IDs are purely numeric)
  const numericOrderId = rawOrderId.replace("gid://shopify/Order/", "").trim();

  // ── Fetch function — called on mount and can be called again to refresh ───
  const fetchRecords = useCallback(async () => {
    if (!numericOrderId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Cache-busting timestamp so browser never serves a stale response
      const ts = Date.now();
      const res = await fetch(
        `${APP_URL}/api/order-status?orderId=${numericOrderId}&_ts=${ts}`,
        { cache: "no-store" }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: ApiResponse = await res.json();

      if (data.ok) {
        setRecords(data.lineItems ?? []);
      } else {
        setError(data.error ?? "Failed to load");
      }
    } catch (e: any) {
      // Differentiate common failure modes to give a helpful message in the UI
      const msg = String(e ?? "Unknown error");
      if (e instanceof TypeError) {
        // Often a network failure or CORS blocking will surface as a TypeError
        setError(
          `Unable to load freight status: network or CORS error. Check that ${APP_URL} is reachable and returns Access-Control-Allow-Origin.`
        );
      } else {
        setError(`Unable to load freight status: ${msg}`);
      }
    } finally {
      setLoading(false);
    }
  }, [numericOrderId]);

  // Fetch on mount + whenever order ID changes
  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // ── Get Shopify line items — try all known paths ──────────────────────────
  const rawLineItems: any[] =
    (order as any)?.lineItems ??
    (order as any)?.order?.lineItems ??
    (order as any)?.lineItems?.nodes ??
    (order as any)?.order?.lineItems?.nodes ??
    [];

  // ── Maps for matching ─────────────────────────────────────────────────────
  const recordByVariantId = new Map(records.map((r) => [r.variantId, r]));
  const recordByTitle = new Map(
    records.map((r) => [r.productTitle?.toLowerCase().trim(), r])
  );

  // ── Pair Shopify line items with DB records ───────────────────────────────
  type PairedItem = {
    item: any;
    orderIndex: number; // original index in the order (for reference label A/B/C)
    record: LineItemRecord;
    variantId: string;
  };

  const pairedItems: PairedItem[] = rawLineItems
    .map((item: any, index: number) => {
      const rawVid: string =
        item?.variant?.id ??
        item?.variantId ??
        item?.variant_id ??
        "";
      const variantId = rawVid
        .replace("gid://shopify/ProductVariant/", "")
        .trim();

      // Primary match: by variantId; fallback: by product title
      const record =
        recordByVariantId.get(variantId) ??
        recordByTitle.get(String(item?.title ?? "").toLowerCase().trim()) ??
        null;

      return { item, orderIndex: index, record, variantId };
    })
    .filter((x): x is PairedItem => x.record !== null);

  // ── Fallback: no Shopify line items — render DB records directly ──────────
  const showDirectRecords = records.length > 0 && rawLineItems.length === 0;

  const orderPrefix = numericOrderId.slice(-6);

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <BlockStack spacing="tight">
        <SkeletonText size="base" />
        <SkeletonText size="base" />
        <SkeletonText size="base" />
      </BlockStack>
    );
  }

  if (error) {
    return <Text size="small" appearance="subdued">{error}</Text>;
  }

  if (records.length === 0) return null;

  // ── Render directly from DB records (order hook returned no line items) ───
  if (showDirectRecords) {
    return (
      <BlockStack spacing="none">
        {records.map((record, index) => {
          // Use the real variant id as the reference when no Shopify line items
          const itemRef = record.variantId || `#${index + 1}`;
          const isLast = index === records.length - 1;
          return (
            <View key={record.variantId}>
              <ItemCard
                itemRef={itemRef}
                itemIndex={index + 1}
                title={record.productTitle || `Item ${index + 1}`}
                variantTitle=""
                quantity={1}
                image={record.imageUrl || undefined}
                record={record}
              />
              {!isLast && <Divider />}
            </View>
          );
        })}
      </BlockStack>
    );
  }

  if (pairedItems.length === 0) return null;

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <BlockStack spacing="none">
      {pairedItems.map(({ item, orderIndex, record, variantId }, cardIndex) => {
        // Prefer SKU or variant SKU when available, otherwise fall back to the numeric variantId
        const skuRef = item?.sku ?? item?.variant?.sku ?? variantId;
        const itemRef = String(skuRef ?? variantId);
        const isLast = cardIndex === pairedItems.length - 1;

        // Resolve image — try every known path Shopify exposes
        const imageUrl: string | undefined =
          item?.image?.url ??
          item?.featuredImage?.url ??
          item?.variant?.image?.url ??
          item?.product?.featuredImage?.url ??
          (record.imageUrl || undefined);

        return (
          <View key={item.id ?? variantId}>
            <ItemCard
              itemRef={itemRef}
              itemIndex={orderIndex + 1}
              title={
                record.productTitle ||
                String(item?.title ?? "") ||
                `Variant #${variantId}`
              }
              variantTitle={String(item?.variantTitle ?? "")}
              quantity={Number(item?.quantity ?? 1)}
              image={imageUrl}
              record={record}
            />
            {!isLast && <Divider />}
          </View>
        );
      })}
    </BlockStack>
  );
}

// ─── Item Card ────────────────────────────────────────────────────────────────

type ItemCardProps = {
  itemRef: string;
  itemIndex: number;
  title: string;
  variantTitle: string;
  quantity: number;
  image?: string;
  record: LineItemRecord;
};

function ItemCard({
  itemRef,
  itemIndex,
  title,
  variantTitle,
  quantity,
  image,
  record,
}: ItemCardProps) {
  const badge = resolveBadge(
    record.customerStatus ?? "",
    record.deliveryStatus ?? "",
    record.dispatchStatus ?? ""
  );

  // ── CRITICAL: read the raw field values directly from record ──────────────
  // Do NOT cache or transform — always derive fresh from the record prop
  const dateLabel = resolveDate(
    record.customerStatus ?? "",
    record.deliveryStatus ?? "",
    record.dispatchStatus ?? "",
    record
  );

  return (
    <View padding="base">
      <BlockStack spacing="tight">

        {/* Row 1: Reference + Badge */}
        <InlineStack
          spacing="base"
          blockAlignment="center"
          inlineAlignment="space-between"
        >
          <Text size="small" appearance="subdued">
            {itemRef} (Item {itemIndex})
          </Text>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </InlineStack>

        {/* Row 2: Thumbnail + Product info */}
        <InlineStack spacing="base" blockAlignment="center">
          {image ? (
            <View
              minInlineSize={56}
              maxInlineSize={56}
              border="base"
              borderRadius="base"
            >
              <Image
                source={image}
                accessibilityDescription={title}
                aspectRatio={1}
                fit="cover"
              />
            </View>
          ) : (
            <View
              minInlineSize={56}
              maxInlineSize={56}
              minBlockSize={56}
              background="subdued"
              border="base"
              borderRadius="base"
            />
          )}

          <BlockStack spacing="extraTight">
            <Text size="base" emphasis="bold">{title}</Text>
            {variantTitle && variantTitle !== "Default Title" ? (
              <Text size="small" appearance="subdued">{variantTitle}</Text>
            ) : null}
            <Text size="small" appearance="subdued">
              {quantity} {quantity === 1 ? "item" : "items"}
            </Text>
          </BlockStack>
        </InlineStack>

        {/* Row 3: Date line */}
        {dateLabel ? (
          <Text size="small" appearance="subdued">{dateLabel}</Text>
        ) : null}

        {/* Row 4: Tracking */}
        {record.trackingNumber ? (
          <Text size="small" appearance="subdued">
            Tracking: {record.trackingNumber}
            {record.carrier ? ` · ${record.carrier}` : ""}
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
  dispatchStatus: string
): { label: string; tone: Tone } {
  const d = ds?.toLowerCase?.() ?? "";
  const c = cs?.toLowerCase?.() ?? "";
  const dp = dispatchStatus?.toLowerCase?.() ?? "";

  // Prefer dispatch status when present — show meaningful dispatch labels
  if (dp) {
    if (dp === "dispatched") return { label: "Dispatched", tone: "success" };
    if (dp === "booked") return { label: "Booked", tone: "info" };
    if (dp === "not dispatched" || dp === "not-dispatched")
      return { label: "Not dispatched", tone: "warning" };
    if (dp === "failed") return { label: "Dispatch Failed", tone: "critical" };
    // Generic fallback: capitalise the dispatch status
    return { label: dp.split(/\s+/).map((s) => s[0]?.toUpperCase() + s.slice(1)).join(" "), tone: "info" };
  }

  // Otherwise fall back to delivery/customer statuses
  if (d === "delivered") return { label: "Delivered", tone: "success" };
  if (d === "out for delivery") return { label: "Out for Delivery", tone: "info" };
  if (d === "in transit") return { label: "In Transit", tone: "info" };
  if (d === "failed") return { label: "Delivery Failed", tone: "critical" };
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

  // ── Read raw date strings directly — never transform before this point ────
  const rawEdd = record.eddDate?.trim() ?? "";
  const rawInTransit = record.inTransitDate?.trim() ?? "";
  const rawPort = record.portArrivalDate?.trim() ?? "";

  // Format each only if non-empty
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

  // Pre-Order / Confirmed / Pending → show EDD
  return edd ? `Estimated dispatch: ${edd}` : null;
}

// ─── Date formatter ───────────────────────────────────────────────────────────
// KEY FIX: parse date parts manually to avoid timezone-shift bugs.
// new Date("2026-06-26") is parsed as UTC midnight, then displayed in local
// time — which shifts it back to June 25 in UTC+0 or earlier zones.
// Parsing as local noon avoids any off-by-one-day errors.

function formatDate(raw: string): string {
  try {
    // Expect "YYYY-MM-DD" — split and construct as local date
    const parts = raw.split("-");
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // 0-based
      const day = parseInt(parts[2], 10);
      const date = new Date(year, month, day); // local time — no UTC shift
      return date.toLocaleDateString("en-NZ", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    }
    // Fallback for unexpected formats
    return raw;
  } catch {
    return raw;
  }
}