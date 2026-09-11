-- Per-order Shopify → OMS / Cin7 / Monday migrate reports (re-runnable).

CREATE TABLE IF NOT EXISTS "OrderMigrateReport" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderName" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "omsAction" TEXT NOT NULL DEFAULT '',
  "mondayAction" TEXT NOT NULL DEFAULT '',
  "cin7Action" TEXT NOT NULL DEFAULT '',
  "lastError" TEXT NOT NULL DEFAULT '',
  "runCount" INTEGER NOT NULL DEFAULT 1,
  "stepsJson" TEXT NOT NULL DEFAULT '[]',
  "linesJson" TEXT NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderMigrateReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrderMigrateReport_shop_orderId_key" ON "OrderMigrateReport"("shop", "orderId");
CREATE INDEX IF NOT EXISTS "OrderMigrateReport_shop_updatedAt_idx" ON "OrderMigrateReport"("shop", "updatedAt");
CREATE INDEX IF NOT EXISTS "OrderMigrateReport_shop_orderName_idx" ON "OrderMigrateReport"("shop", "orderName");
