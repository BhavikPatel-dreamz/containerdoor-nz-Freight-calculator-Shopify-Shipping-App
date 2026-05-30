-- Step 1: Add new enum values before dropping the old one
ALTER TYPE "CarrierCompany" ADD VALUE IF NOT EXISTS 'FLIWAYLINEHAUL';
ALTER TYPE "CarrierCompany" ADD VALUE IF NOT EXISTS 'FLIWAYMIDSIZE';
ALTER TYPE "CarrierCompany" ADD VALUE IF NOT EXISTS 'MAINFREIGHT';

-- Step 2: Migrate existing FLIWAY rows to FLIWAYLINEHAUL
UPDATE "ShippingRate" SET company = 'FLIWAYLINEHAUL' WHERE company = 'FLIWAY';

-- Step 3: Add missing columns to ShippingRate if not present
ALTER TABLE "ShippingRate"
  ADD COLUMN IF NOT EXISTS "signatureSurcharge"     DECIMAL(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "ruralSurcharge"         DECIMAL(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "ageRestrictedSurcharge" DECIMAL(10,4) NOT NULL DEFAULT 0;

-- Step 4: Add missing columns to AppSetting if not present
ALTER TABLE "AppSetting"
  ADD COLUMN IF NOT EXISTS "tgeAdminFee"    DECIMAL(10,2) NOT NULL DEFAULT 12.69,
  ADD COLUMN IF NOT EXISTS "fafFliway"      DECIMAL(10,2) NOT NULL DEFAULT 30.5,
  ADD COLUMN IF NOT EXISTS "fafMainfreight" DECIMAL(10,2) NOT NULL DEFAULT 36.35,
  ADD COLUMN IF NOT EXISTS "fafTge"         DECIMAL(10,2) NOT NULL DEFAULT 29.8,
  ADD COLUMN IF NOT EXISTS "fafM2h"         DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Note: PostgreSQL does not support removing enum values directly.
-- The old 'FLIWAY' value is now unused. It will remain in the enum type
-- but no rows reference it. A full enum replacement requires a table rewrite
-- and is deferred to avoid downtime risk.
