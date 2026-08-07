-- Add per-line shipping address fields to OrderLineItemOperationalData
ALTER TABLE "OrderLineItemOperationalData"
  ADD COLUMN IF NOT EXISTS "shippingFirstName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "shippingLastName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "shippingAddress1" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "shippingAddress2" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "shippingCity" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "shippingProvince" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "shippingZip" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "shippingCountry" TEXT NOT NULL DEFAULT '';
