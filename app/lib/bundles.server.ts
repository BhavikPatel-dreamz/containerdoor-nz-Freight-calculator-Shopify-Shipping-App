/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shopify Bundles support.
 *
 * Discovery on order #CDL215395 (containerdoor-nz, API 2025-10):
 *  - The bundle parent is NOT a line item. The order contains only the
 *    component lines, each carrying a `lineItemGroup` object:
 *      lineItemGroup { id title productId variantId variantSku quantity }
 *  - `lineItemGroup` is non-null on every component line and shares the same
 *    group id (e.g. gid://shopify/LineItemGroup/27093205297) so a bundle's
 *    components are groupable. The group's productId/variantId is the parent.
 *  - Normal lines (incl. $0 BOGOS free-gift lines) have `lineItemGroup: null`.
 *    So a line is ONLY identified as a bundle component by a non-null
 *    `lineItemGroup` — never by price, SKU, title or empty carrier.
 *  - The REST orders/create webhook payload does NOT include lineItemGroup;
 *    it is fetched via GraphQL and attached to the payload before ingest.
 */

export type LineItemGroupInfo = {
  id?: string | null;
  title?: string | null;
  productId?: string | null;
  variantId?: string | null;
  variantSku?: string | null;
  quantity?: number | null;
};

export type BundledComponent = {
  variantId: string;
  productId: string;
  title: string;
  variantTitle: string;
  sku: string;
  quantity: number;
  lineItemId: string;
  lineItemGroup: LineItemGroupInfo;
};

export type BundleGroup = {
  group: LineItemGroupInfo;
  groupId: string;
  parentVariantId: string;
  parentProductId: string;
  parentTitle: string;
  parentSku: string;
  quantity: number;
  components: BundledComponent[];
};

function gidNumeric(gid?: string | null, kind = "ProductVariant"): string {
  return String(gid ?? "")
    .replace(`gid://shopify/${kind}/`, "")
    .trim();
}

function groupIdFromGid(gid?: string | null): string {
  return String(gid ?? "").replace("gid://shopify/LineItemGroup/", "").trim();
}

/** Group an order's line items by their LineItemGroup. Empty when not a bundle. */
export function getBundleGroups(order: any): Map<string, BundleGroup> {
  const map = new Map<string, BundleGroup>();
  for (const li of order?.line_items ?? []) {
    const g = li?.lineItemGroup;
    if (!g || !g.id) continue;
    const groupId = groupIdFromGid(g.id);
    if (!groupId) continue;
    let entry = map.get(groupId);
    if (!entry) {
      entry = {
        group: g,
        groupId,
        parentVariantId: gidNumeric(g.variantId),
        parentProductId: gidNumeric(g.productId, "Product"),
        parentTitle: String(g.title ?? ""),
        parentSku: String(g.variantSku ?? ""),
        quantity: Math.max(Number(g.quantity ?? 1) || 1, 1),
        components: [],
      };
      map.set(groupId, entry);
    }
    entry.components.push({
      variantId: String(li.variant_id ?? ""),
      productId: String(li.product_id ?? ""),
      title: String(li.title ?? ""),
      variantTitle: String(li.variant_title ?? ""),
      sku: String(li.sku ?? ""),
      quantity: Math.max(Number(li.quantity ?? 1) || 1, 1),
      lineItemId: String(li.id ?? ""),
      lineItemGroup: g,
    });
  }
  return map;
}

export function isBundleOrder(order: any): boolean {
  return getBundleGroups(order).size > 0;
}

/** Variant ids of every component line (never includes the parent variant). */
export function getBundleComponentVariantIds(order: any): Set<string> {
  const set = new Set<string>();
  for (const g of getBundleGroups(order).values()) {
    for (const c of g.components) {
      if (c.variantId) set.add(c.variantId);
    }
  }
  return set;
}

export type AdminGraphql = {
  graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

/**
 * Fetch `lineItemGroup` for each line item from Shopify GraphQL and attach it
 * to the webhook payload (the REST payload does not carry it). Best-effort:
 * never throws, never blocks the flow. Idempotent — skips when the payload
 * already has groups attached.
 */
export async function attachLineItemGroups(admin: AdminGraphql, order: any): Promise<any> {
  try {
    if (!admin?.graphql || !order?.id) return order;
    const alreadyAttached =
      Array.isArray(order.line_items) &&
      order.line_items.some((li: any) => li?.lineItemGroup !== undefined);
    if (alreadyAttached) return order;

    const response = await admin.graphql(
      `#graphql
      query OrderLineItemGroups($id: ID!) {
        order(id: $id) {
          lineItems(first: 100) {
            nodes {
              id
              lineItemGroup {
                id
                title
                productId
                variantId
                variantSku
                quantity
              }
            }
          }
        }
      }`,
      { variables: { id: `gid://shopify/Order/${order.id}` } },
    );
    const json = await response.json();
    const nodes = json?.data?.order?.lineItems?.nodes ?? [];
    const byLineId = new Map<string, any>(
      nodes.map((n: any) => [String(n.id ?? "").replace("gid://shopify/LineItem/", ""), n.lineItemGroup]),
    );
    for (const li of order.line_items ?? []) {
      if (li?.id !== undefined) {
        li.lineItemGroup = byLineId.get(String(li.id)) ?? null;
      }
    }
  } catch (error) {
    console.warn("[Bundle][attachLineItemGroups] failed (falling back to unbundled):", error);
  }
  return order;
}

/**
 * Cin7 line items for a bundle parent's single Sales Order: the aggregated
 * component SKUs (with weighted-average unit price so qty×price equals what
 * checkout charged per SKU). The parent itself is only included when it has a
 * real SKU (parent variants typically have none — SKU is null on #CDL215395).
 */
export function buildBundleCin7LineItems(
  order: any,
  parentVariantId: string,
): Array<{ code: string; name: string; qty: number; unitPrice: number }> {
  const groups = getBundleGroups(order);
  const group = [...groups.values()].find((g) => g.parentVariantId === String(parentVariantId));
  if (!group) return [];

  const priceByLineItemId = new Map<string, number>();
  for (const li of order?.line_items ?? []) {
    priceByLineItemId.set(String(li.id ?? ""), Number(li.price_set?.presentment_money?.amount ?? li.price ?? 0));
  }

  // Aggregate by SKU across the group's component lines, keeping each line's
  // own quantity and price (two lines may share a SKU, e.g. armless chair ×1 + ×2).
  const agg = new Map<string, { code: string; name: string; qty: number; total: number }>();
  for (const c of group.components) {
    if (!c.sku) continue;
    const qty = Math.max(c.quantity, 0);
    const unitPrice = Number.isFinite(priceByLineItemId.get(c.lineItemId) ?? 0)
      ? (priceByLineItemId.get(c.lineItemId) ?? 0)
      : 0;
    const existing = agg.get(c.sku);
    if (existing) {
      existing.qty += qty;
      existing.total += qty * unitPrice;
    } else {
      agg.set(c.sku, { code: c.sku, name: c.title, qty, total: qty * unitPrice });
    }
  }

  const parentSku = group.parentSku;
  if (parentSku) {
    agg.set(parentSku, {
      code: parentSku,
      name: group.parentTitle,
      qty: group.quantity,
      total: group.quantity * 0,
    });
  }

  return [...agg.values()]
    .filter((x) => x.qty > 0)
    .map((x) => ({ code: x.code, name: x.name, qty: x.qty, unitPrice: Math.round((x.total / x.qty) * 100) / 100 }));
}