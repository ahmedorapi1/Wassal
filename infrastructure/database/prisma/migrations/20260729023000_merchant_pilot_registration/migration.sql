ALTER TYPE "MerchantStatus" ADD VALUE IF NOT EXISTS 'CHANGES_REQUESTED';

ALTER TABLE "Merchant"
  ADD COLUMN "businessCategory" VARCHAR(120),
  ADD COLUMN "contactPhone" VARCHAR(20),
  ADD COLUMN "contactEmail" VARCHAR(320),
  ADD COLUMN "reviewNotes" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMPTZ(3);

ALTER TABLE "Store"
  ADD COLUMN "governorate" VARCHAR(120),
  ADD COLUMN "street" VARCHAR(240),
  ADD COLUMN "addressDetails" VARCHAR(500);
