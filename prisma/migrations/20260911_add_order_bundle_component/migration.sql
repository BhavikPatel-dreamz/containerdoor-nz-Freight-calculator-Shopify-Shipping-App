-- CreateTable
CREATE TABLE "OrderBundleComponent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL DEFAULT '',
    "parentVariantId" TEXT NOT NULL,
    "parentProductId" TEXT NOT NULL DEFAULT '',
    "parentTitle" TEXT NOT NULL DEFAULT '',
    "parentSku" TEXT NOT NULL DEFAULT '',
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL DEFAULT '',
    "productTitle" TEXT NOT NULL DEFAULT '',
    "variantTitle" TEXT NOT NULL DEFAULT '',
    "sku" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "lineItemId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrderBundleComponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderBundleComponent_shop_orderId_idx" ON "OrderBundleComponent"("shop", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderBundleComponent_shop_orderId_lineItemId_key" ON "OrderBundleComponent"("shop", "orderId", "lineItemId");