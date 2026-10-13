/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pure helpers for allocating checkout freight to a single Cin7 Sales Order and
 * for pricing bundle component lines from the order's real product data.
 *
 * These are intentionally dependency-free (no Prisma, no network) so the
 * payload-building rules can be unit tested in isolation.
 */

/** Extract the trailing numeric id from a Shopify gid (`gid://shopify/ProductVariant/123`) or a plain id. */
export function normalizeCin7VariantId(value: unknown): string {
  const text = String(value ?? "").trim();
  const match = text.match(/(\d+)$/);
  return match ? match[1] : text;
}

export type FreightBreakdownEntry = {
  variantId?: string;
  company?: string;
  amount?: number;
  boxes?: number;
};

export type FreightBreakdownLike =
  | { lineItems?: FreightBreakdownEntry[] }
  | null
  | undefined;

const roundMoney = (n: number) => Math.round(n * 100) / 100;

/**
 * Allocate the checkout freight that belongs to ONE Sales Order.
 *
 * - A normal line takes the amount of its own variant in the freight breakdown.
 * - A bundle parent takes the sum of the breakdown amounts of its component
 *   variants. Each breakdown entry is counted once (matched by variant), never
 *   once per component row — a variant that appears in multiple component rows
 *   must contribute its freight exactly once.
 *
 * Returns `null` when the breakdown is missing or the line's variant(s) are not
 * present in it, so the caller can fail safely instead of guessing.
 */
export function allocateFreightForVariant(args: {
  breakdown: FreightBreakdownLike;
  variantId: string;
  componentVariantIds?: string[];
}): { amount: number; company: string; boxes: number } | null {
  const { breakdown, variantId, componentVariantIds = [] } = args;
  const entries = breakdown?.lineItems ?? [];
  if (!entries.length) return null;

  const wanted = new Set<string>();
  const self = normalizeCin7VariantId(variantId);
  if (self) wanted.add(self);
  for (const id of componentVariantIds) {
    const normalized = normalizeCin7VariantId(id);
    if (normalized) wanted.add(normalized);
  }

  let amount = 0;
  let boxes = 0;
  let company = "";
  let matched = false;
  for (const entry of entries) {
    if (!wanted.has(normalizeCin7VariantId(entry.variantId))) continue;
    matched = true;
    amount += Number(entry.amount ?? 0) || 0;
    boxes += Number(entry.boxes ?? 0) || 0;
    if (!company) company = String(entry.company ?? "").trim();
  }
  if (!matched) return null;
  return { amount: roundMoney(amount), company, boxes };
}

export type ShopifyLineItemLite = {
  variantId?: string | null;
  code?: string;
  name?: string;
  qty?: number;
  unitPrice?: number;
};

export type BundleComponentLine = {
  code: string;
  name: string;
  qty: number;
  unitPrice: number;
};

/**
 * Build the physical Cin7 lines for a bundle parent's components using the
 * order's REAL product prices (never 0). `shopifyLineItems` is the Sales Order
 * line shape already built from the Shopify order (`code` / `name` / `qty` /
 * `unitPrice` / `variantId`). Lines are aggregated per SKU with a weighted unit
 * price so the combined product value is preserved exactly and no duplicate
 * component codes are emitted. The bundle parent itself is never included, so it
 * cannot be double-counted with its components.
 */
export function buildBundleComponentLineItems(args: {
  componentVariantIds: string[];
  shopifyLineItems: ShopifyLineItemLite[];
}): BundleComponentLine[] {
  const { componentVariantIds, shopifyLineItems } = args;
  const wanted = new Set(
    componentVariantIds.map((id) => normalizeCin7VariantId(id)).filter((id) => Boolean(id)),
  );
  if (!wanted.size) return [];

  const bySku = new Map<string, { code: string; name: string; qty: number; value: number }>();
  for (const line of shopifyLineItems) {
    if (!wanted.has(normalizeCin7VariantId(line.variantId))) continue;
    const code = String(line.code ?? "").trim();
    if (!code) continue;
    const qty = Number(line.qty ?? 0) || 0;
    const price = Number(line.unitPrice ?? 0) || 0;
    const current = bySku.get(code) ?? { code, name: String(line.name ?? ""), qty: 0, value: 0 };
    if (!current.name) current.name = String(line.name ?? "");
    current.qty += qty;
    current.value += qty * price;
    bySku.set(code, current);
  }

  return [...bySku.values()].map(({ code, name, qty, value }) => ({
    code,
    name: name || code,
    qty,
    unitPrice: qty ? roundMoney(value / qty) : 0,
  }));
}

/** Sum of `qty * unitPrice` across a set of Sales Order lines. */
export function sumLineItemValue(lineItems: Array<{ qty?: number; unitPrice?: number }>): number {
  return roundMoney(
    (lineItems ?? []).reduce(
      (sum, line) => sum + (Number(line.qty ?? 0) || 0) * (Number(line.unitPrice ?? 0) || 0),
      0,
    ),
  );
}
