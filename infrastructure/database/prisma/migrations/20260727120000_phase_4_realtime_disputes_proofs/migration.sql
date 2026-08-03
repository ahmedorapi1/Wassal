-- Phase 4: real-time operations, delivery disputes, return confirmation,
-- payment proofs, pilot password authentication, and production foundations.

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'DELIVERY_DISPUTED' AFTER 'DELIVERED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'RETURN_AWAITING_MERCHANT_CONFIRMATION' AFTER 'RETURNING_TO_STORE';

ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'DELIVERY_DISPUTE_CREATED' AFTER 'ORDER_DELIVERED';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'DELIVERY_DISPUTE_COURIER_RESPONDED' AFTER 'DELIVERY_DISPUTE_CREATED';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'DELIVERY_DISPUTE_RESOLVED' AFTER 'DELIVERY_DISPUTE_COURIER_RESPONDED';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'RETURN_AWAITING_MERCHANT_CONFIRMATION' AFTER 'RETURNING_TO_STORE';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'RETURN_CONFIRMED' AFTER 'RETURN_AWAITING_MERCHANT_CONFIRMATION';
ALTER TYPE "OrderEventType" ADD VALUE IF NOT EXISTS 'RETURN_ADMIN_OVERRIDE' AFTER 'RETURN_CONFIRMED';

CREATE TYPE "DeliveryDisputeReason" AS ENUM (
  'COURIER_DID_NOT_ARRIVE',
  'CUSTOMER_DID_NOT_RECEIVE',
  'WRONG_RECIPIENT',
  'INCOMPLETE_DELIVERY',
  'DAMAGED_DELIVERY',
  'MARKED_DELIVERED_BY_MISTAKE',
  'OTHER'
);

CREATE TYPE "DeliveryDisputeStatus" AS ENUM (
  'OPEN',
  'COURIER_RESPONDED',
  'RESOLVED_DELIVERY_CONFIRMED',
  'RESOLVED_NOT_DELIVERED',
  'RESOLVED_RETURN_REQUIRED',
  'CANCELLED_BY_ADMIN'
);

CREATE TYPE "DeliveryFailureReason" AS ENUM (
  'CUSTOMER_NO_ANSWER',
  'PHONE_OFF',
  'WRONG_ADDRESS',
  'CUSTOMER_ABSENT',
  'CUSTOMER_REFUSED',
  'CUSTOMER_CANCELLED',
  'INCORRECT_INFORMATION',
  'INACCESSIBLE_LOCATION',
  'PRODUCT_ISSUE',
  'COURIER_EMERGENCY',
  'OTHER'
);

CREATE TYPE "ReturnCondition" AS ENUM ('INTACT', 'DAMAGED', 'INCOMPLETE', 'OTHER');

CREATE TYPE "OrderCompletionSource" AS ENUM (
  'DISPUTE_WINDOW_EXPIRED',
  'ADMIN_CONFIRMED_DELIVERY',
  'MERCHANT_CONFIRMED_RETURN',
  'ADMIN_RETURN_OVERRIDE'
);

CREATE TYPE "PaymentProofStatus" AS ENUM (
  'PENDING_CONFIRMATION',
  'APPROVED',
  'PARTIALLY_APPROVED',
  'REJECTED',
  'CANCELLED_BY_COURIER',
  'SUPERSEDED'
);

ALTER TABLE "User"
  ADD COLUMN "passwordHash" VARCHAR(255),
  ADD COLUMN "passwordChangedAt" TIMESTAMPTZ(3),
  ADD COLUMN "forcePasswordChange" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" TIMESTAMPTZ(3);

ALTER TABLE "Address"
  ADD COLUMN "street" VARCHAR(240),
  ADD COLUMN "deliveryNotes" TEXT,
  ADD COLUMN "sourceMapsUrl" VARCHAR(1000);

ALTER TABLE "DeliveryOrder"
  ADD COLUMN "deliveredAt" TIMESTAMPTZ(3),
  ADD COLUMN "deliveryDisputeDeadlineAt" TIMESTAMPTZ(3),
  ADD COLUMN "completedAt" TIMESTAMPTZ(3),
  ADD COLUMN "completionSource" "OrderCompletionSource",
  ADD COLUMN "deliveryNote" TEXT,
  ADD COLUMN "deliveryFailureReason" "DeliveryFailureReason",
  ADD COLUMN "deliveryFailureNote" TEXT,
  ADD COLUMN "returnReportedAt" TIMESTAMPTZ(3),
  ADD COLUMN "returnConfirmedAt" TIMESTAMPTZ(3),
  ADD COLUMN "returnConfirmedById" UUID,
  ADD COLUMN "returnCondition" "ReturnCondition",
  ADD COLUMN "returnConfirmationNote" TEXT;

-- Phase 3 intentionally constrained assigned-order states. Extend that
-- invariant for the two Phase 4 assigned states while preserving the
-- courier/financial-finalization rules.
ALTER TABLE "DeliveryOrder"
  DROP CONSTRAINT "DeliveryOrder_phase3_scope_check",
  ADD CONSTRAINT "DeliveryOrder_phase4_scope_check"
    CHECK (
      "paymentMode" = 'DELIVERY_ONLY'
      AND "prohibitedItemsConfirmed" = true
      AND (
        (
          "status"::text IN ('DRAFT', 'QUOTED', 'SEARCHING_COURIER', 'CANCELLED')
          AND "courierId" IS NULL
        )
        OR (
          "status"::text IN (
            'COURIER_ASSIGNED',
            'COURIER_ARRIVING_PICKUP',
            'AT_PICKUP',
            'PICKED_UP',
            'IN_TRANSIT',
            'AT_DROPOFF',
            'DELIVERED',
            'DELIVERY_DISPUTED',
            'DELIVERY_FAILED',
            'RETURNING_TO_STORE',
            'RETURN_AWAITING_MERCHANT_CONFIRMATION',
            'RETURNED',
            'COMPLETED'
          )
          AND "courierId" IS NOT NULL
        )
      )
      AND (
        ("status"::text = 'COMPLETED' AND "financialFinalizedAt" IS NOT NULL)
        OR ("status"::text <> 'COMPLETED' AND "financialFinalizedAt" IS NULL)
      )
    );

-- Permit only Phase 4 lifecycle evidence fields to change while keeping all
-- customer, address, package, route, price, and commission snapshots immutable.
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
      'courierId', 'status', 'financialFinalizedAt',
      'deliveredAt', 'deliveryDisputeDeadlineAt',
      'completedAt', 'completionSource', 'deliveryNote',
      'deliveryFailureReason', 'deliveryFailureNote',
      'returnReportedAt', 'returnConfirmedAt', 'returnConfirmedById',
      'returnCondition', 'returnConfirmationNote',
      'cancelledAt', 'cancellationReasonCode',
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

CREATE TABLE "PlatformOperationalSetting" (
  "id" UUID NOT NULL,
  "deliveryDisputeWindowHours" INTEGER NOT NULL DEFAULT 24,
  "returnConfirmationTimeoutHours" INTEGER NOT NULL DEFAULT 48,
  "notificationRetentionDays" INTEGER NOT NULL DEFAULT 90,
  "operationsTimezone" VARCHAR(100) NOT NULL DEFAULT 'Africa/Cairo',
  "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
  "version" INTEGER NOT NULL,
  "createdById" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformOperationalSetting_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformOperationalSetting_window_check"
    CHECK ("deliveryDisputeWindowHours" BETWEEN 1 AND 168),
  CONSTRAINT "PlatformOperationalSetting_return_check"
    CHECK ("returnConfirmationTimeoutHours" BETWEEN 1 AND 720),
  CONSTRAINT "PlatformOperationalSetting_retention_check"
    CHECK ("notificationRetentionDays" BETWEEN 1 AND 3650)
);

CREATE UNIQUE INDEX "PlatformOperationalSetting_version_key"
  ON "PlatformOperationalSetting"("version");
CREATE INDEX "PlatformOperationalSetting_effectiveFrom_version_idx"
  ON "PlatformOperationalSetting"("effectiveFrom", "version");

CREATE TABLE "DeliveryDispute" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "merchantId" UUID NOT NULL,
  "courierId" UUID NOT NULL,
  "status" "DeliveryDisputeStatus" NOT NULL DEFAULT 'OPEN',
  "merchantReason" "DeliveryDisputeReason" NOT NULL,
  "merchantNote" TEXT,
  "createdById" UUID NOT NULL,
  "courierResponse" TEXT,
  "paperProofAvailable" BOOLEAN,
  "courierRespondedAt" TIMESTAMPTZ(3),
  "resolutionNote" TEXT,
  "resolvedById" UUID,
  "resolvedAt" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "DeliveryDispute_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeliveryDispute_resolution_check" CHECK (
    ("status" IN ('OPEN', 'COURIER_RESPONDED') AND "resolvedAt" IS NULL AND "resolvedById" IS NULL)
    OR
    ("status" NOT IN ('OPEN', 'COURIER_RESPONDED') AND "resolvedAt" IS NOT NULL AND "resolvedById" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "DeliveryDispute_orderId_key" ON "DeliveryDispute"("orderId");
CREATE INDEX "DeliveryDispute_status_createdAt_idx" ON "DeliveryDispute"("status", "createdAt");
CREATE INDEX "DeliveryDispute_merchantId_createdAt_idx" ON "DeliveryDispute"("merchantId", "createdAt");
CREATE INDEX "DeliveryDispute_courierId_createdAt_idx" ON "DeliveryDispute"("courierId", "createdAt");

CREATE TABLE "Notification" (
  "id" UUID NOT NULL,
  "recipientUserId" UUID NOT NULL,
  "type" VARCHAR(100) NOT NULL,
  "title" VARCHAR(240) NOT NULL,
  "body" TEXT NOT NULL,
  "relatedEntityType" VARCHAR(100),
  "relatedEntityId" VARCHAR(160),
  "deepLink" VARCHAR(500),
  "deduplicationKey" VARCHAR(200) NOT NULL,
  "metadata" JSONB,
  "readAt" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Notification_deduplicationKey_key" ON "Notification"("deduplicationKey");
CREATE INDEX "Notification_recipientUserId_createdAt_idx" ON "Notification"("recipientUserId", "createdAt");
CREATE INDEX "Notification_recipientUserId_readAt_createdAt_idx" ON "Notification"("recipientUserId", "readAt", "createdAt");
CREATE INDEX "Notification_expiresAt_idx" ON "Notification"("expiresAt");

CREATE TABLE "CourierPaymentProof" (
  "id" UUID NOT NULL,
  "courierId" UUID NOT NULL,
  "submittedAmountMinor" INTEGER NOT NULL,
  "approvedAmountMinor" INTEGER,
  "currency" CHAR(3) NOT NULL DEFAULT 'EGP',
  "method" "ExternalPaymentMethod" NOT NULL,
  "paidAt" TIMESTAMPTZ(3) NOT NULL,
  "externalReference" VARCHAR(160),
  "normalizedReference" VARCHAR(160),
  "note" TEXT,
  "status" "PaymentProofStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  "storageKey" VARCHAR(500) NOT NULL,
  "originalFilename" VARCHAR(255) NOT NULL,
  "contentType" VARCHAR(120) NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "checksumSha256" CHAR(64) NOT NULL,
  "duplicateIndicators" JSONB,
  "reviewReason" TEXT,
  "reviewedById" UUID,
  "reviewedAt" TIMESTAMPTZ(3),
  "linkedExternalPaymentId" UUID,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "supersedesId" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CourierPaymentProof_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourierPaymentProof_amount_check" CHECK ("submittedAmountMinor" > 0),
  CONSTRAINT "CourierPaymentProof_approved_amount_check"
    CHECK ("approvedAmountMinor" IS NULL OR ("approvedAmountMinor" > 0 AND "approvedAmountMinor" <= "submittedAmountMinor")),
  CONSTRAINT "CourierPaymentProof_file_check" CHECK ("sizeBytes" > 0)
);

CREATE UNIQUE INDEX "CourierPaymentProof_linkedExternalPaymentId_key"
  ON "CourierPaymentProof"("linkedExternalPaymentId");
CREATE UNIQUE INDEX "CourierPaymentProof_idempotencyKey_key"
  ON "CourierPaymentProof"("idempotencyKey");
CREATE INDEX "CourierPaymentProof_courierId_status_createdAt_idx"
  ON "CourierPaymentProof"("courierId", "status", "createdAt");
CREATE INDEX "CourierPaymentProof_status_createdAt_idx"
  ON "CourierPaymentProof"("status", "createdAt");
CREATE INDEX "CourierPaymentProof_normalizedReference_idx"
  ON "CourierPaymentProof"("normalizedReference");
CREATE INDEX "CourierPaymentProof_courierId_submittedAmountMinor_paidAt_idx"
  ON "CourierPaymentProof"("courierId", "submittedAmountMinor", "paidAt");

CREATE TABLE "PaymentProofReview" (
  "id" UUID NOT NULL,
  "paymentProofId" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  "fromStatus" "PaymentProofStatus" NOT NULL,
  "toStatus" "PaymentProofStatus" NOT NULL,
  "approvedAmountMinor" INTEGER,
  "reason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentProofReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentProofReview_paymentProofId_createdAt_idx"
  ON "PaymentProofReview"("paymentProofId", "createdAt");
CREATE INDEX "PaymentProofReview_actorId_createdAt_idx"
  ON "PaymentProofReview"("actorId", "createdAt");

CREATE INDEX "DeliveryOrder_status_deliveryDisputeDeadlineAt_idx"
  ON "DeliveryOrder"("status", "deliveryDisputeDeadlineAt");

ALTER TABLE "PlatformOperationalSetting"
  ADD CONSTRAINT "PlatformOperationalSetting_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryDispute"
  ADD CONSTRAINT "DeliveryDispute_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DeliveryDispute_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DeliveryDispute_courierId_fkey"
  FOREIGN KEY ("courierId") REFERENCES "CourierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DeliveryDispute_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DeliveryDispute_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_recipientUserId_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourierPaymentProof"
  ADD CONSTRAINT "CourierPaymentProof_courierId_fkey"
  FOREIGN KEY ("courierId") REFERENCES "CourierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CourierPaymentProof_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CourierPaymentProof_linkedExternalPaymentId_fkey"
  FOREIGN KEY ("linkedExternalPaymentId") REFERENCES "ExternalPaymentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CourierPaymentProof_supersedesId_fkey"
  FOREIGN KEY ("supersedesId") REFERENCES "CourierPaymentProof"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentProofReview"
  ADD CONSTRAINT "PaymentProofReview_paymentProofId_fkey"
  FOREIGN KEY ("paymentProofId") REFERENCES "CourierPaymentProof"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentProofReview_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "wasel_prevent_payment_proof_submission_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" <> 'PENDING_CONFIRMATION'
     AND (
       NEW."courierId" <> OLD."courierId"
       OR NEW."submittedAmountMinor" <> OLD."submittedAmountMinor"
       OR NEW."method" <> OLD."method"
       OR NEW."paidAt" <> OLD."paidAt"
       OR NEW."storageKey" <> OLD."storageKey"
       OR NEW."checksumSha256" <> OLD."checksumSha256"
     ) THEN
    RAISE EXCEPTION 'Reviewed payment-proof submission fields are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CourierPaymentProof_submission_immutable"
BEFORE UPDATE ON "CourierPaymentProof"
FOR EACH ROW EXECUTE FUNCTION "wasel_prevent_payment_proof_submission_mutation"();

CREATE FUNCTION "wasel_prevent_append_only_change"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Append-only records cannot be changed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentProofReview_append_only"
BEFORE UPDATE OR DELETE ON "PaymentProofReview"
FOR EACH ROW EXECUTE FUNCTION "wasel_prevent_append_only_change"();
