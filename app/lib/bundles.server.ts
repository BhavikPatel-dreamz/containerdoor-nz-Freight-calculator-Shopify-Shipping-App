/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Shopify bundle relationships are represented by the Admin GraphQL
 * `LineItem.lineItemGroup` field. The REST webhook can carry the same
 * relationship as lineItemGroup after the order has been hydrated from GraphQL.
 */

export type BundleComponent = {
  lineItemId: string;
  variantId: string;
  sku: string;
  title: string;
  quantity: number;
  unitPrice: number;
};

export type BundleGroup = {
  id: string;
  parentLineItemId: string;
  parentVariantId: string;
  parentProductId: string;
  parentSku: string;
  parentTitle: string;
  parentQuantity: number;
  components: BundleComponent[];
};

export type LineItemGroupInfo = {
  id: string;
  title?: string | null;
  productId?: string | null;
  variantId?: string | null;
  variantSku?: string | null;
  quantity?: number | null;
};

function asId(value: unknown): string {
  const text = String(value ?? "").trim();
  const match = text.match(/(\d+)$/);
  return match ? match[1] : text;
}

function lineId(line: any): string {
  return asId(line?.id ?? line?.line_item_id);
}

function variantId(line: any): string {
  return asId(line?.variant_id ?? line?.variant?.id);
}

function groupFor(line: any): any | null {
  return line?.lineItemGroup ?? line?.line_item_group ?? line?.groupedBy ?? line?.grouped_by ?? null;
}

function groupId(group: any): string {
  return asId(group?.id ?? group?.groupId ?? group?.group_id);
}

function groupParentVariantId(group: any): string {
  return asId(
    group?.parentVariantId ?? group?.parent_variant_id ?? group?.variantId ?? group?.variant_id ?? group?.variant?.id,
  );
}

function groupParentLineId(group: any): string {
  return asId(
    group?.parentLineItemId ??
      group?.parent_line_item_id ??
      group?.parentLineItem?.id ??
      group?.parent_line_item?.id ??
      group?.lineItemId ??
      group?.line_item_id,
  );
}

function unitPrice(line: any): number {
  return Number(line?.price_set?.presentment_money?.amount ?? line?.price ?? line?.originalUnitPriceSet?.presentmentMoney?.amount ?? 0) || 0;
}

function allLines(order: any): any[] {
  return Array.isArray(order?.line_items) ? order.line_items : [];
}

/** Returns only Shopify line items that are customer-facing OMS lines. */
export function getCustomerFacingLineItems<T extends Record<string, any>>(order: { line_items?: T[] }): T[] {
  const components = getBundleComponentVariantIds(order);
  if (!components.size) return order.line_items ?? [];
  const groups = getBundleGroups(order);
  const existingVariants = new Set((order.line_items ?? []).filter((line) => !components.has(variantId(line))).map((line) => variantId(line)));
  const visible: T[] = [];
  const inserted = new Set<string>();
  for (const line of order.line_items ?? []) {
    const lineVariantId = variantId(line);
    const group = [...groups.values()].find((item) => item.components.some((component) => component.lineItemId === lineId(line)));
    if (group) {
      if (inserted.has(group.id)) continue;
      inserted.add(group.id);
      if (existingVariants.has(group.parentVariantId)) continue;
      visible.push({
        id: `bundle:${group.id}`,
        variant_id: group.parentVariantId,
        product_id: group.parentProductId,
        title: group.parentTitle,
        sku: group.parentSku,
        quantity: group.parentQuantity,
        price: "0",
        isBundleParent: true,
        bundleGroupId: group.id,
        lineItemGroup: {
          id: group.id,
          parentLineItemId: group.parentLineItemId,
          parentVariantId: group.parentVariantId,
          parentProductId: group.parentProductId,
          parentSku: group.parentSku,
          parentTitle: group.parentTitle,
        },
      } as unknown as T);
      continue;
    }
    if (!components.has(lineVariantId)) visible.push(line);
  }
  for (const group of groups.values()) {
    if (inserted.has(group.id) || existingVariants.has(group.parentVariantId)) continue;
    visible.push({
      id: `bundle:${group.id}`,
      variant_id: group.parentVariantId,
      product_id: group.parentProductId,
      title: group.parentTitle,
      sku: group.parentSku,
      quantity: group.parentQuantity,
      price: "0",
      isBundleParent: true,
      bundleGroupId: group.id,
      lineItemGroup: { id: group.id, parentLineItemId: group.parentLineItemId, parentVariantId: group.parentVariantId },
    } as unknown as T);
  }
  return visible;
}

/** Normalize Shopify bundle groups without making any database or API calls. */
export function getBundleGroups(order: any): Map<string, BundleGroup> {
  const lines = allLines(order);
  const groups = new Map<string, BundleGroup>();

  for (const line of lines) {
    const group = groupFor(line);
    const id = groupId(group);
    if (!group || !id) continue;

    const parentLineItemId = groupParentLineId(group);
    const parentVariantId = groupParentVariantId(group);
    const isParent = Boolean(
      (parentLineItemId && parentLineItemId === lineId(line)) ||
      (parentVariantId && parentVariantId === variantId(line)),
    );
    const current = groups.get(id);
    if (!current) {
      groups.set(id, {
        id,
        parentLineItemId,
        parentVariantId,
        parentProductId: asId(group?.parentProductId ?? group?.parent_product_id ?? group?.productId ?? group?.product_id ?? group?.product?.id),
        parentSku: String(group?.parentSku ?? group?.parent_sku ?? group?.variantSku ?? group?.variant_sku ?? ""),
        parentTitle: String(group?.parentTitle ?? group?.parent_title ?? group?.title ?? ""),
        parentQuantity: Math.max(Number(group?.quantity ?? 1) || 1, 1),
        components: [],
      });
    }
    const normalized = groups.get(id)!;
    if (isParent) {
      normalized.parentLineItemId = lineId(line);
      normalized.parentVariantId = variantId(line);
      normalized.parentProductId = asId(line?.product_id ?? line?.variant?.product?.id ?? normalized.parentProductId);
      normalized.parentSku = String(line?.sku ?? line?.variant?.sku ?? normalized.parentSku);
      normalized.parentTitle = String(line?.title ?? line?.name ?? normalized.parentTitle);
      normalized.parentQuantity = Math.max(Number(line?.quantity ?? 1) || 1, 1);
    }
  }

  for (const line of lines) {
    const group = groupFor(line);
    const id = groupId(group);
    const normalized = id ? groups.get(id) : undefined;
    if (!normalized || lineId(line) === normalized.parentLineItemId || variantId(line) === normalized.parentVariantId) continue;
    const component: BundleComponent = {
      lineItemId: lineId(line),
      variantId: variantId(line),
      sku: String(line?.sku ?? line?.variant?.sku ?? ""),
      title: String(line?.title ?? line?.name ?? ""),
      quantity: Math.max(Number(line?.quantity ?? 1) || 1, 1),
      unitPrice: unitPrice(line),
    };
    if (!component.lineItemId && !component.variantId) continue;
    if (!normalized.components.some((item) => item.lineItemId === component.lineItemId)) normalized.components.push(component);
  }

  for (const group of groups.values()) {
    const parentLine = lines.find(
      (line) =>
        (group.parentLineItemId && group.parentLineItemId === lineId(line)) ||
        (group.parentVariantId && group.parentVariantId === variantId(line)),
    );
    if (parentLine) {
      if (!group.parentTitle) group.parentTitle = String(parentLine?.title ?? parentLine?.name ?? "");
      if (!group.parentSku) group.parentSku = String(parentLine?.sku ?? parentLine?.variant?.sku ?? "");
      const pVid = variantId(parentLine);
      if (pVid) group.parentVariantId = pVid;
      const pPid = asId(parentLine?.product_id ?? parentLine?.variant?.product?.id);
      if (pPid) group.parentProductId = pPid;
      const pLid = lineId(parentLine);
      if (pLid) group.parentLineItemId = pLid;
    }
  }

  return new Map([...groups].filter(([, group]) => Boolean(group.parentVariantId && group.components.length)));
}

export function isBundleOrder(order: any): boolean {
  return getBundleGroups(order).size > 0;
}

export function getBundleComponentVariantIds(order: any): Set<string> {
  const ids = new Set<string>();
  for (const group of getBundleGroups(order).values()) {
    for (const component of group.components) if (component.variantId) ids.add(component.variantId);
  }
  return ids;
}

/** Build the physical Cin7 lines for one bundle parent, aggregating duplicate SKUs. */
export function buildBundleCin7LineItems(order: any, parentVariantId: string) {
  const group = [...getBundleGroups(order).values()].find((item) => item.parentVariantId === String(parentVariantId));
  if (!group) return [];
  const bySku = new Map<string, { code: string; name: string; qty: number; unitPrice: number; value: number }>();
  for (const component of group.components) {
    if (!component.sku) continue;
    const current = bySku.get(component.sku) ?? { code: component.sku, name: component.title || group.parentTitle, qty: 0, unitPrice: 0, value: 0 };
    current.qty += component.quantity;
    current.value += component.quantity * component.unitPrice;
    current.unitPrice = current.qty ? current.value / current.qty : 0;
    bySku.set(component.sku, current);
  }
  if (group.parentSku && !bySku.has(group.parentSku)) {
    bySku.set(group.parentSku, { code: group.parentSku, name: group.parentTitle, qty: group.parentQuantity, unitPrice: 0, value: 0 });
  }
  return [...bySku.values()].map(({ code, name, qty, unitPrice: price }) => ({
    code,
    name,
    qty,
    unitPrice: Number(price.toFixed(2)),
  }));
}

/** Attach GraphQL lineItemGroup relationships to a REST-shaped order payload. */
export async function attachBundleRelationships(
  admin: { graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> },
  order: any,
): Promise<void> {
  if (!order?.id || isBundleOrder(order)) return;
  const response = await admin.graphql(
    `#graphql
    query BundleLineItems($id: ID!) {
      order(id: $id) {
        lineItems(first: 250) {
          nodes {
            id quantity title sku
            variant { id sku product { id } }
            lineItemGroup {
              id title quantity productId variantId variantSku
            }
          }
        }
      }
    }`,
    { variables: { id: `gid://shopify/Order/${order.id}` } },
  );
  const json = await response.json();
  const nodes = json?.data?.order?.lineItems?.nodes;
  console.log(
    `[Bundle][Hydration][${String(order.id)}] GraphQL groups=${Array.isArray(nodes) ? nodes.filter((node: any) => Boolean(node?.lineItemGroup ?? node?.groupedBy)).length : 0}`,
  );
  if (!Array.isArray(nodes)) return;
  const byId = new Map(allLines(order).map((line) => [lineId(line), line]));
  for (const node of nodes) {
    const lineItemGroup = node?.lineItemGroup;
    const relationship = lineItemGroup ?? node?.groupedBy;
    if (!relationship?.id) continue;
    const line = byId.get(lineId(node));
    if (!line) continue;
    line.lineItemGroup = {
      id: relationship.id,
      parentLineItemId:
        relationship.parentLineItemId ??
        relationship.parent_line_item_id ??
        relationship.parentLineItem?.id ??
        relationship.parent_line_item?.id,
      parentVariantId: relationship.parentVariantId ?? relationship.variantId ?? relationship.variant?.id,
      parentProductId: relationship.parentProductId ?? relationship.productId ?? relationship.variant?.product?.id,
      parentSku: relationship.parentSku ?? relationship.variantSku ?? relationship.sku ?? relationship.variant?.sku ?? "",
      parentTitle: relationship.parentTitle ?? relationship.title ?? "",
    };
  }
  const hydratedGroups = getBundleGroups(order);
  for (const group of hydratedGroups.values()) {
    console.log(
      `[Bundle][Hydration][${String(order.id)}] parent=${group.parentVariantId} components=${group.components.length}`,
    );
  }
}

// Kept as a descriptive alias for callers that specifically hydrate a REST
// webhook payload. The relationship source remains Shopify GraphQL lineItemGroup.
export const attachLineItemGroups = attachBundleRelationships;

export function bundleComponentRows(order: any) {
  const rows: Array<Record<string, unknown>> = [];
  for (const group of getBundleGroups(order).values()) {
    for (const component of group.components) {
      rows.push({
        bundleGroupId: group.id,
        parentLineItemId: group.parentLineItemId,
        parentVariantId: group.parentVariantId,
        parentSku: group.parentSku,
        parentQuantity: group.parentQuantity,
        componentLineItemId: component.lineItemId,
        componentVariantId: component.variantId,
        componentSku: component.sku,
        componentQuantity: component.quantity,
        componentTitle: component.title,
      });
    }
  }
  return rows;
}