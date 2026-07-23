-- CreateTable
CREATE TABLE "OrderLineItemIndex" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL DEFAULT '',
    "gid" TEXT NOT NULL DEFAULT '',
    "orderName" TEXT NOT NULL DEFAULT '',
    "letterSuffix" TEXT NOT NULL DEFAULT '',
    "customerName" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "zip" TEXT NOT NULL DEFAULT '',
    "fullAddress" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" TEXT NOT NULL DEFAULT 'NZD',
    "totalFreight" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "carriers" TEXT NOT NULL DEFAULT '',
    "shippingTitle" TEXT NOT NULL DEFAULT '',
    "productTitle" TEXT NOT NULL DEFAULT '',
    "sku" TEXT NOT NULL DEFAULT '',
    "vendor" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "boxes" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "financialStatus" TEXT NOT NULL DEFAULT '',
    "fulfillmentStatus" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "OrderLineItemIndex_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderLineItemIndex_shop_createdAt_idx" ON "OrderLineItemIndex"("shop", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLineItemIndex_shop_orderId_variantId_key" ON "OrderLineItemIndex"("shop", "orderId", "variantId");
