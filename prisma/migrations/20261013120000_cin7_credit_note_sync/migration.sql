-- CreateTable
CREATE TABLE "Cin7CreditNoteSync" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "letterSuffix" TEXT NOT NULL DEFAULT '',
    "shopifyRefundId" TEXT NOT NULL,
    "shopifyOrderName" TEXT NOT NULL DEFAULT '',
    "amount" DECIMAL(12,4) NOT NULL,
    "freightAmount" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "refundMethod" TEXT NOT NULL DEFAULT '',
    "cin7SalesOrderId" TEXT NOT NULL DEFAULT '',
    "cin7CreditNoteId" TEXT NOT NULL DEFAULT '',
    "cin7CreditNoteCode" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastError" TEXT NOT NULL DEFAULT '',
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cin7CreditNoteSync_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Cin7CreditNoteSync_shop_shopifyRefundId_variantId_key" ON "Cin7CreditNoteSync"("shop", "shopifyRefundId", "variantId");
CREATE INDEX "Cin7CreditNoteSync_shop_status_updatedAt_idx" ON "Cin7CreditNoteSync"("shop", "status", "updatedAt");
CREATE INDEX "Cin7CreditNoteSync_shop_orderId_idx" ON "Cin7CreditNoteSync"("shop", "orderId");
