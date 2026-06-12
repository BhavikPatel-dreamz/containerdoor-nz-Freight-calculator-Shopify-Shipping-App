import { useEffect, useState, useCallback } from "react";
import {
  reactExtension,
  useApi,
  AdminBlock,
  BlockStack,
  InlineStack,
  Divider,
  Text,
  Badge,
  Banner,
  ProgressIndicator,
  Box,
} from "@shopify/ui-extensions-react/admin";
import { parseFreightCode, type FreightBreakdown } from "./freight";

const TARGET = "admin.order-details.block.render";
export default reactExtension(TARGET, () => <OrderFreightBlock />);

type ShippingLineNode = { title: string; code: string | null };
type LineItemNode = { title: string; variant?: { id: string } | null };

function OrderFreightBlock() {
  const api = useApi(TARGET);
  const orderId = (api.data as any).selected?.[0]?.id as string | undefined;

  const [breakdown, setBreakdown] = useState<FreightBreakdown | null>(null);
  const [titleByVariant, setTitleByVariant] = useState<Record<string, string>>({});
  const [shippingTitle, setShippingTitle] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // api.query() is automatically authenticated against the Admin GraphQL API
  // and returns { data, errors } directly (no .json() needed).
  const gql = useCallback(
    async (query: string, variables?: Record<string, unknown>) => {
      const res = await (api as any).query(query, { variables });
      if (res?.errors?.length) {
        throw new Error(res.errors[0]?.message ?? "GraphQL error");
      }
      return res;
    },
    [api],
  );

  const load = useCallback(async () => {
    if (!orderId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await gql(
        `#graphql
        query OrderFreight($id: ID!) {
          order(id: $id) {
            shippingLines(first: 10) {
              nodes { title code }
            }
            lineItems(first: 50) {
              nodes { title variant { id } }
            }
          }
        }`,
        { id: orderId },
      );

      const order = res?.data?.order;
      const shippingLines: ShippingLineNode[] = order?.shippingLines?.nodes ?? [];
      const lineItems: LineItemNode[] = order?.lineItems?.nodes ?? [];

      // Map numeric variant id -> product title for nicer display.
      const titleMap: Record<string, string> = {};
      for (const li of lineItems) {
        if (li.variant?.id) {
          const numericId = li.variant.id.replace("gid://shopify/ProductVariant/", "");
          titleMap[numericId] = li.title;
        }
      }

      // Find the freight shipping line and parse its encoded code.
      let parsed: FreightBreakdown | null = null;
      let title = "";
      for (const s of shippingLines) {
        const p = parseFreightCode(s.code);
        if (p) {
          parsed = p;
          title = s.title;
          break;
        }
      }

      setTitleByVariant(titleMap);
      setBreakdown(parsed);
      setShippingTitle(title);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load freight info");
    } finally {
      setLoading(false);
    }
  }, [orderId, gql]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <AdminBlock title="Freight">
        <InlineStack inlineAlignment="center" blockAlignment="center">
          <ProgressIndicator size="small-200" />
        </InlineStack>
      </AdminBlock>
    );
  }

  if (error) {
    return (
      <AdminBlock title="Freight">
        <Banner tone="critical" title="Could not load freight info">
          <Text>{error}</Text>
        </Banner>
      </AdminBlock>
    );
  }

  if (!breakdown) {
    return (
      <AdminBlock title="Freight">
        <Text>No freight breakdown on this order.</Text>
      </AdminBlock>
    );
  }

  return (
    <AdminBlock title="Freight">
      <BlockStack gap="base">
        <InlineStack gap="base" blockAlignment="center">
          {shippingTitle ? <Text fontWeight="bold">{shippingTitle}</Text> : null}
          <Badge tone="info">{breakdown.packageCount}</Badge>
          <Badge>{breakdown.carriers}</Badge>
        </InlineStack>

        <Divider />

        <BlockStack gap="base">
          {breakdown.lineItems.map((item, idx) => (
            <InlineStack key={`${item.variantId}-${idx}`} gap="base" blockAlignment="center">
              <Box minInlineSize="50%">
                <Text>
                  {titleByVariant[item.variantId] ?? `Variant #${item.variantId}`}
                </Text>
              </Box>
              <Badge tone="success">{item.companyLabel}</Badge>
              <Text>
                {item.boxes} {item.boxes === 1 ? "box" : "boxes"}
              </Text>
            </InlineStack>
          ))}
        </BlockStack>
      </BlockStack>
    </AdminBlock>
  );
}
