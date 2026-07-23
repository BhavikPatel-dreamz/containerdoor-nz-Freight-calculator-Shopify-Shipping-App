-- Scale indexing for OrderLineItemIndex (targets ~1M line items).

-- Trigram search so `col ILIKE '%q%'` (leading wildcard) is index-backed.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Denormalized lowercase search blob (populated by the reindexer/backfill).
ALTER TABLE "OrderLineItemIndex" ADD COLUMN IF NOT EXISTS "searchText" TEXT NOT NULL DEFAULT '';

-- GIN trigram index backing the search predicate. (Prisma can't express GIN.)
CREATE INDEX IF NOT EXISTS "OrderLineItemIndex_searchText_trgm_idx"
  ON "OrderLineItemIndex" USING gin ("searchText" gin_trgm_ops);

-- Ordered index matching the list ORDER BY (shop const → createdAt DESC, orderId DESC, letterSuffix).
CREATE INDEX IF NOT EXISTS "OrderLineItemIndex_shop_createdAt_orderId_letterSuffix_idx"
  ON "OrderLineItemIndex" ("shop", "createdAt" DESC, "orderId" DESC, "letterSuffix");

-- Status index for the tab filter + count FILTER.
CREATE INDEX IF NOT EXISTS "OrderLineItemOperationalData_shop_customerStatus_idx"
  ON "OrderLineItemOperationalData" ("shop", "customerStatus");
