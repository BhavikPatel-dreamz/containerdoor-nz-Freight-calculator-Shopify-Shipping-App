-- AlterTable
ALTER TABLE "OrderLineItemOperationalData"
ADD COLUMN "depotAddress1" TEXT NOT NULL DEFAULT '',
ADD COLUMN "depotCity" TEXT NOT NULL DEFAULT '',
ADD COLUMN "depotZip" TEXT NOT NULL DEFAULT '';