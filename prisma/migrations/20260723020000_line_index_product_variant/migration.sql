-- Add Product ID + Variant title to the line-item index (CS dashboard columns).
ALTER TABLE "OrderLineItemIndex" ADD COLUMN IF NOT EXISTS "productId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OrderLineItemIndex" ADD COLUMN IF NOT EXISTS "variantTitle" TEXT NOT NULL DEFAULT '';
