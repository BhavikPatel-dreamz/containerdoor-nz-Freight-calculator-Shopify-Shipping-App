-- AlterTable
ALTER TABLE "OrderSnapshot" ADD COLUMN IF NOT EXISTS "shippingAddress2" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OrderSnapshot" ADD COLUMN IF NOT EXISTS "deliveryInstructions" TEXT NOT NULL DEFAULT '';
