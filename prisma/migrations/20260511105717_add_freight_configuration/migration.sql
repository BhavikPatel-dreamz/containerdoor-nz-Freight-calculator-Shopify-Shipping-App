-- CreateEnum
CREATE TYPE "CostType" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "CarrierCompany" AS ENUM ('FLIWAY', 'NZP', 'CASTLE', 'TGE', 'M2H');

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('STANDARD_DELIVERY', 'DEPOT_DELIVERY', 'CUSTOMER_PICKUP');

-- CreateEnum
CREATE TYPE "CarrierMode" AS ENUM ('AIR', 'ROAD');

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "fuelSurchargePercent" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "additionalCostType" "CostType" NOT NULL DEFAULT 'FIXED',
    "additionalCostValue" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'NZD',
    "defaultServiceType" "ServiceType" NOT NULL DEFAULT 'STANDARD_DELIVERY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingRate" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "company" "CarrierCompany" NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "city" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "useWeightRange" BOOLEAN NOT NULL DEFAULT false,
    "minWeightGrams" INTEGER,
    "maxWeightGrams" INTEGER,
    "useVolumeRange" BOOLEAN NOT NULL DEFAULT false,
    "minVolumeCm3" INTEGER,
    "maxVolumeCm3" INTEGER,
    "rate" DECIMAL(10,2) NOT NULL,
    "mode" "CarrierMode",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_shop_key" ON "AppSetting"("shop");

-- CreateIndex
CREATE INDEX "ShippingRate_shop_active_company_serviceType_idx" ON "ShippingRate"("shop", "active", "company", "serviceType");

-- CreateIndex
CREATE INDEX "ShippingRate_shop_city_postalCode_idx" ON "ShippingRate"("shop", "city", "postalCode");
