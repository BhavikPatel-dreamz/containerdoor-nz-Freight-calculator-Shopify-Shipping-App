-- Control Center: migration run / per-order / per-step logs (no secrets/PII payloads).

CREATE TABLE IF NOT EXISTS "MigrationRun" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'full',
  "orderLimit" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "totalOrders" INTEGER NOT NULL DEFAULT 0,
  "processedOrders" INTEGER NOT NULL DEFAULT 0,
  "successfulOrders" INTEGER NOT NULL DEFAULT 0,
  "failedOrders" INTEGER NOT NULL DEFAULT 0,
  "skippedOrders" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MigrationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MigrationRun_shop_startedAt_idx" ON "MigrationRun"("shop", "startedAt");
CREATE INDEX IF NOT EXISTS "MigrationRun_shop_status_idx" ON "MigrationRun"("shop", "status");

CREATE TABLE IF NOT EXISTS "MigrationOrder" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "shopifyOrderId" TEXT NOT NULL,
  "shopifyOrderName" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "currentStep" TEXT NOT NULL DEFAULT '',
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "durationMs" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT NOT NULL DEFAULT '',
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "lastRetryAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MigrationOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MigrationOrder_runId_idx" ON "MigrationOrder"("runId");
CREATE INDEX IF NOT EXISTS "MigrationOrder_shopifyOrderId_idx" ON "MigrationOrder"("shopifyOrderId");

CREATE TABLE IF NOT EXISTS "MigrationStepLog" (
  "id" TEXT NOT NULL,
  "migrationOrderId" TEXT NOT NULL,
  "step" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL,
  "durationMs" INTEGER NOT NULL DEFAULT 0,
  "requestSummary" TEXT NOT NULL DEFAULT '',
  "responseSummary" TEXT NOT NULL DEFAULT '',
  "error" TEXT NOT NULL DEFAULT '',
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MigrationStepLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MigrationStepLog_migrationOrderId_startedAt_idx" ON "MigrationStepLog"("migrationOrderId", "startedAt");
