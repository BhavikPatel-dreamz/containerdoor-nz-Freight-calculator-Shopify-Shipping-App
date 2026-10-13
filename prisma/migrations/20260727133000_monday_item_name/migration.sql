-- AlterTable
ALTER TABLE "OrderLineItemOperationalData" ADD COLUMN IF NOT EXISTS "mondayItemName" TEXT NOT NULL DEFAULT '';
