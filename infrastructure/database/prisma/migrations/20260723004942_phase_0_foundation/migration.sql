-- Spatial support is part of the migration so shadow and production databases
-- receive the same capabilities.
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'MANAGER', 'STAFF', 'COURIER', 'SUPPORT', 'OPERATIONS_ADMIN', 'FINANCE_ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "UserLocale" AS ENUM ('AR_EG', 'EN');

-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('PER_ORDER', 'MONTHLY_INVOICE');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CourierVerificationStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CourierAvailability" AS ENUM ('OFFLINE', 'ONLINE', 'ON_DELIVERY');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('MOTORCYCLE', 'BICYCLE', 'CAR', 'VAN');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('NATIONAL_ID', 'DRIVING_LICENSE', 'VEHICLE_LICENSE', 'PROFILE_PHOTO');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'QUOTED', 'SEARCHING_COURIER', 'COURIER_ASSIGNED', 'COURIER_ARRIVING_PICKUP', 'AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'AT_DROPOFF', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNING_TO_STORE', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('DELIVERY_ONLY', 'CASH_ON_DELIVERY');

-- CreateEnum
CREATE TYPE "PackageSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE', 'EXTRA_LARGE');

-- CreateEnum
CREATE TYPE "DispatchOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ProofType" AS ENUM ('OTP', 'PHOTO', 'SIGNATURE', 'MUTUAL_CONFIRMATION');

-- CreateEnum
CREATE TYPE "WalletOwnerType" AS ENUM ('MERCHANT', 'COURIER', 'PLATFORM');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('DELIVERY_FEE', 'COURIER_EARNING', 'PLATFORM_COMMISSION', 'CASH_COLLECTED', 'SETTLEMENT', 'ADJUSTMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "SettlementOwnerType" AS ENUM ('MERCHANT', 'COURIER');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupportCaseType" AS ENUM ('DELIVERY_ISSUE', 'PAYMENT_ISSUE', 'DAMAGED_PACKAGE', 'LOST_PACKAGE', 'SAFETY', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportCaseStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "FeatureFlagScope" AS ENUM ('GLOBAL', 'CITY', 'MERCHANT', 'COURIER');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('SIGN_IN', 'VERIFY_PHONE', 'CONFIRM_DELIVERY');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(320),
    "displayName" VARCHAR(160),
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "locale" "UserLocale" NOT NULL DEFAULT 'AR_EG',
    "phoneVerifiedAt" TIMESTAMPTZ(3),
    "lastSignedInAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Merchant" (
    "id" UUID NOT NULL,
    "legalName" VARCHAR(200) NOT NULL,
    "displayName" VARCHAR(160) NOT NULL,
    "status" "MerchantStatus" NOT NULL DEFAULT 'PENDING',
    "billingMode" "BillingMode" NOT NULL DEFAULT 'PER_ORDER',
    "commissionRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantMembership" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MerchantMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(20),
    "addressLine" VARCHAR(500) NOT NULL,
    "area" VARCHAR(120) NOT NULL,
    "city" VARCHAR(120) NOT NULL,
    "location" geography(Point, 4326),
    "workingHours" JSONB,
    "status" "StoreStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "verificationStatus" "CourierVerificationStatus" NOT NULL DEFAULT 'DRAFT',
    "availability" "CourierAvailability" NOT NULL DEFAULT 'OFFLINE',
    "rating" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "completedOrdersCount" INTEGER NOT NULL DEFAULT 0,
    "cashLimit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "preferredCity" VARCHAR(120),
    "lastLocation" geography(Point, 4326),
    "lastLocationAt" TIMESTAMPTZ(3),
    "approvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CourierProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" UUID NOT NULL,
    "courierId" UUID NOT NULL,
    "type" "VehicleType" NOT NULL DEFAULT 'MOTORCYCLE',
    "plateNumber" VARCHAR(40) NOT NULL,
    "manufacturer" VARCHAR(100),
    "model" VARCHAR(100),
    "color" VARCHAR(60),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierDocument" (
    "id" UUID NOT NULL,
    "courierId" UUID NOT NULL,
    "vehicleId" UUID,
    "type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "storageKey" VARCHAR(500) NOT NULL,
    "expiresAt" DATE,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CourierDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "customerId" UUID,
    "label" VARCHAR(100),
    "addressLine" VARCHAR(500) NOT NULL,
    "area" VARCHAR(120) NOT NULL,
    "city" VARCHAR(120) NOT NULL,
    "instructions" TEXT,
    "location" geography(Point, 4326),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryOrder" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(32) NOT NULL,
    "merchantId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "customerId" UUID,
    "pickupAddressId" UUID NOT NULL,
    "dropoffAddressId" UUID NOT NULL,
    "courierId" UUID,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentMode" "PaymentMode" NOT NULL DEFAULT 'DELIVERY_ONLY',
    "packageCategory" VARCHAR(100) NOT NULL,
    "packageSize" "PackageSize" NOT NULL DEFAULT 'SMALL',
    "weightKg" DECIMAL(8,3),
    "fragile" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "goodsAmount" DECIMAL(12,2),
    "deliveryFee" DECIMAL(12,2),
    "platformCommission" DECIMAL(12,2),
    "courierEarning" DECIMAL(12,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "pricingVersion" INTEGER,
    "scheduledFor" TIMESTAMPTZ(3),
    "acceptedAt" TIMESTAMPTZ(3),
    "pickedUpAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancellationReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DeliveryOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "actorId" UUID,
    "actorRole" "UserRole",
    "location" geography(Point, 4326),
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchOffer" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "courierId" UUID NOT NULL,
    "status" "DispatchOfferStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "respondedAt" TIMESTAMPTZ(3),
    "distanceToPickupMeters" INTEGER,
    "expectedEarning" DECIMAL(12,2),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DispatchOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingPoint" (
    "id" BIGSERIAL NOT NULL,
    "courierId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "location" geography(Point, 4326),
    "accuracyM" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "speedMps" DOUBLE PRECISION,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofOfDelivery" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "type" "ProofType" NOT NULL,
    "otpHash" VARCHAR(255),
    "storageKey" VARCHAR(500),
    "recipientName" VARCHAR(160),
    "location" geography(Point, 4326),
    "capturedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofOfDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" UUID NOT NULL,
    "city" VARCHAR(120) NOT NULL,
    "area" VARCHAR(120) NOT NULL DEFAULT '*',
    "version" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "baseFee" DECIMAL(12,2) NOT NULL,
    "perKmFee" DECIMAL(12,2) NOT NULL,
    "minimumFee" DECIMAL(12,2) NOT NULL,
    "waitingFeePerMinute" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "smallPackageFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "mediumPackageFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "largePackageFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "commissionRate" DECIMAL(5,4) NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceQuote" (
    "id" UUID NOT NULL,
    "orderId" UUID,
    "pricingRuleId" UUID NOT NULL,
    "distanceMeters" INTEGER NOT NULL,
    "durationSeconds" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL,
    "commission" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "breakdown" JSONB NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" UUID NOT NULL,
    "ownerType" "WalletOwnerType" NOT NULL,
    "ownerId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "orderId" UUID,
    "type" "LedgerEntryType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "reference" VARCHAR(160),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" UUID NOT NULL,
    "ownerType" "SettlementOwnerType" NOT NULL,
    "ownerId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rating" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "tags" TEXT[],
    "comment" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportCase" (
    "id" UUID NOT NULL,
    "orderId" UUID,
    "type" "SupportCaseType" NOT NULL,
    "status" "SupportCaseStatus" NOT NULL DEFAULT 'OPEN',
    "openedById" UUID NOT NULL,
    "assignedToId" UUID,
    "description" TEXT NOT NULL,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SupportCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "actorId" UUID,
    "actorRole" "UserRole",
    "action" VARCHAR(160) NOT NULL,
    "entityType" VARCHAR(100) NOT NULL,
    "entityId" VARCHAR(160) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ipAddress" INET,
    "userAgent" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "scope" "FeatureFlagScope" NOT NULL DEFAULT 'GLOBAL',
    "scopeReference" VARCHAR(160),
    "rolloutPercent" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "phone" VARCHAR(20) NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" VARCHAR(255) NOT NULL,
    "provider" VARCHAR(60) NOT NULL,
    "providerRef" VARCHAR(160),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(100) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "requestHash" VARCHAR(128) NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'PROCESSING',
    "responseCode" INTEGER,
    "responseBody" JSONB,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");

-- CreateIndex
CREATE INDEX "Merchant_status_idx" ON "Merchant"("status");

-- CreateIndex
CREATE INDEX "MerchantMembership_userId_idx" ON "MerchantMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantMembership_merchantId_userId_key" ON "MerchantMembership"("merchantId", "userId");

-- CreateIndex
CREATE INDEX "Store_merchantId_status_idx" ON "Store"("merchantId", "status");

-- CreateIndex
CREATE INDEX "Store_city_area_idx" ON "Store"("city", "area");

-- CreateIndex
CREATE UNIQUE INDEX "CourierProfile_userId_key" ON "CourierProfile"("userId");

-- CreateIndex
CREATE INDEX "CourierProfile_verificationStatus_availability_idx" ON "CourierProfile"("verificationStatus", "availability");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_plateNumber_key" ON "Vehicle"("plateNumber");

-- CreateIndex
CREATE INDEX "Vehicle_courierId_active_idx" ON "Vehicle"("courierId", "active");

-- CreateIndex
CREATE INDEX "CourierDocument_courierId_status_idx" ON "CourierDocument"("courierId", "status");

-- CreateIndex
CREATE INDEX "CourierDocument_expiresAt_idx" ON "CourierDocument"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_merchantId_phone_key" ON "Customer"("merchantId", "phone");

-- CreateIndex
CREATE INDEX "Address_merchantId_customerId_idx" ON "Address"("merchantId", "customerId");

-- CreateIndex
CREATE INDEX "Address_city_area_idx" ON "Address"("city", "area");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryOrder_reference_key" ON "DeliveryOrder"("reference");

-- CreateIndex
CREATE INDEX "DeliveryOrder_merchantId_createdAt_idx" ON "DeliveryOrder"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryOrder_courierId_status_idx" ON "DeliveryOrder"("courierId", "status");

-- CreateIndex
CREATE INDEX "DeliveryOrder_status_createdAt_idx" ON "DeliveryOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "DispatchOffer_courierId_status_expiresAt_idx" ON "DispatchOffer"("courierId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchOffer_orderId_courierId_key" ON "DispatchOffer"("orderId", "courierId");

-- CreateIndex
CREATE INDEX "TrackingPoint_orderId_capturedAt_idx" ON "TrackingPoint"("orderId", "capturedAt");

-- CreateIndex
CREATE INDEX "TrackingPoint_courierId_capturedAt_idx" ON "TrackingPoint"("courierId", "capturedAt");

-- CreateIndex
CREATE INDEX "ProofOfDelivery_orderId_createdAt_idx" ON "ProofOfDelivery"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "PricingRule_city_area_active_effectiveFrom_idx" ON "PricingRule"("city", "area", "active", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRule_city_area_version_key" ON "PricingRule"("city", "area", "version");

-- CreateIndex
CREATE INDEX "PriceQuote_orderId_idx" ON "PriceQuote"("orderId");

-- CreateIndex
CREATE INDEX "PriceQuote_expiresAt_idx" ON "PriceQuote"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_ownerType_ownerId_currency_key" ON "Wallet"("ownerType", "ownerId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_walletId_createdAt_idx" ON "LedgerEntry"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_orderId_idx" ON "LedgerEntry"("orderId");

-- CreateIndex
CREATE INDEX "Settlement_ownerType_ownerId_status_idx" ON "Settlement"("ownerType", "ownerId", "status");

-- CreateIndex
CREATE INDEX "Rating_subjectId_createdAt_idx" ON "Rating"("subjectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_orderId_authorId_key" ON "Rating"("orderId", "authorId");

-- CreateIndex
CREATE INDEX "SupportCase_status_createdAt_idx" ON "SupportCase"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportCase_orderId_idx" ON "SupportCase"("orderId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");

-- CreateIndex
CREATE INDEX "FeatureFlag_scope_scopeReference_idx" ON "FeatureFlag"("scope", "scopeReference");

-- CreateIndex
CREATE INDEX "OtpChallenge_phone_purpose_createdAt_idx" ON "OtpChallenge"("phone", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "OtpChallenge_expiresAt_idx" ON "OtpChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_scope_key_key" ON "IdempotencyRecord"("scope", "key");

-- AddForeignKey
ALTER TABLE "MerchantMembership" ADD CONSTRAINT "MerchantMembership_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantMembership" ADD CONSTRAINT "MerchantMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierProfile" ADD CONSTRAINT "CourierProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "CourierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierDocument" ADD CONSTRAINT "CourierDocument_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "CourierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierDocument" ADD CONSTRAINT "CourierDocument_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_pickupAddressId_fkey" FOREIGN KEY ("pickupAddressId") REFERENCES "Address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_dropoffAddressId_fkey" FOREIGN KEY ("dropoffAddressId") REFERENCES "Address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "CourierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchOffer" ADD CONSTRAINT "DispatchOffer_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchOffer" ADD CONSTRAINT "DispatchOffer_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "CourierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingPoint" ADD CONSTRAINT "TrackingPoint_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "CourierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingPoint" ADD CONSTRAINT "TrackingPoint_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofOfDelivery" ADD CONSTRAINT "ProofOfDelivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceQuote" ADD CONSTRAINT "PriceQuote_pricingRuleId_fkey" FOREIGN KEY ("pricingRuleId") REFERENCES "PricingRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain checks that cannot be fully expressed in Prisma Schema Language.
ALTER TABLE "MerchantMembership"
  ADD CONSTRAINT "MerchantMembership_merchant_role_check"
  CHECK ("role" IN ('OWNER', 'MANAGER', 'STAFF'));

ALTER TABLE "FeatureFlag"
  ADD CONSTRAINT "FeatureFlag_rollout_percentage_check"
  CHECK ("rolloutPercent" BETWEEN 0 AND 100);

ALTER TABLE "Rating"
  ADD CONSTRAINT "Rating_score_check"
  CHECK ("score" BETWEEN 1 AND 5);

ALTER TABLE "PricingRule"
  ADD CONSTRAINT "PricingRule_nonnegative_amounts_check"
  CHECK (
    "baseFee" >= 0 AND
    "perKmFee" >= 0 AND
    "minimumFee" >= 0 AND
    "waitingFeePerMinute" >= 0 AND
    "smallPackageFee" >= 0 AND
    "mediumPackageFee" >= 0 AND
    "largePackageFee" >= 0 AND
    "commissionRate" BETWEEN 0 AND 1
  );

ALTER TABLE "DeliveryOrder"
  ADD CONSTRAINT "DeliveryOrder_nonnegative_amounts_check"
  CHECK (
    ("goodsAmount" IS NULL OR "goodsAmount" >= 0) AND
    ("deliveryFee" IS NULL OR "deliveryFee" >= 0) AND
    ("platformCommission" IS NULL OR "platformCommission" >= 0) AND
    ("courierEarning" IS NULL OR "courierEarning" >= 0)
  );

ALTER TABLE "PriceQuote"
  ADD CONSTRAINT "PriceQuote_nonnegative_amounts_check"
  CHECK ("distanceMeters" >= 0 AND "amount" >= 0 AND "commission" >= 0);

ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_nonzero_amount_check"
  CHECK ("amount" <> 0);

-- GiST indexes provide meter-based proximity queries for WGS84 geography points.
CREATE INDEX "Store_location_gist" ON "Store" USING GIST ("location");
CREATE INDEX "Address_location_gist" ON "Address" USING GIST ("location");
CREATE INDEX "CourierProfile_lastLocation_gist" ON "CourierProfile" USING GIST ("lastLocation");
CREATE INDEX "OrderEvent_location_gist" ON "OrderEvent" USING GIST ("location");
CREATE INDEX "TrackingPoint_location_gist" ON "TrackingPoint" USING GIST ("location");
CREATE INDEX "ProofOfDelivery_location_gist" ON "ProofOfDelivery" USING GIST ("location");

-- Even under races, a delivery order can have at most one accepted offer.
CREATE UNIQUE INDEX "DispatchOffer_one_accepted_per_order"
  ON "DispatchOffer" ("orderId")
  WHERE "status" = 'ACCEPTED';

-- Operational evidence is append-only. Corrections use compensating records.
CREATE OR REPLACE FUNCTION prevent_immutable_record_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% records are immutable; append a compensating record instead', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OrderEvent_immutable"
  BEFORE UPDATE OR DELETE ON "OrderEvent"
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_mutation();

CREATE TRIGGER "LedgerEntry_immutable"
  BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_mutation();

CREATE TRIGGER "AuditLog_immutable"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_mutation();
