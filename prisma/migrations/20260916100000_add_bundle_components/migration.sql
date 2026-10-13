CREATE TABLE "BundleComponent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "bundleGroupId" TEXT NOT NULL,
    "parentLineItemId" TEXT NOT NULL,
    "parentVariantId" TEXT NOT NULL,
    "parentSku" TEXT NOT NULL DEFAULT '',
    "parentQuantity" INTEGER NOT NULL,
    "componentLineItemId" TEXT NOT NULL,
    "componentVariantId" TEXT NOT NULL,
    "componentSku" TEXT NOT NULL DEFAULT '',
    "componentQuantity" INTEGER NOT NULL,
    "componentTitle" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BundleComponent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BundleComponent_shop_orderId_bundleGroupId_componentLineItemId_key"
ON "BundleComponent"("shop", "orderId", "bundleGroupId", "componentLineItemId");

CREATE INDEX "BundleComponent_shop_orderId_parentVariantId_idx"
ON "BundleComponent"("shop", "orderId", "parentVariantId");