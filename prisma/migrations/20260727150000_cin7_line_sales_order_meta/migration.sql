-- Per-line Cin7 Sales Order metadata (canonical link lives on line ops).
ALTER TABLE "OrderLineItemOperationalData" ADD COLUMN IF NOT EXISTS "cin7SalesOrderCode" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OrderLineItemOperationalData" ADD COLUMN IF NOT EXISTS "cin7SalesOrderRef" TEXT NOT NULL DEFAULT '';
