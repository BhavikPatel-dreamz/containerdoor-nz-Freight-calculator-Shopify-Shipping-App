-- Manual migration: add Shopify ordered line-item quantity to OrderLineItemIndex.
-- This is the source of truth for OMS Qty (units/items ordered Shopify), distinct
-- from `boxes` (cartons in the freight code, which must NOT be used for OMS Qty).
-- Default 0 for the column; backfill below pulls each line's Shopify ordered
-- quantity from OrderSnapshot.lineItemsJson.

BEGIN;

ALTER TABLE "OrderLineItemIndex"
  ADD COLUMN IF NOT EXISTS "quantity" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing index rows from the snapshot's stored Shopify line-item
-- quantity (variantId-keyed). Skips rows with empty/malformed JSON, leaving
-- the default (which callers fall back to 1 for).
DO $$
DECLARE
  r RECORD;
  li JSON;
  qty_val INT;
BEGIN
  FOR r IN
    SELECT idx."id" AS idx_id, idx."variantId",
           snap."lineItemsJson" AS line_items_json
    FROM "OrderLineItemIndex" idx
    JOIN "OrderSnapshot" snap
      ON snap."shop" = idx."shop" AND snap."orderId" = idx."orderId"
    WHERE idx."quantity" = 0
  LOOP
    BEGIN
      IF r.line_items_json IS NOT NULL AND r.line_items_json <> '' AND r.line_items_json <> '[]' THEN
        FOR li IN SELECT * FROM json_array_elements(r.line_items_json::json) LOOP
          IF (li->>'variantId')::text = r."variantId" THEN
            qty_val := GREATEST(COALESCE((li->>'quantity')::int, 1), 1);
            UPDATE "OrderLineItemIndex" SET "quantity" = qty_val WHERE "id" = r.idx_id;
            EXIT;
          END IF;
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Malformed JSON for this row — leave default; reindex/backfill later.
    END;
  END LOOP;
END $$;

COMMIT;
