import { useEffect, useState } from "react";
import {
  useApi,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Banner,
  Divider,
  SkeletonText,
} from "@shopify/ui-extensions-react/customer-account";
import { parseFreightMetafield, type FreightPayload } from "./freight";

const GRAPHQL_URL = "shopify://customer-account/api/2025-07/graphql.json";

// Shared block rendered on both the order-status and full order-page targets.
// Reads the freight breakdown from the order metafield written at order create
// (containerdoor_freight.freight_data) because the customer-account
// ShippingLine object does not expose the encoded `code` field.
export function OrderFreight() {
  const api = useApi() as any;

  // The order GID is exposed differently across targets; try the known shapes.
  const orderId: string | undefined =
    api?.orderId ?? api?.order?.id ?? api?.data?.order?.id;

  const [payload, setPayload] = useState<FreightPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!orderId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(GRAPHQL_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `query OrderFreight($id: ID!) {
              order(id: $id) {
                metafield(namespace: "containerdoor_freight", key: "freight_data") {
                  value
                }
              }
            }`,
            variables: { id: orderId },
          }),
        });
        const json = await res.json();
        if (json?.errors?.length) {
          throw new Error(json.errors[0]?.message ?? "GraphQL error");
        }
        if (cancelled) return;
        const value: string | null = json?.data?.order?.metafield?.value ?? null;
        setPayload(parseFreightMetafield(value));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load freight info");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (loading) {
    return (
      <BlockStack>
        <SkeletonText />
        <SkeletonText />
      </BlockStack>
    );
  }

  if (error) {
    return (
      <Banner status="critical" title="Could not load freight details">
        <Text>{error}</Text>
      </Banner>
    );
  }

  // No freight data — render nothing so the page stays clean.
  if (!payload || payload.lineItems.length === 0) {
    return null;
  }

  return (
    <BlockStack spacing="base">
      <Text size="medium" emphasis="bold">
        Freight &amp; delivery
      </Text>
      <InlineStack spacing="base">
        {payload.packageCount ? <Badge tone="info">{payload.packageCount}</Badge> : null}
        {payload.carriers ? <Badge>{payload.carriers}</Badge> : null}
      </InlineStack>

      <Divider />

      <BlockStack spacing="tight">
        {payload.lineItems.map((item, idx) => (
          <InlineStack
            key={`${item.variantId}-${idx}`}
            spacing="base"
            blockAlignment="center"
          >
            <Text>{item.title ?? `Variant #${item.variantId}`}</Text>
            <Badge tone="success">{item.companyLabel}</Badge>
            <Text appearance="subdued">
              {item.boxes} {item.boxes === 1 ? "box" : "boxes"}
            </Text>
          </InlineStack>
        ))}
      </BlockStack>
    </BlockStack>
  );
}
