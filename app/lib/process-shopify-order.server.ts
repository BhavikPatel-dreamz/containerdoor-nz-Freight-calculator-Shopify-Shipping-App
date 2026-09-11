/**
 * Public entry for processing exactly one Shopify order.
 *
 *   processShopifyOrder({ shop, shopifyOrderId })
 *
 * Always: Shopify → OMS → Cin7 → Monday (via runOrderPipeline).
 * Bulk / Sync Next / Retry must import from here — do not call ingest/Cin7/Monday adapters.
 */
export { processShopifyOrder, findNextEligibleShopifyOrder, summarizeSyncSystems } from "./migrate-shopify-oms.server";
export type { MigrateOrderResult, SyncSystemMark, FindNextEligibleResult } from "./migrate-shopify-oms.server";
