/*
  Warnings:

  - Added the required column `checksumSha256` to the `CourierDocument` table without a default value. This is not possible if the table is not empty.
  - Added the required column `contentType` to the `CourierDocument` table without a default value. This is not possible if the table is not empty.
  - Added the required column `originalFilename` to the `CourierDocument` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sizeBytes` to the `CourierDocument` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fullName` to the `CourierProfile` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CourierVerificationStatus" ADD VALUE 'INCOMPLETE';
ALTER TYPE "CourierVerificationStatus" ADD VALUE 'CHANGES_REQUESTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentStatus" ADD VALUE 'CHANGES_REQUESTED';
ALTER TYPE "DocumentStatus" ADD VALUE 'SUPERSEDED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'NATIONAL_ID_FRONT';
ALTER TYPE "DocumentType" ADD VALUE 'NATIONAL_ID_BACK';
ALTER TYPE "DocumentType" ADD VALUE 'DRIVER_LICENSE';

-- DropIndex
DROP INDEX "CourierDocument_courierId_status_idx";

-- DropIndex
DROP INDEX "CourierDocument_expiresAt_idx";

-- DropIndex
DROP INDEX "MerchantMembership_userId_idx";

-- AlterTable
ALTER TABLE "CourierDocument" ADD COLUMN     "checksumSha256" CHAR(64),
ADD COLUMN     "contentType" VARCHAR(120),
ADD COLUMN     "documentNumber" VARCHAR(100),
ADD COLUMN     "isCurrent" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "issuedAt" DATE,
ADD COLUMN     "originalFilename" VARCHAR(255),
ADD COLUMN     "reviewVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "sizeBytes" INTEGER,
ADD COLUMN     "supersedesId" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "CourierDocument"
SET
  "checksumSha256" = repeat('0', 64),
  "contentType" = 'application/octet-stream',
  "originalFilename" = 'legacy-document',
  "sizeBytes" = 0;

ALTER TABLE "CourierDocument"
ALTER COLUMN "checksumSha256" SET NOT NULL,
ALTER COLUMN "contentType" SET NOT NULL,
ALTER COLUMN "originalFilename" SET NOT NULL,
ALTER COLUMN "sizeBytes" SET NOT NULL;

-- AlterTable
ALTER TABLE "CourierProfile" ADD COLUMN     "emergencyContactName" VARCHAR(160),
ADD COLUMN     "emergencyContactPhone" VARCHAR(20),
ADD COLUMN     "fullName" VARCHAR(160),
ADD COLUMN     "rejectedAt" TIMESTAMPTZ(3),
ADD COLUMN     "statusReason" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMPTZ(3),
ADD COLUMN     "suspendedAt" TIMESTAMPTZ(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "verificationStatus" SET DEFAULT 'INCOMPLETE';

UPDATE "CourierProfile" AS courier
SET "fullName" = COALESCE(
  NULLIF(TRIM(app_user."displayName"), ''),
  'Courier'
)
FROM "User" AS app_user
WHERE app_user."id" = courier."userId";

ALTER TABLE "CourierProfile"
ALTER COLUMN "fullName" SET NOT NULL;

-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "MerchantMembership" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "deactivatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "invitedById" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "CourierVerificationEvent" (
    "id" BIGSERIAL NOT NULL,
    "courierId" UUID NOT NULL,
    "actorId" UUID,
    "action" VARCHAR(100) NOT NULL,
    "fromStatus" "CourierVerificationStatus",
    "toStatus" "CourierVerificationStatus",
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierVerificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" CHAR(64) NOT NULL,
    "previousRefreshTokenHash" CHAR(64),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedReason" VARCHAR(160),
    "lastUsedAt" TIMESTAMPTZ(3),
    "ipAddress" INET,
    "userAgent" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourierVerificationEvent_courierId_createdAt_idx" ON "CourierVerificationEvent"("courierId", "createdAt");

-- CreateIndex
CREATE INDEX "CourierVerificationEvent_actorId_createdAt_idx" ON "CourierVerificationEvent"("actorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Session_previousRefreshTokenHash_key" ON "Session"("previousRefreshTokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_expiresAt_idx" ON "Session"("userId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "CourierDocument_courierId_isCurrent_status_idx" ON "CourierDocument"("courierId", "isCurrent", "status");

-- CreateIndex
CREATE INDEX "CourierDocument_status_createdAt_idx" ON "CourierDocument"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CourierDocument_expiresAt_isCurrent_idx" ON "CourierDocument"("expiresAt", "isCurrent");

-- Only one current version of a document type may exist for a courier.
CREATE UNIQUE INDEX "CourierDocument_current_type_unique"
ON "CourierDocument"("courierId", "type")
WHERE "isCurrent" = true;

-- CreateIndex
CREATE INDEX "MerchantMembership_userId_active_idx" ON "MerchantMembership"("userId", "active");

-- CreateIndex
CREATE INDEX "MerchantMembership_merchantId_role_active_idx" ON "MerchantMembership"("merchantId", "role", "active");

-- AddForeignKey
ALTER TABLE "CourierDocument" ADD CONSTRAINT "CourierDocument_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierDocument" ADD CONSTRAINT "CourierDocument_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "CourierDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierVerificationEvent" ADD CONSTRAINT "CourierVerificationEvent_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "CourierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierVerificationEvent" ADD CONSTRAINT "CourierVerificationEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Verification history is an append-only security record, like the Phase 0 audit log.
CREATE TRIGGER "CourierVerificationEvent_immutable"
BEFORE UPDATE OR DELETE ON "CourierVerificationEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_mutation();
