-- Manual migration: add color columns for OrderLineItemOperationalData
-- Adds carrierColor, carrierColorLabel, customerStatusColor,
-- paymentStatusColor, warehouseStatusColor as TEXT NOT NULL DEFAULT ''

BEGIN;

ALTER TABLE "OrderLineItemOperationalData"
  ADD COLUMN IF NOT EXISTS "carrierColor" TEXT NOT NULL DEFAULT '';

ALTER TABLE "OrderLineItemOperationalData"
  ADD COLUMN IF NOT EXISTS "carrierColorLabel" TEXT NOT NULL DEFAULT '';

ALTER TABLE "OrderLineItemOperationalData"
  ADD COLUMN IF NOT EXISTS "customerStatusColor" TEXT NOT NULL DEFAULT '';

ALTER TABLE "OrderLineItemOperationalData"
  ADD COLUMN IF NOT EXISTS "paymentStatusColor" TEXT NOT NULL DEFAULT '';

ALTER TABLE "OrderLineItemOperationalData"
  ADD COLUMN IF NOT EXISTS "warehouseStatusColor" TEXT NOT NULL DEFAULT '';

COMMIT;
