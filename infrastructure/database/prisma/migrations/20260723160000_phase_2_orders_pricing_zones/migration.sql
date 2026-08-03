-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AddressSource" AS ENUM ('MANUAL', 'SAVED', 'STORE');

-- CreateEnum
CREATE TYPE "AddressValidationStatus" AS ENUM ('UNVERIFIED', 'VALIDATED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ServiceZoneStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PricingRuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'EXPIRED', 'CONSUMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderEventType" AS ENUM ('ORDER_DRAFT_CREATED', 'QUOTE_CREATED', 'QUOTE_RECALCULATED', 'QUOTE_EXPIRED', 'ORDER_CONFIRMED', 'COURIER_SEARCH_REQUESTED', 'ORDER_CANCELLED', 'ORDER_NOTE_UPDATED');

-- CreateEnum
CREATE TYPE "OrderEventSource" AS ENUM ('MERCHANT_WEB', 'ADMIN_WEB', 'SYSTEM', 'API');

-- CreateEnum
CREATE TYPE "OrderActorType" AS ENUM ('USER', 'SYSTEM');

-- DropForeignKey
ALTER TABLE "Address" DROP CONSTRAINT "Address_customerId_fkey";

-- DropForeignKey
ALTER TABLE "PriceQuote" DROP CONSTRAINT "PriceQuote_orderId_fkey";

-- DropIndex
DROP INDEX "Address_merchantId_customerId_idx";

-- DropIndex
DROP INDEX "Customer_merchantId_phone_key";

-- DropIndex
DROP INDEX "DeliveryOrder_reference_key";

-- DropIndex
DROP INDEX "PriceQuote_expiresAt_idx";

-- DropIndex
DROP INDEX "PriceQuote_orderId_idx";

-- DropIndex
DROP INDEX "PricingRule_city_area_active_effectiveFrom_idx";

-- DropIndex
DROP INDEX "PricingRule_city_area_version_key";

-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "apartment" VARCHAR(40),
ADD COLUMN     "archivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "buildingNumber" VARCHAR(40),
ADD COLUMN     "contactName" VARCHAR(160),
ADD COLUMN     "contactPhone" VARCHAR(20),
ADD COLUMN     "floor" VARCHAR(40),
ADD COLUMN     "governorate" VARCHAR(120),
ADD COLUMN     "landmark" VARCHAR(240),
ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "longitude" DECIMAL(9,6),
ADD COLUMN     "source" "AddressSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "validationStatus" "AddressValidationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "Address" AS address
SET
  "contactName" = COALESCE(customer."name", 'Recipient'),
  "contactPhone" = COALESCE(customer."phone", '+201000000000'),
  "governorate" = address."city",
  "latitude" = COALESCE(ST_Y(address."location"::geometry), 0),
  "longitude" = COALESCE(ST_X(address."location"::geometry), 0)
FROM "Customer" AS customer
WHERE customer."id" = address."customerId";

UPDATE "Address"
SET
  "contactName" = COALESCE("contactName", 'Recipient'),
  "contactPhone" = COALESCE("contactPhone", '+201000000000'),
  "governorate" = COALESCE("governorate", "city"),
  "latitude" = COALESCE("latitude", ST_Y("location"::geometry), 0),
  "longitude" = COALESCE("longitude", ST_X("location"::geometry), 0);

ALTER TABLE "Address"
ALTER COLUMN "contactName" SET NOT NULL,
ALTER COLUMN "contactPhone" SET NOT NULL,
ALTER COLUMN "governorate" SET NOT NULL,
ALTER COLUMN "latitude" SET NOT NULL,
ALTER COLUMN "longitude" SET NOT NULL;

-- AlterTable
ALTER TABLE "Customer" RENAME COLUMN "phone" TO "normalizedPhone";

ALTER TABLE "Customer" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "email" VARCHAR(320),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- Phase 1 never activated the pre-modeled order tables. Refuse to discard any
-- unexpected pre-Phase-2 operational data instead of silently coercing it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "DeliveryOrder")
    OR EXISTS (SELECT 1 FROM "PriceQuote")
    OR EXISTS (SELECT 1 FROM "OrderEvent") THEN
    RAISE EXCEPTION
      'Phase 2 migration requires the previously inactive order, quote, and event tables to be empty';
  END IF;
END;
$$;

-- AlterTable
ALTER TABLE "DeliveryOrder" RENAME COLUMN "reference" TO "orderNumber";

ALTER TABLE "DeliveryOrder" DROP COLUMN "acceptedAt",
DROP COLUMN "cancellationReason",
DROP COLUMN "courierEarning",
DROP COLUMN "deliveredAt",
DROP COLUMN "deliveryFee",
DROP COLUMN "goodsAmount",
DROP COLUMN "notes",
DROP COLUMN "pickedUpAt",
DROP COLUMN "platformCommission",
DROP COLUMN "scheduledFor",
DROP COLUMN "weightKg",
ADD COLUMN     "baseFeeMinor" INTEGER NOT NULL,
ADD COLUMN     "cancellationDetails" TEXT,
ADD COLUMN     "cancellationReasonCode" VARCHAR(80),
ADD COLUMN     "cancelledByRole" "UserRole",
ADD COLUMN     "courierNotes" TEXT,
ADD COLUMN     "createdById" UUID NOT NULL,
ADD COLUMN     "customerOrderReference" VARCHAR(100),
ADD COLUMN     "customerSnapshot" JSONB NOT NULL,
ADD COLUMN     "declaredValueMinor" INTEGER NOT NULL,
ADD COLUMN     "discountMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "distanceChargeMinor" INTEGER NOT NULL,
ADD COLUMN     "dropoffAddressSnapshot" JSONB NOT NULL,
ADD COLUMN     "estimatedCourierEarningMinor" INTEGER NOT NULL,
ADD COLUMN     "estimatedDurationSeconds" INTEGER NOT NULL,
ADD COLUMN     "fragileSurchargeMinor" INTEGER NOT NULL,
ADD COLUMN     "itemDescription" VARCHAR(240) NOT NULL,
ADD COLUMN     "merchantReference" VARCHAR(100),
ADD COLUMN     "merchantTotalMinor" INTEGER NOT NULL,
ADD COLUMN     "packageCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "packageSnapshot" JSONB NOT NULL,
ADD COLUMN     "packageSurchargeMinor" INTEGER NOT NULL,
ADD COLUMN     "pickupAddressSnapshot" JSONB NOT NULL,
ADD COLUMN     "platformCommissionMinor" INTEGER NOT NULL,
ADD COLUMN     "pricingRuleId" UUID NOT NULL,
ADD COLUMN     "pricingSnapshot" JSONB NOT NULL,
ADD COLUMN     "prohibitedItemsConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "quoteId" UUID NOT NULL,
ADD COLUMN     "recipientNotes" TEXT,
ADD COLUMN     "requiresThermalBag" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "routeDistanceMeters" INTEGER NOT NULL,
ADD COLUMN     "routeSnapshot" JSONB NOT NULL,
ADD COLUMN     "serviceZoneId" UUID NOT NULL,
ADD COLUMN     "surgeAdjustmentMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "thermalBagSurchargeMinor" INTEGER NOT NULL,
ADD COLUMN     "weightGrams" INTEGER NOT NULL,
ADD COLUMN     "weightSurchargeMinor" INTEGER NOT NULL,
ALTER COLUMN "pricingVersion" SET NOT NULL;

-- AlterTable
ALTER TABLE "OrderEvent" DROP COLUMN "notes",
ADD COLUMN     "actorType" "OrderActorType" NOT NULL DEFAULT 'USER',
ADD COLUMN     "correlationId" VARCHAR(100),
ADD COLUMN     "eventType" "OrderEventType" NOT NULL,
ADD COLUMN     "internalMessage" TEXT,
ADD COLUMN     "merchantMessage" TEXT,
ADD COLUMN     "reasonCode" VARCHAR(80),
ADD COLUMN     "source" "OrderEventSource" NOT NULL;

-- AlterTable
ALTER TABLE "PriceQuote" DROP COLUMN "amount",
DROP COLUMN "commission",
DROP COLUMN "orderId",
ADD COLUMN     "baseFeeMinor" INTEGER NOT NULL,
ADD COLUMN     "consumedAt" TIMESTAMPTZ(3),
ADD COLUMN     "createdById" UUID NOT NULL,
ADD COLUMN     "customerId" UUID,
ADD COLUMN     "customerSnapshot" JSONB NOT NULL,
ADD COLUMN     "discountMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "distanceChargeMinor" INTEGER NOT NULL,
ADD COLUMN     "dropoffAddressSnapshot" JSONB NOT NULL,
ADD COLUMN     "estimatedCourierEarningMinor" INTEGER NOT NULL,
ADD COLUMN     "fragileSurchargeMinor" INTEGER NOT NULL,
ADD COLUMN     "idempotencyKey" VARCHAR(128) NOT NULL,
ADD COLUMN     "merchantId" UUID NOT NULL,
ADD COLUMN     "merchantTotalMinor" INTEGER NOT NULL,
ADD COLUMN     "packageSnapshot" JSONB NOT NULL,
ADD COLUMN     "packageSurchargeMinor" INTEGER NOT NULL,
ADD COLUMN     "pickupAddressSnapshot" JSONB NOT NULL,
ADD COLUMN     "platformCommissionMinor" INTEGER NOT NULL,
ADD COLUMN     "pricingRuleVersion" INTEGER NOT NULL,
ADD COLUMN     "requestFingerprint" CHAR(64) NOT NULL,
ADD COLUMN     "routeSnapshot" JSONB NOT NULL,
ADD COLUMN     "serviceZoneId" UUID NOT NULL,
ADD COLUMN     "status" "QuoteStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "storeId" UUID NOT NULL,
ADD COLUMN     "supersedesId" UUID,
ADD COLUMN     "surgeAdjustmentMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "thermalBagSurchargeMinor" INTEGER NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "weightSurchargeMinor" INTEGER NOT NULL,
ALTER COLUMN "durationSeconds" SET NOT NULL;

-- AlterTable
ALTER TABLE "PricingRule"
ADD COLUMN     "baseFeeMinor" INTEGER,
ADD COLUMN     "commissionType" "CommissionType" NOT NULL DEFAULT 'PERCENTAGE',
ADD COLUMN     "commissionValue" INTEGER,
ADD COLUMN     "countryCode" CHAR(2) NOT NULL DEFAULT 'EG',
ADD COLUMN     "fragileSurchargeMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "governorate" VARCHAR(120),
ADD COLUMN     "includedDistanceMeters" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "largePackageSurchargeMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "maximumDistanceMeters" INTEGER,
ADD COLUMN     "mediumPackageSurchargeMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "minimumFeeMinor" INTEGER,
ADD COLUMN     "perKilometerMinor" INTEGER,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "returnTripBaseMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ruleFamilyKey" VARCHAR(100),
ADD COLUMN     "serviceZoneId" UUID,
ADD COLUMN     "smallPackageSurchargeMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "PricingRuleStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "taxBasisPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "thermalBagSurchargeMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vehicleType" "VehicleType" NOT NULL DEFAULT 'MOTORCYCLE',
ADD COLUMN     "waitingFeePerMinuteMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "weightBands" JSONB;

UPDATE "PricingRule"
SET
  "ruleFamilyKey" = 'legacy-' || "id"::text,
  "governorate" = "city",
  "baseFeeMinor" = ROUND("baseFee" * 100)::integer,
  "perKilometerMinor" = ROUND("perKmFee" * 100)::integer,
  "minimumFeeMinor" = ROUND("minimumFee" * 100)::integer,
  "maximumDistanceMeters" = 25000,
  "smallPackageSurchargeMinor" = ROUND("smallPackageFee" * 100)::integer,
  "mediumPackageSurchargeMinor" = ROUND("mediumPackageFee" * 100)::integer,
  "largePackageSurchargeMinor" = ROUND("largePackageFee" * 100)::integer,
  "waitingFeePerMinuteMinor" = ROUND("waitingFeePerMinute" * 100)::integer,
  "commissionValue" = ROUND("commissionRate" * 10000)::integer,
  "weightBands" = '[{"upToGrams":5000,"surchargeMinor":0},{"upToGrams":15000,"surchargeMinor":500}]'::jsonb,
  "status" = CASE WHEN "active" THEN 'ACTIVE'::"PricingRuleStatus" ELSE 'INACTIVE'::"PricingRuleStatus" END;

ALTER TABLE "PricingRule"
ALTER COLUMN "baseFeeMinor" SET NOT NULL,
ALTER COLUMN "commissionValue" SET NOT NULL,
ALTER COLUMN "governorate" SET NOT NULL,
ALTER COLUMN "maximumDistanceMeters" SET NOT NULL,
ALTER COLUMN "minimumFeeMinor" SET NOT NULL,
ALTER COLUMN "perKilometerMinor" SET NOT NULL,
ALTER COLUMN "ruleFamilyKey" SET NOT NULL,
ALTER COLUMN "weightBands" SET NOT NULL,
DROP COLUMN "active",
DROP COLUMN "area",
DROP COLUMN "baseFee",
DROP COLUMN "commissionRate",
DROP COLUMN "largePackageFee",
DROP COLUMN "mediumPackageFee",
DROP COLUMN "minimumFee",
DROP COLUMN "perKmFee",
DROP COLUMN "smallPackageFee",
DROP COLUMN "waitingFeePerMinute";

-- CreateTable
CREATE TABLE "ServiceZone" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "countryCode" CHAR(2) NOT NULL DEFAULT 'EG',
    "governorate" VARCHAR(120) NOT NULL,
    "city" VARCHAR(120) NOT NULL,
    "boundary" geography(MultiPolygon, 4326) NOT NULL,
    "status" "ServiceZoneStatus" NOT NULL DEFAULT 'INACTIVE',
    "allowedPickup" BOOLEAN NOT NULL DEFAULT true,
    "allowedDropoff" BOOLEAN NOT NULL DEFAULT true,
    "maximumRouteDistanceMeters" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ServiceZone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceZone_city_status_priority_idx" ON "ServiceZone"("city", "status", "priority");

-- CreateIndex
CREATE INDEX "ServiceZone_governorate_status_idx" ON "ServiceZone"("governorate", "status");

-- CreateIndex
CREATE INDEX "Address_merchantId_customerId_archivedAt_idx" ON "Address"("merchantId", "customerId", "archivedAt");

-- CreateIndex
CREATE INDEX "Customer_merchantId_status_createdAt_idx" ON "Customer"("merchantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Customer_merchantId_name_idx" ON "Customer"("merchantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_merchantId_normalizedPhone_key" ON "Customer"("merchantId", "normalizedPhone");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryOrder_orderNumber_key" ON "DeliveryOrder"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryOrder_quoteId_key" ON "DeliveryOrder"("quoteId");

-- CreateIndex
CREATE INDEX "DeliveryOrder_merchantId_status_createdAt_idx" ON "DeliveryOrder"("merchantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryOrder_serviceZoneId_status_createdAt_idx" ON "DeliveryOrder"("serviceZoneId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryOrder_cancelledAt_cancellationReasonCode_idx" ON "DeliveryOrder"("cancelledAt", "cancellationReasonCode");

-- CreateIndex
CREATE INDEX "OrderEvent_eventType_createdAt_idx" ON "OrderEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "PriceQuote_merchantId_status_createdAt_idx" ON "PriceQuote"("merchantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PriceQuote_expiresAt_status_idx" ON "PriceQuote"("expiresAt", "status");

-- CreateIndex
CREATE INDEX "PriceQuote_serviceZoneId_status_idx" ON "PriceQuote"("serviceZoneId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PriceQuote_merchantId_idempotencyKey_key" ON "PriceQuote"("merchantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "PricingRule_countryCode_governorate_city_status_priority_ef_idx" ON "PricingRule"("countryCode", "governorate", "city", "status", "priority", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PricingRule_serviceZoneId_vehicleType_status_priority_effec_idx" ON "PricingRule"("serviceZoneId", "vehicleType", "status", "priority", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRule_ruleFamilyKey_version_key" ON "PricingRule"("ruleFamilyKey", "version");

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "PriceQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_serviceZoneId_fkey" FOREIGN KEY ("serviceZoneId") REFERENCES "ServiceZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_pricingRuleId_fkey" FOREIGN KEY ("pricingRuleId") REFERENCES "PricingRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_serviceZoneId_fkey" FOREIGN KEY ("serviceZoneId") REFERENCES "ServiceZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_serviceZoneId_fkey" FOREIGN KEY ("serviceZoneId") REFERENCES "ServiceZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "PriceQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 2 domain constraints that Prisma Schema Language cannot express.
ALTER TABLE "Address"
  ADD CONSTRAINT "Address_coordinate_range_check"
  CHECK (
    "latitude" BETWEEN -90 AND 90
    AND "longitude" BETWEEN -180 AND 180
  ),
  ADD CONSTRAINT "Address_point_matches_coordinates_check"
  CHECK (
    "location" IS NULL
    OR ST_DWithin(
      "location",
      ST_SetSRID(ST_MakePoint("longitude"::double precision, "latitude"::double precision), 4326)::geography,
      1
    )
  );

ALTER TABLE "ServiceZone"
  ADD CONSTRAINT "ServiceZone_distance_positive_check"
  CHECK ("maximumRouteDistanceMeters" > 0),
  ADD CONSTRAINT "ServiceZone_boundary_valid_check"
  CHECK (ST_IsValid("boundary"::geometry));

ALTER TABLE "PricingRule"
  ADD CONSTRAINT "PricingRule_minor_amounts_check"
  CHECK (
    "baseFeeMinor" >= 0
    AND "includedDistanceMeters" >= 0
    AND "perKilometerMinor" >= 0
    AND "minimumFeeMinor" >= 0
    AND "maximumDistanceMeters" > 0
    AND "smallPackageSurchargeMinor" >= 0
    AND "mediumPackageSurchargeMinor" >= 0
    AND "largePackageSurchargeMinor" >= 0
    AND "fragileSurchargeMinor" >= 0
    AND "thermalBagSurchargeMinor" >= 0
    AND "waitingFeePerMinuteMinor" >= 0
    AND "returnTripBaseMinor" >= 0
    AND "taxBasisPoints" BETWEEN 0 AND 10000
  ),
  ADD CONSTRAINT "PricingRule_commission_check"
  CHECK (
    ("commissionType" = 'PERCENTAGE' AND "commissionValue" BETWEEN 0 AND 10000)
    OR ("commissionType" = 'FIXED' AND "commissionValue" >= 0)
  ),
  ADD CONSTRAINT "PricingRule_effective_range_check"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

ALTER TABLE "PriceQuote"
  ADD CONSTRAINT "PriceQuote_phase2_financial_check"
  CHECK (
    "distanceMeters" >= 0
    AND "durationSeconds" >= 0
    AND "baseFeeMinor" >= 0
    AND "distanceChargeMinor" >= 0
    AND "packageSurchargeMinor" >= 0
    AND "weightSurchargeMinor" >= 0
    AND "fragileSurchargeMinor" >= 0
    AND "thermalBagSurchargeMinor" >= 0
    AND "discountMinor" >= 0
    AND "surgeAdjustmentMinor" = 0
    AND "taxMinor" >= 0
    AND "merchantTotalMinor" =
      "baseFeeMinor" + "distanceChargeMinor" + "packageSurchargeMinor"
      + "weightSurchargeMinor" + "fragileSurchargeMinor"
      + "thermalBagSurchargeMinor" - "discountMinor"
      + "surgeAdjustmentMinor" + "taxMinor"
    AND "platformCommissionMinor" BETWEEN 0 AND "merchantTotalMinor"
    AND "estimatedCourierEarningMinor" =
      "merchantTotalMinor" - "platformCommissionMinor"
    AND "currency" = 'EGP'
  );

ALTER TABLE "DeliveryOrder"
  ADD CONSTRAINT "DeliveryOrder_phase2_financial_check"
  CHECK (
    "routeDistanceMeters" >= 0
    AND "estimatedDurationSeconds" >= 0
    AND "weightGrams" > 0
    AND "packageCount" > 0
    AND "declaredValueMinor" >= 0
    AND "baseFeeMinor" >= 0
    AND "distanceChargeMinor" >= 0
    AND "packageSurchargeMinor" >= 0
    AND "weightSurchargeMinor" >= 0
    AND "fragileSurchargeMinor" >= 0
    AND "thermalBagSurchargeMinor" >= 0
    AND "discountMinor" >= 0
    AND "surgeAdjustmentMinor" = 0
    AND "taxMinor" >= 0
    AND "merchantTotalMinor" =
      "baseFeeMinor" + "distanceChargeMinor" + "packageSurchargeMinor"
      + "weightSurchargeMinor" + "fragileSurchargeMinor"
      + "thermalBagSurchargeMinor" - "discountMinor"
      + "surgeAdjustmentMinor" + "taxMinor"
    AND "platformCommissionMinor" BETWEEN 0 AND "merchantTotalMinor"
    AND "estimatedCourierEarningMinor" =
      "merchantTotalMinor" - "platformCommissionMinor"
    AND "currency" = 'EGP'
  ),
  ADD CONSTRAINT "DeliveryOrder_phase2_scope_check"
  CHECK (
    "status" IN ('DRAFT', 'QUOTED', 'SEARCHING_COURIER', 'CANCELLED')
    AND "paymentMode" = 'DELIVERY_ONLY'
    AND "courierId" IS NULL
    AND "prohibitedItemsConfirmed" = true
  );

-- Preserve all existing Phase 0 spatial indexes and add Phase 2 geometry indexes.
CREATE INDEX "ServiceZone_boundary_gist"
  ON "ServiceZone" USING GIST ("boundary");

-- Quotes and order snapshots are historical evidence. Lifecycle markers may
-- change, but the quoted route and all monetary/address/package fields may not.
CREATE OR REPLACE FUNCTION prevent_phase2_snapshot_mutation()
RETURNS trigger AS $$
DECLARE
  allowed_columns text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% records are immutable', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  allowed_columns := CASE TG_TABLE_NAME
    WHEN 'PriceQuote' THEN ARRAY['status', 'consumedAt', 'version']
    WHEN 'DeliveryOrder' THEN ARRAY[
      'status', 'cancelledAt', 'cancellationReasonCode',
      'cancellationDetails', 'cancelledByRole', 'version', 'updatedAt'
    ]
    WHEN 'PricingRule' THEN ARRAY['status', 'updatedAt']
    ELSE ARRAY[]::text[]
  END;

  IF (to_jsonb(NEW) - allowed_columns) IS DISTINCT FROM
     (to_jsonb(OLD) - allowed_columns) THEN
    RAISE EXCEPTION '% historical fields are immutable', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PriceQuote_snapshot_immutable"
  BEFORE UPDATE OR DELETE ON "PriceQuote"
  FOR EACH ROW EXECUTE FUNCTION prevent_phase2_snapshot_mutation();

CREATE TRIGGER "DeliveryOrder_snapshot_immutable"
  BEFORE UPDATE OR DELETE ON "DeliveryOrder"
  FOR EACH ROW EXECUTE FUNCTION prevent_phase2_snapshot_mutation();

CREATE TRIGGER "PricingRule_version_immutable"
  BEFORE UPDATE OR DELETE ON "PricingRule"
  FOR EACH ROW EXECUTE FUNCTION prevent_phase2_snapshot_mutation();
