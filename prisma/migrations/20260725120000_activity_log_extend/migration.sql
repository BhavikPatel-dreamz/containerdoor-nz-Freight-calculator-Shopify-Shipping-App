-- Extend CommunicationLog into central Activity Log (additive, backward compatible)
ALTER TABLE "CommunicationLog" ADD COLUMN IF NOT EXISTS "variantId" TEXT;
ALTER TABLE "CommunicationLog" ADD COLUMN IF NOT EXISTS "opsRecordId" TEXT;
ALTER TABLE "CommunicationLog" ADD COLUMN IF NOT EXISTS "activityType" TEXT NOT NULL DEFAULT 'email';
ALTER TABLE "CommunicationLog" ADD COLUMN IF NOT EXISTS "syncTargets" JSONB;
ALTER TABLE "CommunicationLog" ADD COLUMN IF NOT EXISTS "syncResults" JSONB;
ALTER TABLE "CommunicationLog" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- Relax email-centric columns for non-email activities
ALTER TABLE "CommunicationLog" ALTER COLUMN "subject" SET DEFAULT '';
ALTER TABLE "CommunicationLog" ALTER COLUMN "body" SET DEFAULT '';
ALTER TABLE "CommunicationLog" ALTER COLUMN "recipientEmail" SET DEFAULT '';
ALTER TABLE "CommunicationLog" ALTER COLUMN "recipientName" SET DEFAULT '';

UPDATE "CommunicationLog" SET "activityType" = 'email' WHERE "activityType" IS NULL OR "activityType" = '';
UPDATE "CommunicationLog" SET "subject" = COALESCE("subject", '');
UPDATE "CommunicationLog" SET "body" = COALESCE("body", '');
UPDATE "CommunicationLog" SET "recipientEmail" = COALESCE("recipientEmail", '');
UPDATE "CommunicationLog" SET "recipientName" = COALESCE("recipientName", '');

CREATE INDEX IF NOT EXISTS "CommunicationLog_shop_orderId_variantId_idx"
  ON "CommunicationLog"("shop", "orderId", "variantId");
CREATE INDEX IF NOT EXISTS "CommunicationLog_shop_orderId_variantId_sentAt_idx"
  ON "CommunicationLog"("shop", "orderId", "variantId", "sentAt");
CREATE INDEX IF NOT EXISTS "CommunicationLog_shop_activityType_sentAt_idx"
  ON "CommunicationLog"("shop", "activityType", "sentAt");
