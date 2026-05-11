-- Add Mainfreight as a supported carrier.
ALTER TYPE "CarrierCompany" ADD VALUE IF NOT EXISTS 'MAINFREIGHT';

-- Store rural/zone surcharge values from the freight cards.
ALTER TABLE "ShippingRate"
ADD COLUMN IF NOT EXISTS "zoneSurcharge" DECIMAL(10,2) NOT NULL DEFAULT 0;
