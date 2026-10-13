-- Bulk email queue, communication logs, and bulk action audit trail.

DO $$
BEGIN
  CREATE TYPE "BulkEmailJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "BulkEmailRecipientStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "BulkEmailRecipientStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

DO $$
BEGIN
  CREATE TYPE "BulkActionAuditStatus" AS ENUM ('SUCCESS', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "BulkEmailJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "filters" JSONB,
    "sentBy" TEXT,
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "status" "BulkEmailJobStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "provider" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkEmailJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BulkEmailRecipient" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "orderData" JSONB,
    "status" "BulkEmailRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BulkEmailRecipient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CommunicationLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "jobId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "sentBy" TEXT NOT NULL,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'sent',
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BulkActionAudit" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "user" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" "BulkActionAuditStatus" NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "changedFields" JSONB NOT NULL,
    "oldValues" JSONB,
    "newValues" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BulkActionAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BulkEmailJob_shop_status_createdAt_idx" ON "BulkEmailJob"("shop", "status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "BulkEmailJob_status_createdAt_idx" ON "BulkEmailJob"("status", "createdAt" ASC);
CREATE INDEX IF NOT EXISTS "BulkEmailRecipient_jobId_status_idx" ON "BulkEmailRecipient"("jobId", "status");
CREATE INDEX IF NOT EXISTS "CommunicationLog_shop_orderId_idx" ON "CommunicationLog"("shop", "orderId");
CREATE INDEX IF NOT EXISTS "CommunicationLog_jobId_idx" ON "CommunicationLog"("jobId");
CREATE INDEX IF NOT EXISTS "BulkActionAudit_shop_orderId_idx" ON "BulkActionAudit"("shop", "orderId");
CREATE INDEX IF NOT EXISTS "BulkActionAudit_shop_createdAt_idx" ON "BulkActionAudit"("shop", "createdAt");
