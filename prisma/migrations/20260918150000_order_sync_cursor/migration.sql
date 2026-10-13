-- Resume cursor for Order Sync cron (survives process / server restart).

CREATE TABLE IF NOT EXISTS "OrderSyncCursor" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'cron',
  "after" TEXT NOT NULL DEFAULT '',
  "skipIdsJson" TEXT NOT NULL DEFAULT '[]',
  "lastOrderId" TEXT NOT NULL DEFAULT '',
  "lastOrderName" TEXT NOT NULL DEFAULT '',
  "lastOk" BOOLEAN,
  "lastMessage" TEXT NOT NULL DEFAULT '',
  "processed" INTEGER NOT NULL DEFAULT 0,
  "success" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "caughtUp" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderSyncCursor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrderSyncCursor_shop_source_key" ON "OrderSyncCursor"("shop", "source");
