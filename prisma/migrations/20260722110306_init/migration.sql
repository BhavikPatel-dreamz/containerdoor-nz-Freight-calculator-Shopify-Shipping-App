-- CreateEnum
CREATE TYPE "CostType" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "CarrierCompany" AS ENUM ('FLIWAY', 'FLIWAYLINEHAUL', 'FLIWAYMIDSIZE', 'NZP', 'NZP_AGE_RESTRICTED', 'CASTLE', 'TGE', 'M2H', 'MAINFREIGHT');

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('STANDARD_DELIVERY', 'DEPOT_DELIVERY', 'CUSTOMER_PICKUP');

-- CreateEnum
CREATE TYPE "CarrierMode" AS ENUM ('AIR', 'ROAD');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "fuelSurchargePercent" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "additionalCostType" "CostType" NOT NULL DEFAULT 'FIXED',
    "additionalCostValue" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'NZD',
    "defaultServiceType" "ServiceType" NOT NULL DEFAULT 'STANDARD_DELIVERY',
    "fafFliway" DECIMAL(65,30) NOT NULL DEFAULT 30.5,
    "fafFliwayMidsize" DECIMAL(65,30) NOT NULL DEFAULT 30.5,
    "fafMainfreight" DECIMAL(65,30) NOT NULL DEFAULT 36.35,
    "fafTge" DECIMAL(65,30) NOT NULL DEFAULT 29.8,
    "fafM2h" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "tgeAdminFee" DECIMAL(65,30) NOT NULL DEFAULT 12.69,
    "homeDeliveryFeeFliway" DECIMAL(10,2) NOT NULL DEFAULT 45,
    "homeDeliveryFeeFliwayMidsize" DECIMAL(10,2) NOT NULL DEFAULT 45,
    "homeDeliveryFeeTge" DECIMAL(10,2) NOT NULL DEFAULT 25,
    "mainfreightDepotFee" DECIMAL(10,2) NOT NULL DEFAULT 25,
    "marginRate" DECIMAL(10,2) NOT NULL DEFAULT 10,
    "gstRate" DECIMAL(10,2) NOT NULL DEFAULT 15,
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
    "sector" TEXT,
    "postalCode" TEXT NOT NULL,
    "useWeightRange" BOOLEAN NOT NULL DEFAULT false,
    "minWeightGrams" INTEGER,
    "maxWeightGrams" INTEGER,
    "useVolumeRange" BOOLEAN NOT NULL DEFAULT false,
    "minVolumeCm3" INTEGER,
    "maxVolumeCm3" INTEGER,
    "rate" DECIMAL(10,4) NOT NULL,
    "zoneSurcharge" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "minimumCharge" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "baseFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "homeDeliveryFee" DECIMAL(10,2),
    "signatureSurcharge" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "ruralSurcharge" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "ageRestrictedSurcharge" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "residentialFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "mode" "CarrierMode",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderOperationalData" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerStatus" TEXT NOT NULL DEFAULT '',
    "warehouseStatus" TEXT NOT NULL DEFAULT '',
    "dispatchStatus" TEXT NOT NULL DEFAULT '',
    "trackingNumber" TEXT NOT NULL DEFAULT '',
    "deliveryStatus" TEXT NOT NULL DEFAULT '',
    "poNumber" TEXT NOT NULL DEFAULT '',
    "depositPaid" TEXT NOT NULL DEFAULT '',
    "balanceDue" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "eddDate" TEXT NOT NULL DEFAULT '',
    "supplierContainer" TEXT NOT NULL DEFAULT '',
    "portArrivalDate" TEXT NOT NULL DEFAULT '',
    "inTransitDate" TEXT NOT NULL DEFAULT '',
    "cin7SalesOrderId" TEXT NOT NULL DEFAULT '',
    "cin7StatusCheckedAt" TIMESTAMP(3),
    "mondayStatusCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderOperationalData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLineItemOperationalData" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL DEFAULT '',
    "carrier" TEXT NOT NULL DEFAULT '',
    "customerStatus" TEXT NOT NULL DEFAULT '',
    "customerStatusUpdatedAt" TIMESTAMP(3),
    "paymentStatus" TEXT NOT NULL DEFAULT '',
    "warehouseStatus" TEXT NOT NULL DEFAULT '',
    "dispatchStatus" TEXT NOT NULL DEFAULT '',
    "deliveryStatus" TEXT NOT NULL DEFAULT '',
    "trackingNumber" TEXT NOT NULL DEFAULT '',
    "trackingNumberUpdatedAt" TIMESTAMP(3),
    "freightRef" TEXT NOT NULL DEFAULT '',
    "eddDate" TEXT NOT NULL DEFAULT '',
    "eddDateUpdatedAt" TIMESTAMP(3),
    "originalEddDate" TEXT NOT NULL DEFAULT '',
    "mondayItemId" TEXT NOT NULL DEFAULT '',
    "depositPaid" TEXT NOT NULL DEFAULT '',
    "balanceDue" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "notesPushedCount" INTEGER NOT NULL DEFAULT 0,
    "notesPushedMondayItemId" TEXT,
    "notesPulledUpdateIds" TEXT NOT NULL DEFAULT '',
    "supplierContainer" TEXT NOT NULL DEFAULT '',
    "portArrivalDate" TEXT NOT NULL DEFAULT '',
    "inTransitDate" TEXT NOT NULL DEFAULT '',
    "cin7SalesOrderId" TEXT NOT NULL DEFAULT '',
    "cin7CachedStatus" TEXT NOT NULL DEFAULT '',
    "cin7CachedMismatches" TEXT NOT NULL DEFAULT '',
    "mondayCachedStatus" TEXT NOT NULL DEFAULT '',
    "mondayCachedMismatches" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderLineItemOperationalData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalUser" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "inviteToken" TEXT,
    "inviteExpires" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_shop_key" ON "AppSetting"("shop");

-- CreateIndex
CREATE INDEX "ShippingRate_shop_active_company_serviceType_idx" ON "ShippingRate"("shop", "active", "company", "serviceType");

-- CreateIndex
CREATE INDEX "ShippingRate_shop_city_postalCode_idx" ON "ShippingRate"("shop", "city", "postalCode");

-- CreateIndex
CREATE UNIQUE INDEX "OrderOperationalData_shop_orderId_key" ON "OrderOperationalData"("shop", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLineItemOperationalData_shop_orderId_variantId_key" ON "OrderLineItemOperationalData"("shop", "orderId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalUser_inviteToken_key" ON "ExternalUser"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalUser_shop_email_key" ON "ExternalUser"("shop", "email");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalSession_token_key" ON "ExternalSession"("token");

-- AddForeignKey
ALTER TABLE "ExternalSession" ADD CONSTRAINT "ExternalSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ExternalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
